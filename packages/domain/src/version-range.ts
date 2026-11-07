import {
  comparePartsPrecedence,
  formatSemver,
  parsePrerelease,
  semverParts,
  type Semver,
  type SemverParts,
} from "./semver.ts";
import { detail, fail, ok, unwrap, type Result } from "./result.ts";

/**
 * Range support for `capsule.json#/dependencies[].versionRange` and for scope
 * technology selectors such as `">=44 <45"`. This is a deliberate subset of the
 * npm range grammar — comparators, `^`, `~`, hyphen ranges, `x`/`*` partials,
 * whitespace as AND and `||` as OR — written here rather than taken as a
 * dependency so the domain layer stays free of third-party code.
 */
export const RANGE_OPERATORS = ["<", "<=", ">", ">=", "="] as const;
export type RangeOperator = (typeof RANGE_OPERATORS)[number];

export interface Comparator {
  readonly op: RangeOperator;
  readonly version: SemverParts;
}

/** Comparators joined by AND. A version must satisfy all of them. */
export type ComparatorSet = readonly Comparator[];

export interface VersionRange {
  readonly raw: string;
  /** Comparator sets joined by OR. A version must satisfy at least one. */
  readonly clauses: readonly ComparatorSet[];
}

interface PartialVersion {
  readonly major?: number;
  readonly minor?: number;
  readonly patch?: number;
  readonly prerelease: readonly (string | number)[];
}

const PARTIAL =
  /^(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:-([0-9A-Za-z.-]+))?(?:\+(?:[0-9A-Za-z.-]+))?)?)?$/u;

const SIMPLE = /^(<=|>=|<|>|=|\^|~)?(.+)$/u;

const HYPHEN = /^(\S+)\s+-\s+(\S+)$/u;

const WILDCARD = /^[xX*]$/u;

/** Nothing satisfies `< 0.0.0`; used for degenerate ranges like `>*`. */
const NEVER: ComparatorSet = [
  { op: "<", version: { major: 0, minor: 0, patch: 0, prerelease: [] } },
];

/** Every non-prerelease version satisfies the empty comparator set. */
const ANY: ComparatorSet = [];

function parsePartial(raw: string): PartialVersion | undefined {
  const match = PARTIAL.exec(raw);
  if (match === null) return undefined;
  const [, major, minor, patch, prerelease] = match;
  const partial: {
    major?: number;
    minor?: number;
    patch?: number;
    prerelease: readonly (string | number)[];
  } = { prerelease: prerelease === undefined ? [] : parsePrerelease(prerelease) };
  if (major !== undefined && !WILDCARD.test(major)) {
    partial.major = Number(major);
    if (minor !== undefined && !WILDCARD.test(minor)) {
      partial.minor = Number(minor);
      if (patch !== undefined && !WILDCARD.test(patch)) {
        partial.patch = Number(patch);
      }
    }
  }
  return partial;
}

function bound(major: number, minor = 0, patch = 0): SemverParts {
  return { major, minor, patch, prerelease: [] };
}

/** A partial with its unspecified components filled in as zero. */
function exact(partial: PartialVersion): SemverParts {
  return {
    major: partial.major ?? 0,
    minor: partial.minor ?? 0,
    patch: partial.patch ?? 0,
    prerelease: partial.prerelease,
  };
}

/**
 * Upper bounds are written without npm's `-0` prerelease sentinel. They are not
 * needed here because a prerelease version is only ever considered against a
 * comparator set that names a prerelease on the same `major.minor.patch`, which
 * already keeps `2.0.0-alpha` out of `^1.2.3`.
 */
function expand(op: RangeOperator | "^" | "~" | undefined, partial: PartialVersion): ComparatorSet {
  const { major, minor, patch } = partial;

  if (op === "^") {
    if (major === undefined) return ANY;
    const lower: Comparator = { op: ">=", version: exact(partial) };
    if (major > 0) return [lower, { op: "<", version: bound(major + 1) }];
    if (minor === undefined) return [lower, { op: "<", version: bound(1) }];
    if (minor > 0 || patch === undefined) {
      return [lower, { op: "<", version: bound(0, minor + 1) }];
    }
    return [lower, { op: "<", version: bound(0, 0, patch + 1) }];
  }

  if (op === "~") {
    if (major === undefined) return ANY;
    const lower: Comparator = { op: ">=", version: exact(partial) };
    if (minor === undefined) return [lower, { op: "<", version: bound(major + 1) }];
    return [lower, { op: "<", version: bound(major, minor + 1) }];
  }

  if (op === ">") {
    if (major === undefined) return NEVER;
    if (minor === undefined) return [{ op: ">=", version: bound(major + 1) }];
    if (patch === undefined) return [{ op: ">=", version: bound(major, minor + 1) }];
    return [{ op: ">", version: exact(partial) }];
  }

  if (op === ">=") {
    if (major === undefined) return ANY;
    return [{ op: ">=", version: exact(partial) }];
  }

  if (op === "<") {
    if (major === undefined) return NEVER;
    return [{ op: "<", version: exact(partial) }];
  }

  if (op === "<=") {
    if (major === undefined) return ANY;
    if (minor === undefined) return [{ op: "<", version: bound(major + 1) }];
    if (patch === undefined) return [{ op: "<", version: bound(major, minor + 1) }];
    return [{ op: "<=", version: exact(partial) }];
  }

  // No operator: an exact version, or the range implied by a partial one.
  if (major === undefined) return ANY;
  if (minor === undefined) {
    return [
      { op: ">=", version: bound(major) },
      { op: "<", version: bound(major + 1) },
    ];
  }
  if (patch === undefined) {
    return [
      { op: ">=", version: bound(major, minor) },
      { op: "<", version: bound(major, minor + 1) },
    ];
  }
  return [{ op: "=", version: exact(partial) }];
}

