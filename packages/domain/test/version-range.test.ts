import { describe, expect, it } from "bun:test";
import { KcError } from "@kc/contracts";

import { assertSemver, type Semver } from "../src/semver.ts";
import {
  assertVersionRange,
  formatVersionRange,
  maxSatisfying,
  parseVersionRange,
  satisfies,
  type VersionRange,
} from "../src/version-range.ts";

function semver(value: string): Semver {
  return assertSemver(value);
}

function range(value: string): VersionRange {
  return assertVersionRange(value);
}

describe("parseVersionRange / assertVersionRange", () => {
  it("rejects a non-string value with the shared error envelope", () => {
    const result = parseVersionRange(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(KcError);
    expect(result.error.code).toBe("validation_failed");
  });

  it("rejects an unparsable comparator", () => {
    expect(parseVersionRange("not-a-range!!").ok).toBe(false);
  });

  it("rejects an unparsable hyphen range", () => {
    expect(parseVersionRange("1.2.3 - not-a-version").ok).toBe(false);
  });

  it("assertVersionRange throws on an invalid range", () => {
    expect(() => assertVersionRange("!!!")).toThrow(KcError);
  });
});

describe("operator: exact version (no operator, full triple)", () => {
  it("matches only that exact version", () => {
    const r = range("1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.2.4"), r)).toBe(false);
    expect(satisfies(semver("1.2.2"), r)).toBe(false);
  });
});

describe("operator: partial versions widen to a range", () => {
  it("a bare major matches the whole major line", () => {
    const r = range("1");
    expect(satisfies(semver("1.0.0"), r)).toBe(true);
    expect(satisfies(semver("1.99.99"), r)).toBe(true);
    expect(satisfies(semver("2.0.0"), r)).toBe(false);
  });

  it("a major.minor matches the whole minor line", () => {
    const r = range("1.2");
    expect(satisfies(semver("1.2.0"), r)).toBe(true);
    expect(satisfies(semver("1.2.9"), r)).toBe(true);
    expect(satisfies(semver("1.3.0"), r)).toBe(false);
  });

  it("a wildcard (* or x) matches every ordinary release", () => {
    for (const wildcard of ["*", "x", "X"]) {
      const r = range(wildcard);
      expect(satisfies(semver("0.0.1"), r)).toBe(true);
      expect(satisfies(semver("9.9.9"), r)).toBe(true);
    }
  });
});

describe("operators: <, <=, >, >=, =", () => {
  it("<", () => {
    const r = range("<1.2.3");
    expect(satisfies(semver("1.2.2"), r)).toBe(true);
    expect(satisfies(semver("1.2.3"), r)).toBe(false);
  });

  it("<=", () => {
    const r = range("<=1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.2.4"), r)).toBe(false);
  });

  it(">", () => {
    const r = range(">1.2.3");
    expect(satisfies(semver("1.2.4"), r)).toBe(true);
    expect(satisfies(semver("1.2.3"), r)).toBe(false);
  });

  it(">=", () => {
    const r = range(">=1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.2.2"), r)).toBe(false);
  });

  it("= (explicit)", () => {
    const r = range("=1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.2.4"), r)).toBe(false);
  });

  it("tolerates whitespace between the operator and the version", () => {
    const r = range(">= 1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
  });
});

describe("comparator sets — whitespace joins as AND", () => {
  it(">=1.2.3 <2.0.0 requires both bounds", () => {
    const r = range(">=1.2.3 <2.0.0");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.9.9"), r)).toBe(true);
    expect(satisfies(semver("2.0.0"), r)).toBe(false);
    expect(satisfies(semver("1.2.2"), r)).toBe(false);
  });
});

describe("clauses joined by || as OR", () => {
  it("satisfies if either clause matches", () => {
    const r = range("1.2.3 || 2.0.0");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("2.0.0"), r)).toBe(true);
    expect(satisfies(semver("1.5.0"), r)).toBe(false);
  });
});

describe("hyphen ranges", () => {
  it("1.2.3 - 2.3.4 is inclusive on both ends", () => {
    const r = range("1.2.3 - 2.3.4");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("2.3.4"), r)).toBe(true);
    expect(satisfies(semver("2.3.5"), r)).toBe(false);
    expect(satisfies(semver("1.2.2"), r)).toBe(false);
  });

  it("a partial upper bound widens to the next unspecified component", () => {
    const r = range("1.2.3 - 2.3");
    expect(satisfies(semver("2.3.9"), r)).toBe(true);
    expect(satisfies(semver("2.4.0"), r)).toBe(false);
  });
});

describe("operator: ^ (caret)", () => {
  it("^1.2.3 allows changes that keep the leftmost non-zero component", () => {
    const r = range("^1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.9.9"), r)).toBe(true);
    expect(satisfies(semver("2.0.0"), r)).toBe(false);
    expect(satisfies(semver("1.2.2"), r)).toBe(false);
  });

  it("^0.2.3 only allows patch changes once major is 0", () => {
    const r = range("^0.2.3");
    expect(satisfies(semver("0.2.3"), r)).toBe(true);
    expect(satisfies(semver("0.2.9"), r)).toBe(true);
    expect(satisfies(semver("0.3.0"), r)).toBe(false);
  });

  it("^0.0.3 allows only that exact patch", () => {
    const r = range("^0.0.3");
    expect(satisfies(semver("0.0.3"), r)).toBe(true);
    expect(satisfies(semver("0.0.4"), r)).toBe(false);
  });
});

