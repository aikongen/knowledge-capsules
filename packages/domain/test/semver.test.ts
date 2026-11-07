import { describe, expect, it } from "bun:test";
import { KcError } from "@kc/contracts";

import {
  SEMVER_LEVELS,
  VERSION_CHANGES,
  assertSemver,
  bumpSemver,
  classifyVersionChange,
  compareSemver,
  comparePartsPrecedence,
  formatSemver,
  isSemver,
  maxSemver,
  parsePrerelease,
  parseSemver,
  semverEquals,
  semverParts,
  sortSemver,
  type Semver,
} from "../src/semver.ts";
import { SEMVER_PATTERN } from "../src/patterns.ts";

function semver(value: string): Semver {
  return assertSemver(value);
}

describe("parseSemver / assertSemver / isSemver", () => {
  const valid = [
    "0.0.0",
    "1.2.3",
    "1.10.0",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-0.3.7",
    "1.0.0+build.1",
    "1.0.0-beta+exp.sha.5114f85",
  ];

  it.each(valid)("accepts %s", (value) => {
    expect(parseSemver(value).ok).toBe(true);
    expect(isSemver(value)).toBe(true);
    expect<unknown>(assertSemver(value)).toBe(value);
  });

  const invalid = [
    "",
    "1",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "v1.2.3",
    "1.2.3-",
    "1.2.3+",
    "-1.2.3",
  ];

  it.each(invalid)("rejects %s", (value) => {
    expect(parseSemver(value).ok).toBe(false);
    expect(isSemver(value)).toBe(false);
  });

  it("rejects a non-string value with the shared error envelope", () => {
    const result = parseSemver(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(KcError);
    expect(result.error.code).toBe("validation_failed");
  });

  it("assertSemver throws on an invalid value", () => {
    expect(() => assertSemver("not-a-version")).toThrow(KcError);
  });
});

describe("SEMVER_PARTS decomposition agrees with SEMVER_PATTERN validation", () => {
  const samples = [
    "0.0.0",
    "1.2.3",
    "1.10.0",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-x.7.z.92",
    "1.0.0+20130313144700",
    "1.0.0-beta+exp.sha.5114f85",
    "2.0.0-rc.1+build.123",
    "invalid",
    "1.2",
    "1.2.3.4",
  ];

  it.each(samples)(
    "%s: contract pattern acceptance matches successful decomposition",
    (value) => {
      const accepted = SEMVER_PATTERN.test(value);
      expect(isSemver(value)).toBe(accepted);
      if (accepted) {
        const version = assertSemver(value);
        expect(() => semverParts(version)).not.toThrow();
      }
    },
  );
});

describe("semverParts / formatSemver round-trip", () => {
  const values = [
    "0.0.0",
    "1.2.3",
    "1.0.0-alpha.1",
    "1.0.0+build.5",
    "1.0.0-beta+exp.sha.5114f85",
  ];

  it.each(values)("round-trips %s", (value) => {
    const parts = semverParts(semver(value));
    expect<unknown>(formatSemver(parts)).toBe(value);
  });

  it("parsePrerelease splits numeric identifiers as numbers and the rest as strings", () => {
    expect(parsePrerelease("alpha.1.beta.2")).toEqual([
      "alpha",
      1,
      "beta",
      2,
    ]);
    // A leading-zero numeric identifier like "0" is unambiguous; "01" is not
    // valid per the prerelease grammar this domain accepts as input, but
    // parsePrerelease itself is a decomposition helper with no validation of
    // its own — it is only ever called on text that already passed the
    // pattern, so no dedicated rejection test applies here.
    expect(parsePrerelease("0")).toEqual([0]);
  });
});

describe("precedence — numeric ordering beats naive string comparison", () => {
  it("1.10.0 outranks 1.9.0 even though '1.10.0' < '1.9.0' as a string", () => {
    expect(compareSemver(semver("1.10.0"), semver("1.9.0"))).toBe(1);
    expect("1.10.0" < "1.9.0").toBe(true); // documents the naive-comparison trap
  });

  it("orders 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-beta",
      "1.0.0",
    ].map(semver);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const a = ordered[index];
      const b = ordered[index + 1];
      if (a === undefined || b === undefined) continue;
      expect(compareSemver(a, b)).toBe(-1);
      expect(compareSemver(b, a)).toBe(1);
    }
  });

  it("numeric prerelease identifiers always outrank lower than alphanumeric ones, even when lexically greater", () => {
    // "9" is numeric, "alpha" is alphanumeric. Per semver, numeric identifiers
    // always have lower precedence than alphanumeric ones, regardless of the
    // lexical comparison of their text ("9" > "a" as characters).
    expect(compareSemver(semver("1.0.0-9"), semver("1.0.0-alpha"))).toBe(-1);
  });

  it("build metadata is ignored for precedence", () => {
    expect(compareSemver(semver("1.0.0+build.1"), semver("1.0.0+build.2"))).toBe(
      0,
    );
    expect(semverEquals(semver("1.0.0+a"), semver("1.0.0+b"))).toBe(true);
  });

  it("a release outranks its own prerelease", () => {
    expect(compareSemver(semver("1.0.0"), semver("1.0.0-alpha"))).toBe(1);
  });

  it("comparePartsPrecedence agrees with compareSemver on decomposed parts", () => {
    const a = semverParts(semver("1.2.3"));
    const b = semverParts(semver("1.2.4"));
    expect(comparePartsPrecedence(a, b)).toBe(-1);
  });
});

