import { describe, expect, it } from "bun:test";
import { SCHEMAS } from "@kc/contracts";

import {
  CAPSULE_ID_PATTERN,
  DIGEST_PATTERN,
  LOCAL_ID_PATTERN,
  PACKAGE_PATH_PATTERN,
  PROFILE_ID_PATTERN,
  SEMVER_PATTERN,
  TIMESTAMP_PATTERN,
} from "../src/patterns.ts";

/**
 * `patterns.ts` derives every regex from the frozen contract schemas at module
 * load time (`patternFrom` reads `$defs.*.pattern` off `@kc/contracts`'s
 * `SCHEMAS`), rather than re-declaring the pattern text. That means these
 * assertions currently cannot fail from drift between two hand-written copies
 * of the same regex — there is only one copy. They still guard against a
 * regression where the loader is changed to read the wrong `$defs` entry, or
 * a future edit hardcodes a pattern instead of sourcing it.
 */
describe("patterns.ts sources every regex from the frozen contract schemas", () => {
  interface SchemaWithDefs {
    $defs?: Record<string, { pattern?: unknown }>;
  }

  // Compared as a compiled `RegExp`'s `.source`, not as a raw string:
  // `RegExp.prototype.source` re-escapes a literal `/` to `\/` (so the pattern
  // is valid inside a `/.../ ` literal), while the plain JSON schema string
  // does not carry that escape. Comparing the two forms directly would fail
  // on every pattern containing a slash for a reason that has nothing to do
  // with the domain and schema disagreeing.
  function defPattern(schema: keyof typeof SCHEMAS, def: string): string {
    const pattern = (SCHEMAS[schema] as SchemaWithDefs).$defs?.[def]?.pattern;
    expect(typeof pattern, `${String(schema)}#/$defs/${def}/pattern`).toBe(
      "string",
    );
    return new RegExp(pattern as string, "u").source;
  }

  it("capsuleId matches contracts/capsule-manifest.schema.json#/$defs/capsuleId", () => {
    expect(CAPSULE_ID_PATTERN.source).toBe(
      defPattern("capsuleManifest", "capsuleId"),
    );
  });

  it("localId matches contracts/capsule-manifest.schema.json#/$defs/localId", () => {
    expect(LOCAL_ID_PATTERN.source).toBe(
      defPattern("capsuleManifest", "localId"),
    );
  });

  it("semver matches contracts/capsule-manifest.schema.json#/$defs/semver", () => {
    expect(SEMVER_PATTERN.source).toBe(defPattern("capsuleManifest", "semver"));
  });

  it("digest matches contracts/capsule-manifest.schema.json#/$defs/digest", () => {
    expect(DIGEST_PATTERN.source).toBe(defPattern("capsuleManifest", "digest"));
  });

  it("timestamp matches contracts/capsule-manifest.schema.json#/$defs/timestamp", () => {
    expect(TIMESTAMP_PATTERN.source).toBe(
      defPattern("capsuleManifest", "timestamp"),
    );
  });

  it("filePath matches contracts/capsule-manifest.schema.json#/$defs/filePath", () => {
    expect(PACKAGE_PATH_PATTERN.source).toBe(
      defPattern("capsuleManifest", "filePath"),
    );
  });

  it("profileId matches contracts/profile.schema.json#/$defs/profileId", () => {
    expect(PROFILE_ID_PATTERN.source).toBe(defPattern("profile", "profileId"));
  });

  it("compiles every pattern with the unicode flag", () => {
    for (const pattern of [
      CAPSULE_ID_PATTERN,
      LOCAL_ID_PATTERN,
      SEMVER_PATTERN,
      DIGEST_PATTERN,
      TIMESTAMP_PATTERN,
      PACKAGE_PATH_PATTERN,
      PROFILE_ID_PATTERN,
    ]) {
      expect(pattern.unicode).toBe(true);
    }
  });
});