describe("operator: ~ (tilde)", () => {
  it("~1.2.3 allows patch-level changes only", () => {
    const r = range("~1.2.3");
    expect(satisfies(semver("1.2.3"), r)).toBe(true);
    expect(satisfies(semver("1.2.9"), r)).toBe(true);
    expect(satisfies(semver("1.3.0"), r)).toBe(false);
  });

  it("~1.2 (no patch given) allows the whole minor line", () => {
    const r = range("~1.2");
    expect(satisfies(semver("1.2.0"), r)).toBe(true);
    expect(satisfies(semver("1.2.9"), r)).toBe(true);
    expect(satisfies(semver("1.3.0"), r)).toBe(false);
  });

  it("~1 (no minor given) allows the whole major line", () => {
    const r = range("~1");
    expect(satisfies(semver("1.9.9"), r)).toBe(true);
    expect(satisfies(semver("2.0.0"), r)).toBe(false);
  });
});

describe("prerelease versions against a range", () => {
  it("a prerelease is excluded from a range that never mentions a prerelease on that triple", () => {
    const r = range("^1.0.0");
    expect(satisfies(semver("1.0.0-alpha"), r)).toBe(false);
    // The plain release on the same triple is, of course, still accepted.
    expect(satisfies(semver("1.0.0"), r)).toBe(true);
  });

  it("a prerelease is included when the range itself opts in on that exact triple", () => {
    const r = range(">=1.0.0-alpha <2.0.0");
    expect(satisfies(semver("1.0.0-alpha"), r)).toBe(true);
    expect(satisfies(semver("1.0.0-beta"), r)).toBe(true);
  });

  it("opting in on one triple does not extend to a different triple's prerelease", () => {
    const r = range(">=1.0.0-alpha <2.0.0");
    // 1.1.0-alpha is a prerelease of a different (1.1.0) triple; the range's
    // only prerelease comparator names 1.0.0, so this must not match.
    expect(satisfies(semver("1.1.0-alpha"), r)).toBe(false);
  });
});

describe("empty and unsatisfiable ranges", () => {
  it("an empty string parses as a clause matching everything (ANY)", () => {
    // A blank/whitespace-only clause maps to the empty comparator set, which
    // `satisfiesSet`'s `.every()` vacuously satisfies. Documenting this
    // rather than treating it as obviously wrong: it mirrors how an absent
    // `dependencies[].versionRange` might be represented, but it means a
    // typo'd empty range string is silently permissive rather than rejected.
    const r = range("");
    expect(satisfies(semver("0.0.1"), r)).toBe(true);
    expect(satisfies(semver("999.999.999"), r)).toBe(true);
  });

  it("a self-contradictory range is satisfied by nothing", () => {
    const r = range(">2.0.0 <1.0.0");
    expect(satisfies(semver("0.5.0"), r)).toBe(false);
    expect(satisfies(semver("1.5.0"), r)).toBe(false);
    expect(satisfies(semver("2.5.0"), r)).toBe(false);
  });
});

describe("maxSatisfying", () => {
  it("returns the highest version that satisfies the range", () => {
    const versions = ["1.0.0", "1.2.3", "1.9.9", "2.0.0"].map(semver);
    expect(maxSatisfying(versions, range("^1.0.0"))).toBe(semver("1.9.9"));
  });

  it("returns undefined when nothing satisfies", () => {
    const versions = ["1.0.0", "1.2.3"].map(semver);
    expect(maxSatisfying(versions, range("^2.0.0"))).toBeUndefined();
  });

  it("returns undefined for an empty version list", () => {
    expect(maxSatisfying([], range("*"))).toBeUndefined();
  });
});

describe("formatVersionRange", () => {
  it("round-trips a wildcard range to the literal '*'", () => {
    const parsed = range("*");
    expect(formatVersionRange(parsed)).toBe("*");
  });

  it("re-parsing the formatted output of a caret range preserves its semantics", () => {
    const original = range("^1.2.3");
    const reparsed = assertVersionRange(formatVersionRange(original));
    expect(reparsed.clauses).toEqual(original.clauses);
    // And, independent of the internal representation, both ranges make the
    // same accept/reject decision across a sample of versions.
    for (const version of ["1.2.3", "1.9.9", "2.0.0", "1.2.2"]) {
      expect(satisfies(semver(version), reparsed)).toBe(
        satisfies(semver(version), original),
      );
    }
  });

  it("re-parsing the formatted output of an OR range preserves its semantics", () => {
    const original = range("1.2.3 || 2.0.0");
    const reparsed = assertVersionRange(formatVersionRange(original));
    expect(reparsed.clauses).toEqual(original.clauses);
  });
});