describe("sortSemver / maxSemver", () => {
  it("sorts ascending by precedence", () => {
    const versions = ["1.9.0", "1.10.0", "1.0.0-alpha", "1.0.0", "2.0.0"].map(
      semver,
    );
    expect(sortSemver(versions)).toEqual(
      ["1.0.0-alpha", "1.0.0", "1.9.0", "1.10.0", "2.0.0"].map(semver),
    );
  });

  it("does not mutate the input array", () => {
    const versions = ["1.9.0", "1.0.0"].map(semver);
    const copy = [...versions];
    sortSemver(versions);
    expect(versions).toEqual(copy);
  });

  it("maxSemver returns the highest-precedence version", () => {
    // Major.minor.patch is compared before prerelease, so a prerelease of a
    // higher triple still outranks a lower release — 2.0.0-alpha > 1.10.0.
    // To exercise the release-beats-its-own-prerelease tie-break instead, keep
    // the prerelease on the same triple as the winning release.
    const versions = ["1.9.0", "1.10.0", "1.10.0-rc.1"].map(semver);
    expect(maxSemver(versions)).toBe(semver("1.10.0"));
  });

  it("maxSemver ranks a higher major.minor.patch above a lower release, even as a prerelease", () => {
    const versions = ["1.10.0", "2.0.0-alpha"].map(semver);
    expect(maxSemver(versions)).toBe(semver("2.0.0-alpha"));
  });

  it("maxSemver returns undefined for an empty array", () => {
    expect(maxSemver([])).toBeUndefined();
  });
});

