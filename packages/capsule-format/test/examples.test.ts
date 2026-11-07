import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createCapsulePackage } from "../src/package.ts";
import { parseManifest } from "../src/manifest.ts";
import { validateCapsulePackage } from "../src/validation.ts";

const examplesRoot = join(import.meta.dir, "..", "..", "..", "examples");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const capsuleDirs = readdirSync(examplesRoot)
  .map((name) => join(examplesRoot, name))
  .filter((dir) => statSync(dir).isDirectory());

describe("examples/: every capsule validates", () => {
  it("has at least the two Surfaces capsules", () => {
    expect(capsuleDirs.length).toBeGreaterThanOrEqual(2);
  });

  for (const dir of capsuleDirs) {
    it(`${relative(examplesRoot, dir)} publishes with a computed digest`, () => {
      // Every file in the folder counts: an undeclared file fails PKG-02.
      const pkg = createCapsulePackage(
        files(dir).map((path) => ({
          path: relative(dir, path).split("\\").join("/"),
          bytes: new Uint8Array(readFileSync(path)),
        })),
      );
      // The source folder carries no computed fields; publish adds them.
      const source = parseManifest(pkg.entries.get("capsule.json")!);
      expect(source.digest).toBeUndefined();
      expect(source.publishedAt).toBeUndefined();
      const draft = { ...source, status: "draft", publishedAt: "2026-01-01T00:00:00Z" };
      const entries = new Map(pkg.entries);
      entries.set("capsule.json", new TextEncoder().encode(`${JSON.stringify(draft, null, 2)}\n`));
      const first = validateCapsulePackage({ entries }, { minimumVerifiedEvidencePerMaterialItem: 1, mode: "publication", requireDigest: false });
      expect(first.violations).toEqual([]);
      const published = { ...draft, status: "published", digest: first.digest };
      entries.set("capsule.json", new TextEncoder().encode(`${JSON.stringify(published, null, 2)}\n`));
      const result = validateCapsulePackage({ entries }, { minimumVerifiedEvidencePerMaterialItem: 1, mode: "publication", requireDigest: true });
      expect(result.violations).toEqual([]);
      expect(result.digest).toBe(first.digest);
      // Portable: no path from the machine that wrote the example.
      for (const [path, bytes] of pkg.entries) {
        expect(`${path}: ${new TextDecoder().decode(bytes)}`).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
      }
    });
  }
});
