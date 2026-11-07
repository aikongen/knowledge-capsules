import { describe, expect, it } from "bun:test";
import { KcError } from "@kc/contracts";

import * as idsModule from "../src/ids.ts";
import {
  assertCapsuleId,
  assertDigest,
  assertLocalId,
  assertPackagePath,
  assertProfileId,
  capsuleIdParts,
  digestHex,
  formatCapsuleId,
  isCapsuleId,
  isDigest,
  isLocalId,
  parseCapsuleId,
  parseDigest,
  parseLocalId,
  parsePackagePath,
  parseProfileId,
  type CapsuleId,
} from "../src/ids.ts";

describe("capsuleId", () => {
  const valid = [
    "engineering/electron-production",
    "a/b",
    "ns.core/slug_1",
    "team-1/service-2.beta",
  ];

  it.each(valid)("accepts %s", (value) => {
    const result = parseCapsuleId(value);
    expect(result.ok).toBe(true);
    expect<unknown>(assertCapsuleId(value)).toBe(value);
    expect(isCapsuleId(value)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(parseCapsuleId("").ok).toBe(false);
    expect(isCapsuleId("")).toBe(false);
  });

  it("rejects a value with no separator", () => {
    expect(parseCapsuleId("engineeringfoo").ok).toBe(false);
  });

  it("rejects a value with two separators", () => {
    expect(parseCapsuleId("a/b/c").ok).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(parseCapsuleId("Engineering/App").ok).toBe(false);
  });

  it("rejects leading punctuation in either segment", () => {
    expect(parseCapsuleId("-eng/app").ok).toBe(false);
    expect(parseCapsuleId("eng/-app").ok).toBe(false);
  });

  it("rejects a non-string value", () => {
    const result = parseCapsuleId(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(KcError);
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.details[0]?.message).toContain("expected a string");
  });

  it("does not cap length — a 5000-character namespace still matches the pattern", () => {
    // Neither CAPSULE_FORMAT.md nor the frozen schema declares a maxLength for
    // capsuleId (unlike filePath, whose 512-byte cap is a PKG-level import
    // rule, not part of the regex). Documenting the current behavior rather
    // than asserting a cap that does not exist anywhere in the contract.
    const long = `${"a".repeat(5000)}/slug`;
    expect(parseCapsuleId(long).ok).toBe(true);
  });

  it("assertCapsuleId throws the shared error envelope on an invalid value", () => {
    expect(() => assertCapsuleId("Bad Id")).toThrow(KcError);
    try {
      assertCapsuleId("Bad Id");
      expect.unreachable("assertCapsuleId should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KcError);
      expect((error as KcError).code).toBe("validation_failed");
      expect((error as KcError).details[0]?.rule).toBe("DOM-ID-01");
    }
  });

  it.each(valid)("capsuleIdParts/formatCapsuleId round-trip for %s", (value) => {
    const id = assertCapsuleId(value);
    const parts = capsuleIdParts(id);
    const reformatted = formatCapsuleId(parts);
    expect(reformatted.ok).toBe(true);
    if (reformatted.ok) expect(reformatted.value).toBe(id);
  });

  it("formatCapsuleId rejects parts that would not re-parse", () => {
    const result = formatCapsuleId({ namespace: "Bad", slug: "slug" });
    expect(result.ok).toBe(false);
  });
});

describe("localId", () => {
  const valid = ["a", "A1", "item-1", "kn:001", "a.b_c-d:e"];

  it.each(valid)("accepts %s", (value) => {
    expect(parseLocalId(value).ok).toBe(true);
    expect(isLocalId(value)).toBe(true);
  });

  it("accepts the maximum length of 128 characters", () => {
    const value = `a${"b".repeat(127)}`;
    expect(value).toHaveLength(128);
    expect(parseLocalId(value).ok).toBe(true);
  });

  it("rejects 129 characters as over-length", () => {
    const value = `a${"b".repeat(128)}`;
    expect(value).toHaveLength(129);
    expect(parseLocalId(value).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(parseLocalId("").ok).toBe(false);
  });

  it("rejects leading punctuation", () => {
    expect(parseLocalId("-item").ok).toBe(false);
    expect(parseLocalId(".item").ok).toBe(false);
    expect(parseLocalId(":item").ok).toBe(false);
  });

  it("rejects a slash, which is outside the allowed character class", () => {
    expect(parseLocalId("a/b").ok).toBe(false);
  });

  it("assertLocalId throws on failure and returns the value on success", () => {
    expect<unknown>(assertLocalId("item-1")).toBe("item-1");
    expect(() => assertLocalId("")).toThrow(KcError);
  });
});

describe("digest", () => {
  const validHex = "a".repeat(64);
  const valid = [`sha256:${validHex}`, `sha256:${"0123456789abcdef".repeat(4)}`];

  it.each(valid)("accepts %s", (value) => {
    expect(parseDigest(value).ok).toBe(true);
    expect(isDigest(value)).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(parseDigest("").ok).toBe(false);
  });

  it("rejects 63 hex characters (one short)", () => {
    expect(parseDigest(`sha256:${"a".repeat(63)}`).ok).toBe(false);
  });

  it("rejects 65 hex characters (one over)", () => {
    expect(parseDigest(`sha256:${"a".repeat(65)}`).ok).toBe(false);
  });

  it("rejects uppercase hex digits", () => {
    expect(parseDigest(`sha256:${"A".repeat(64)}`).ok).toBe(false);
  });

  it("rejects the wrong algorithm prefix", () => {
    expect(parseDigest(`sha1:${validHex}`).ok).toBe(false);
    expect(parseDigest(`SHA256:${validHex}`).ok).toBe(false);
  });

  it("rejects a missing colon separator", () => {
    expect(parseDigest(`sha256${validHex}`).ok).toBe(false);
  });

  it("digestHex strips exactly the algorithm prefix", () => {
    const digest = assertDigest(`sha256:${validHex}`);
    expect(digestHex(digest)).toBe(validHex);
  });
});

describe("profileId", () => {
  const valid = ["software-engineering", "kc.core", "a1", "a_b"];

  it.each(valid)("accepts %s", (value) => {
    expect(parseProfileId(value).ok).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(parseProfileId("").ok).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(parseProfileId("Software-Engineering").ok).toBe(false);
  });

  it("rejects leading punctuation", () => {
    expect(parseProfileId("-software").ok).toBe(false);
  });

  it("rejects a slash — a profileId has no namespace segment", () => {
    expect(parseProfileId("team/software").ok).toBe(false);
  });

  it("assertProfileId round-trips a valid value", () => {
    expect<unknown>(assertProfileId("kc.core")).toBe("kc.core");
  });
});

describe("packagePath", () => {
  const valid = ["capsule.json", "knowledge/items.jsonl", "a/b/c.md"];

  it.each(valid)("accepts %s", (value) => {
    expect(parsePackagePath(value).ok).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(parsePackagePath("").ok).toBe(false);
  });

  it("rejects a leading slash (absolute path)", () => {
    expect(parsePackagePath("/capsule.json").ok).toBe(false);
  });

  it("rejects a path containing a .. segment", () => {
    expect(parsePackagePath("a/../b").ok).toBe(false);
    expect(parsePackagePath("..").ok).toBe(false);
    expect(parsePackagePath("../a").ok).toBe(false);
    expect(parsePackagePath("a/..").ok).toBe(false);
  });

  it("rejects a backslash", () => {
    expect(parsePackagePath("a\\b").ok).toBe(false);
  });

  it("assertPackagePath round-trips a valid value", () => {
    expect<unknown>(assertPackagePath("sources/index.jsonl")).toBe(
      "sources/index.jsonl",
    );
  });
});

describe("API surface parity across the five branded ID types", () => {
  // `ids.ts` exports `isCapsuleId`, `isLocalId`, and `isDigest`, but no
  // `isProfileId` or `isPackagePath` predicate exists, even though both types
  // have a full parse/assert pair. This is an asymmetry in the exported
  // surface, not a defect proven by a failing test — recorded here as an
  // explicit inventory rather than silently working around it.
  it("documents that isProfileId and isPackagePath are not exported", () => {
    const moduleExports = new Set(Object.keys(idsModule));
    expect(moduleExports.has("isCapsuleId")).toBe(true);
    expect(moduleExports.has("isLocalId")).toBe(true);
    expect(moduleExports.has("isDigest")).toBe(true);
    expect(moduleExports.has("isProfileId")).toBe(false);
    expect(moduleExports.has("isPackagePath")).toBe(false);
  });
});

describe("capsuleId branded type retains its literal string value", () => {
  it("keeps a branded value usable as a plain string at runtime", () => {
    const id = assertCapsuleId("engineering/electron-production") as CapsuleId;
    expect(`${id}`).toBe("engineering/electron-production");
  });
});
