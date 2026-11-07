import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import { createCapsulePackage } from "../src/package.ts";
import { declaredContentPaths, parseManifest } from "../src/manifest.ts";
import { validateCapsulePackage } from "../src/validation.ts";
import type { CapsuleEntry } from "../src/digest.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");
const fixtureRoot = join(repoRoot, "fixtures/example-capsule");

/**
 * Reads exactly the entries `capsule.json#/contents` declares, plus
 * `capsule.json` itself — not every file physically present in
 * `fixtures/example-capsule/`.
 *
 * `provenance/ledger.jsonl` exists on disk alongside `provenance/build.json`
 * but is not referenced anywhere under `contents` (the schema has a single
 * `contents.provenance` path, not a directory). A whole-directory walk would
 * therefore see it as an undeclared file and fail PKG-02. See the ambiguity
 * noted in the handoff: whether the on-disk seed directory represents the
 * literal package contents, or an authoring directory a packer selects from,
 * is not settled by `CAPSULE_FORMAT.md`. This loader takes the second,
 * narrower reading, which is the only one under which the checked-in fixture
 * is a valid package at all.
 */
function loadFixturePackage(): CapsuleEntry[] {
  const manifestBytes = new Uint8Array(readFileSync(join(fixtureRoot, "capsule.json")));
  const manifest = parseManifest(manifestBytes);
  const entries: CapsuleEntry[] = [{ path: "capsule.json", bytes: manifestBytes }];
  for (const path of declaredContentPaths(manifest)) {
    entries.push({
      path,
      bytes: new Uint8Array(readFileSync(join(fixtureRoot, path))),
    });
  }
  return entries;
}

describe("fixtures/example-capsule: the seeded fixture", () => {
  it("validates cleanly under the software-engineering profile's evidence minimum", () => {
    const pkg = createCapsulePackage(loadFixturePackage());
    const result = validateCapsulePackage(pkg, {
      // profiles/software-engineering.profile.json: minimumVerifiedEvidencePerMaterialItem = 1.
      minimumVerifiedEvidencePerMaterialItem: 1,
      mode: "import",
    });
    expect(result.violations).toEqual([]);
  });

  it("also validates cleanly under publication mode (LF-only, ascending id order)", () => {
    const pkg = createCapsulePackage(loadFixturePackage());
    const result = validateCapsulePackage(pkg, {
      minimumVerifiedEvidencePerMaterialItem: 1,
      mode: "publication",
      requireDigest: false,
    });
    expect(result.violations).toEqual([]);
  });

  it("produces a stable digest across two independent loads from disk", () => {
    const first = validateCapsulePackage(createCapsulePackage(loadFixturePackage()), {
      minimumVerifiedEvidencePerMaterialItem: 1,
      mode: "import",
    });
    const second = validateCapsulePackage(createCapsulePackage(loadFixturePackage()), {
      minimumVerifiedEvidencePerMaterialItem: 1,
      mode: "import",
    });
    expect(second.digest).toBe(first.digest);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
