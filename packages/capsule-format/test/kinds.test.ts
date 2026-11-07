import { describe, expect, it } from "bun:test";

import { validateCapsulePackage } from "../src/validation.ts";
import {
  baseFiles,
  baseManifest,
  buildPackage,
  clone,
} from "./support/fixtures.ts";

const TRIGGER = "Use when writing a fixture.";

function guidelinesManifest(): Record<string, unknown> {
  const manifest = clone(baseManifest()) as Record<string, unknown>;
  manifest["kind"] = "guidelines";
  manifest["trigger"] = TRIGGER;
  delete manifest["profile"];
  delete manifest["inventory"];
  const contents = manifest["contents"] as Record<string, unknown>;
  for (const key of ["knowledgeItems", "sources", "evidence", "evaluations"]) {
    delete contents[key];
  }
  return manifest;
}

function guidelinesFiles(): Map<string, Uint8Array> {
  const files = baseFiles();
  for (const path of [
    "knowledge/items.jsonl",
    "sources/index.jsonl",
    "evidence/index.jsonl",
    "evaluations/manifest.json",
  ]) {
    files.delete(path);
  }
  return files;
}

function validate(manifest: Record<string, unknown>, files: Map<string, Uint8Array>) {
  return validateCapsulePackage(buildPackage(manifest, files), {
    minimumVerifiedEvidencePerMaterialItem: 1,
    mode: "publication",
  }).violations;
}

function failure(manifest: Record<string, unknown>): { code: string; messages: string[] } {
  try {
    validate(manifest, baseFiles());
  } catch (error) {
    const e = error as { code?: string; details?: { message: string }[] };
    return { code: e.code ?? "", messages: (e.details ?? []).map((d) => d.message) };
  }
  return { code: "", messages: [] };
}

function schemaMessages(manifest: Record<string, unknown>): string[] {
  try {
    validate(manifest, baseFiles());
  } catch (error) {
    return ((error as { details?: { message: string }[] }).details ?? []).map(
      (detail) => detail.message,
    );
  }
  return [];
}

describe("kind guidelines", () => {
  it("a minimal capsule with no items, evidence, sources or profile validates", () => {
    expect(validate(guidelinesManifest(), guidelinesFiles())).toEqual([]);
  });

  it("the core alone validates: id, version, scope, trigger, kind, canonical", () => {
    const core = {
      schemaVersion: "0.1",
      id: "fixture/core-only",
      version: "1.0.0",
      status: "draft",
      kind: "guidelines",
      trigger: TRIGGER,
      scope: { includes: ["a"], excludes: [] },
      contents: { canonical: "canonical.md" },
    };
    const files = new Map([["canonical.md", new TextEncoder().encode("# Core\n")]]);
    expect(validate(core, files)).toEqual([]);
  });

  it("a capsule that still carries all layers and a profile validates", () => {
    const manifest = baseManifest({ kind: "guidelines", trigger: TRIGGER });
    expect(validate(manifest, baseFiles())).toEqual([]);
  });

  it("a layer it chose to carry is still checked (inventory count mismatch)", () => {
    const manifest = baseManifest({ kind: "guidelines", trigger: TRIGGER });
    (manifest["inventory"] as Record<string, unknown>)["knowledgeItems"] = 5;
    expect(validate(manifest, baseFiles()).some((v) => v.rule === "PKG-07")).toBe(true);
  });

  it("still needs a trigger", () => {
    const manifest = guidelinesManifest();
    delete manifest["trigger"];
    expect(() => validate(manifest, guidelinesFiles())).toThrow();
  });

  it("rejects a trigger that spans more than one line", () => {
    const manifest = guidelinesManifest();
    manifest["trigger"] = "Use when\nwriting.";
    expect(() => validate(manifest, guidelinesFiles())).toThrow();
  });
});

describe("kind research keeps the old rules", () => {
  const research = (extra: Record<string, unknown> = {}) =>
    baseManifest({ kind: "research", trigger: TRIGGER, ...extra });

  it("a complete capsule validates", () => {
    expect(validate(research(), baseFiles())).toEqual([]);
  });

  it("a manifest without kind is refused, naming the allowed kinds", () => {
    const manifest = baseManifest();
    delete manifest["kind"];
    expect(() => validate(manifest, baseFiles())).toThrow(
      /no "kind".*guidelines, research/,
    );
  });

  for (const key of ["knowledgeItems", "sources", "evidence"] as const) {
    for (const declared of [true, false]) {
      it(`missing contents.${key} fails (kind ${declared ? "research" : "absent"})`, () => {
        const manifest = declared ? research() : baseManifest();
        delete (manifest["contents"] as Record<string, unknown>)[key];
        expect(schemaMessages(manifest).join("\n")).toMatch(
          new RegExp(`contents is missing:.*\\b${key}\\b`),
        );
      });
    }
  }

  for (const key of ["profile", "inventory"] as const) {
    for (const declared of [true, false]) {
      it(`missing ${key} fails with validation_failed (kind ${declared ? "research" : "absent"})`, () => {
        const manifest = declared ? research() : baseManifest();
        delete manifest[key];
        expect(failure(manifest)).toEqual({
          code: "validation_failed",
          messages: expect.arrayContaining([expect.stringMatching(new RegExp(`is missing:.*\\b${key}\\b`))]),
        });
      });
    }
  }

  for (const declared of [true, false]) {
    it(`missing inventory counts fail with validation_failed (kind ${declared ? "research" : "absent"})`, () => {
      const manifest = declared ? research() : baseManifest();
      delete (manifest["inventory"] as Record<string, unknown>)["sources"];
      expect(failure(manifest)).toEqual({
        code: "validation_failed",
        messages: expect.arrayContaining([expect.stringMatching(/inventory is missing:.*\bsources\b/)]),
      });
    });
  }

  for (const key of ["title", "summary", "freshness", "provenance"] as const) {
    it(`missing ${key} fails with validation_failed`, () => {
      const manifest = research();
      delete manifest[key];
      expect(failure(manifest).code).toBe("validation_failed");
    });
  }

  it("a missing layer file still raises PKG-01", () => {
    const files = baseFiles();
    files.delete("sources/index.jsonl");
    expect(validate(research(), files).some((v) => v.rule === "PKG-01")).toBe(true);
  });

  it("a declared kind needs a trigger", () => {
    const manifest = research();
    delete manifest["trigger"];
    expect(() => validate(manifest, baseFiles())).toThrow();
  });
});
