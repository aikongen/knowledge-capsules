import { KcError } from "@kc/contracts";

import { parseBranded, type Brand } from "./ids.ts";
import { SEMVER_PATTERN } from "./patterns.ts";
import { detail, unwrap, type Result } from "./result.ts";

export type Semver = Brand<string, "Semver">;

export type PrereleaseIdentifier = string | number;

export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly PrereleaseIdentifier[];
  readonly build?: string;
}

/**
 * `CAPSULE_FORMAT.md` gives each level a knowledge meaning rather than an API
 * meaning:
 *
 * - `patch`  — corrections or added evidence that leave applicability and
 *              guidance materially unchanged;
 * - `minor`  — backward-compatible additions or improved guidance;
 * - `major`  — changed scope, reversed material guidance, incompatible
 *              schema/profile expectations, or removed guarantees.
 */
export const SEMVER_LEVELS = ["major", "minor", "patch"] as const;
export type SemverLevel = (typeof SEMVER_LEVELS)[number];

/**
 * Decomposition only. Validation authority stays with `SEMVER_PATTERN`, which
 * comes from the contracts' shared `$defs`; this regex adds the capture groups
 * that pattern deliberately does not have. `semver.test.ts` proves the two
 * agree on every string either accepts.
 */
const SEMVER_PARTS =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u;

const NUMERIC_IDENTIFIER = /^\d+$/u;

export function parseSemver(value: unknown, at = "/"): Result<Semver> {
  return parseBranded<Semver>(value, SEMVER_PATTERN, "semver", at);
}

export function assertSemver(value: unknown, at = "/"): Semver {
  return unwrap(parseSemver(value, at));
}

export function isSemver(value: unknown): value is Semver {
  return parseSemver(value).ok;
}

export function parsePrerelease(
  raw: string,
): readonly PrereleaseIdentifier[] {
  return raw
    .split(".")
    .map((identifier) =>
      NUMERIC_IDENTIFIER.test(identifier) ? Number(identifier) : identifier,
    );
}

/** Total for any branded `Semver`; the brand guarantees the pattern held. */
export function semverParts(version: Semver): SemverParts {
  const match = SEMVER_PARTS.exec(version);
  if (match === null) {
    throw new KcError(
      "internal",
      `semver ${JSON.stringify(String(version))} passed the contract pattern but could not be decomposed`,
      {
        details: [
          detail(
            "DOM-SEMVER-01",
            "/",
            "the contract semver pattern and the domain decomposition regex disagree",
          ),
        ],
      },
    );
  }
  const [, major, minor, patch, prerelease, build] = match;
  const parts: {
    major: number;
    minor: number;
    patch: number;
    prerelease: readonly PrereleaseIdentifier[];
    build?: string;
  } = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : parsePrerelease(prerelease),
  };
  if (build !== undefined) parts.build = build;
  return parts;
}

export function formatSemver(parts: SemverParts): Semver {
  const core = `${parts.major}.${parts.minor}.${parts.patch}`;
  const pre =
    parts.prerelease.length > 0 ? `-${parts.prerelease.join(".")}` : "";
  const build = parts.build === undefined ? "" : `+${parts.build}`;
  return `${core}${pre}${build}` as Semver;
}

function compareIdentifiers(
  a: PrereleaseIdentifier,
  b: PrereleaseIdentifier,
): -1 | 0 | 1 {
  const aNumeric = typeof a === "number";
  const bNumeric = typeof b === "number";
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNumeric && !bNumeric) return -1;
  if (!aNumeric && bNumeric) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePrerelease(
  a: readonly PrereleaseIdentifier[],
  b: readonly PrereleaseIdentifier[],
): -1 | 0 | 1 {
  // A version without a prerelease outranks the same version with one.
  if (a.length === 0 && b.length > 0) return 1;
  if (a.length > 0 && b.length === 0) return -1;
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) continue;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

/** Build metadata is ignored for precedence, per the semver specification. */
export function comparePartsPrecedence(
  a: SemverParts,
  b: SemverParts,
): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function compareSemver(a: Semver, b: Semver): -1 | 0 | 1 {
  return comparePartsPrecedence(semverParts(a), semverParts(b));
}

export function semverEquals(a: Semver, b: Semver): boolean {
  return compareSemver(a, b) === 0;
}

export function sortSemver(versions: readonly Semver[]): readonly Semver[] {
  return [...versions].sort(compareSemver);
}

export function maxSemver(versions: readonly Semver[]): Semver | undefined {
  let best: Semver | undefined;
  for (const version of versions) {
    if (best === undefined || compareSemver(version, best) > 0) best = version;
  }
  return best;
}

/**
 * Bumping off a prerelease releases it rather than skipping a version:
 * `1.2.3-rc.1` patch-bumps to `1.2.3`, not `1.2.4`.
 */
export function bumpSemver(version: Semver, level: SemverLevel): Semver {
  const parts = semverParts(version);
  const hasPrerelease = parts.prerelease.length > 0;
  if (level === "major") {
    const major =
      hasPrerelease && parts.minor === 0 && parts.patch === 0
        ? parts.major
        : parts.major + 1;
    return formatSemver({ major, minor: 0, patch: 0, prerelease: [] });
  }
  if (level === "minor") {
    const minor =
      hasPrerelease && parts.patch === 0 ? parts.minor : parts.minor + 1;
    return formatSemver({
      major: parts.major,
      minor,
      patch: 0,
      prerelease: [],
    });
  }
  const patch = hasPrerelease ? parts.patch : parts.patch + 1;
  return formatSemver({
    major: parts.major,
    minor: parts.minor,
    patch,
    prerelease: [],
  });
}

export const VERSION_CHANGES = [
  "major",
  "minor",
  "patch",
  "prerelease",
  "none",
  "decrease",
] as const;
export type VersionChange = (typeof VERSION_CHANGES)[number];

/**
 * What a version transition claims about the knowledge inside it. Publication
 * uses this to reject a derived version that does not move forward.
 */
export function classifyVersionChange(from: Semver, to: Semver): VersionChange {
  const order = compareSemver(from, to);
  if (order === 0) return "none";
  if (order > 0) return "decrease";
  const a = semverParts(from);
  const b = semverParts(to);
  if (b.major !== a.major) return "major";
  if (b.minor !== a.minor) return "minor";
  if (b.patch !== a.patch) return "patch";
  return "prerelease";
}