describe("bumpSemver", () => {
  it.each(SEMVER_LEVELS)("bumps a plain release at %s level", (level) => {
    const bumped = bumpSemver(semver("1.2.3"), level);
    expect<unknown>(bumped).toBe(
      level === "major" ? "2.0.0" : level === "minor" ? "1.3.0" : "1.2.4",
    );
  });

  it("patch-releases a prerelease instead of skipping a version: 1.2.3-rc.1 -> 1.2.3", () => {
    expect<unknown>(bumpSemver(semver("1.2.3-rc.1"), "patch")).toBe("1.2.3");
  });

  it("minor-bump of a prerelease on a clean minor (patch 0) releases in place: 1.2.0-rc.1 -> 1.2.0", () => {
    expect<unknown>(bumpSemver(semver("1.2.0-rc.1"), "minor")).toBe("1.2.0");
  });

  it("minor-bump of a patch-level prerelease advances the minor: 1.2.3-rc.1 -> 1.3.0", () => {
    expect<unknown>(bumpSemver(semver("1.2.3-rc.1"), "minor")).toBe("1.3.0");
  });

  it("major-bump of a prerelease on a clean major (minor.patch 0.0) releases in place: 2.0.0-rc.1 -> 2.0.0", () => {
    expect<unknown>(bumpSemver(semver("2.0.0-rc.1"), "major")).toBe("2.0.0");
  });

  it("major-bump of a non-clean prerelease advances the major: 1.2.0-rc.1 -> 2.0.0", () => {
    expect<unknown>(bumpSemver(semver("1.2.0-rc.1"), "major")).toBe("2.0.0");
  });

  it("bumping always drops prerelease and build metadata", () => {
    expect<unknown>(bumpSemver(semver("1.2.3-rc.1+build.5"), "patch")).toBe("1.2.3");
  });
});

describe("classifyVersionChange", () => {
  it("classifies each field-level change", () => {
    expect(classifyVersionChange(semver("1.2.3"), semver("2.0.0"))).toBe(
      "major",
    );
    expect(classifyVersionChange(semver("1.2.3"), semver("1.3.0"))).toBe(
      "minor",
    );
    expect(classifyVersionChange(semver("1.2.3"), semver("1.2.4"))).toBe(
      "patch",
    );
    // Same major.minor.patch, target has higher prerelease precedence: this is
    // the only shape of transition classifyVersionChange labels "prerelease".
    // Going the other way (1.2.3 -> 1.2.3-rc.1) is a *lower*-precedence move
    // and is classified "decrease" instead — see the dedicated test below.
    expect(
      classifyVersionChange(semver("1.2.3-alpha"), semver("1.2.3-beta")),
    ).toBe("prerelease");
  });

  it("classifies moving from a release back to a prerelease of the same triple as a decrease, not 'prerelease'", () => {
    // 1.2.3-rc.1 has lower semver precedence than plain 1.2.3, so this is a
    // regression in precedence even though only the prerelease tag changed.
    expect(
      classifyVersionChange(semver("1.2.3"), semver("1.2.3-rc.1")),
    ).toBe("decrease");
  });

  it("classifies an identical version as none", () => {
    expect(classifyVersionChange(semver("1.2.3"), semver("1.2.3"))).toBe(
      "none",
    );
  });

  it("classifies a lower target version as decrease", () => {
    expect(classifyVersionChange(semver("1.2.3"), semver("1.2.2"))).toBe(
      "decrease",
    );
    expect(classifyVersionChange(semver("2.0.0"), semver("1.9.9"))).toBe(
      "decrease",
    );
  });

  it("classifies 0.x transitions the same as any other field-level change", () => {
    // classifyVersionChange labels by which field moved; it does not give 0.x
    // the "everything is potentially breaking" treatment some semver tooling
    // applies to pre-1.0 ranges. CAPSULE_FORMAT.md's patch/minor/major
    // meanings do not carve out an exception for 0.x, so this documents
    // current, intended behavior rather than a gap.
    expect(classifyVersionChange(semver("0.1.0"), semver("0.2.0"))).toBe(
      "minor",
    );
    expect(classifyVersionChange(semver("0.1.0"), semver("0.1.1"))).toBe(
      "patch",
    );
    expect(classifyVersionChange(semver("0.1.0"), semver("1.0.0"))).toBe(
      "major",
    );
  });

  it("VERSION_CHANGES enumerates exactly the six classifications used above", () => {
    expect<unknown>([...VERSION_CHANGES].sort()).toEqual(
      ["decrease", "major", "minor", "none", "patch", "prerelease"].sort(),
    );
  });
});