function expandHyphen(
  lower: PartialVersion,
  upper: PartialVersion,
): ComparatorSet {
  const comparators: Comparator[] = [];
  if (lower.major !== undefined) {
    comparators.push({ op: ">=", version: exact(lower) });
  }
  if (upper.major === undefined) return comparators;
  if (upper.minor === undefined) {
    comparators.push({ op: "<", version: bound(upper.major + 1) });
  } else if (upper.patch === undefined) {
    comparators.push({ op: "<", version: bound(upper.major, upper.minor + 1) });
  } else {
    comparators.push({ op: "<=", version: exact(upper) });
  }
  return comparators;
}

function rangeFailure(raw: string, message: string, at_ = "/"): Result<never> {
  return fail("validation_failed", `invalid version range ${JSON.stringify(raw)}`, [
    detail("DOM-RANGE-01", at_, message, { range: raw }),
  ]);
}

export function parseVersionRange(
  value: unknown,
  at_ = "/",
): Result<VersionRange> {
  if (typeof value !== "string") {
    return fail("validation_failed", "invalid version range", [
      detail("DOM-RANGE-01", at_, "a version range must be a string"),
    ]);
  }
  const clauses: ComparatorSet[] = [];
  for (const rawClause of value.split("||")) {
    // `>= 1.2.3` is idiomatic in hand-written manifests; the space between an
    // operator and its version carries no meaning.
    const clause = rawClause.trim().replace(/([<>]=?|=|\^|~)\s+/gu, "$1");
    if (clause === "") {
      clauses.push(ANY);
      continue;
    }
    const hyphen = HYPHEN.exec(clause);
    if (hyphen !== null) {
      const [, low, high] = hyphen;
      const lower = low === undefined ? undefined : parsePartial(low);
      const upper = high === undefined ? undefined : parsePartial(high);
      if (lower === undefined || upper === undefined) {
        return rangeFailure(value, `unparsable hyphen range ${JSON.stringify(clause)}`, at_);
      }
      clauses.push(expandHyphen(lower, upper));
      continue;
    }
    const comparators: Comparator[] = [];
    for (const token of clause.split(/\s+/u)) {
      if (token === "") continue;
      const simple = SIMPLE.exec(token);
      const operator = simple?.[1] as RangeOperator | "^" | "~" | undefined;
      const body = simple?.[2];
      const partial = body === undefined ? undefined : parsePartial(body);
      if (partial === undefined) {
        return rangeFailure(value, `unparsable comparator ${JSON.stringify(token)}`, at_);
      }
      comparators.push(...expand(operator, partial));
    }
    clauses.push(comparators);
  }
  return ok({ raw: value, clauses });
}

export function assertVersionRange(value: unknown, at_ = "/"): VersionRange {
  return unwrap(parseVersionRange(value, at_));
}

function satisfiesComparator(
  version: SemverParts,
  comparator: Comparator,
): boolean {
  const order = comparePartsPrecedence(version, comparator.version);
  switch (comparator.op) {
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "=":
      return order === 0;
  }
}

function satisfiesSet(version: SemverParts, set: ComparatorSet): boolean {
  if (version.prerelease.length > 0) {
    // A prerelease is only in scope when the author opted into prereleases of
    // that exact tuple. Otherwise `^1.2.3` would silently accept `2.0.0-alpha`.
    const opted = set.some(
      (comparator) =>
        comparator.version.prerelease.length > 0 &&
        comparator.version.major === version.major &&
        comparator.version.minor === version.minor &&
        comparator.version.patch === version.patch,
    );
    if (!opted) return false;
  }
  return set.every((comparator) => satisfiesComparator(version, comparator));
}

export function satisfies(version: Semver, range: VersionRange): boolean {
  const parts = semverParts(version);
  return range.clauses.some((set) => satisfiesSet(parts, set));
}

export function maxSatisfying(
  versions: readonly Semver[],
  range: VersionRange,
): Semver | undefined {
  let best: Semver | undefined;
  for (const version of versions) {
    if (!satisfies(version, range)) continue;
    if (best === undefined || comparePartsPrecedence(semverParts(version), semverParts(best)) > 0) {
      best = version;
    }
  }
  return best;
}

/** Renders a parsed range back to a normalized comparator form, for traces. */
export function formatVersionRange(range: VersionRange): string {
  return range.clauses
    .map((set) =>
      set.length === 0
        ? "*"
        : set
            .map((comparator) => `${comparator.op}${formatSemver(comparator.version)}`)
            .join(" "),
    )
    .join(" || ");
}
