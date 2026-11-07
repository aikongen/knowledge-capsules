import { describe, expect, it } from "bun:test";

import { validateCapsulePackage, type ValidateCapsuleOptions } from "../src/validation.ts";
import {
  FIXTURE_TIMESTAMP,
  baseEvidence,
  baseFiles,
  baseKnowledgeItem,
  baseManifest,
  baseSource,
  buildPackage,
  clone,
  jsonLine,
  utf8,
} from "./support/fixtures.ts";

function violationsFor(
  manifest: Record<string, unknown>,
  files: Map<string, Uint8Array>,
  options: Partial<ValidateCapsuleOptions> = {},
) {
  const pkg = buildPackage(manifest, files);
  const result = validateCapsulePackage(pkg, {
    minimumVerifiedEvidencePerMaterialItem: 1,
    mode: "import",
    ...options,
  });
  return result.violations;
}

function hasRule(
  violations: readonly { rule: string }[],
  rule: string,
): boolean {
  return violations.some((v) => v.rule === rule);
}

describe("baseline: the fixture itself is fully valid", () => {
  it("produces zero violations for the untouched base manifest and files", () => {
    expect(violationsFor(baseManifest(), baseFiles())).toEqual([]);
  });
});

describe("PKG-01: every path in contents exists in the package", () => {
  it("hostile — a declared file is missing", () => {
    const files = baseFiles();
    files.delete("changelog.md");
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-01")).toBe(true);
    const violation = violations.find((v) => v.rule === "PKG-01");
    expect(violation?.at).toBe("changelog.md");
  });

  it("benign — every declared file is present", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-01")).toBe(false);
  });
});

describe("PKG-02: no undeclared file is present", () => {
  it("hostile — an extra file exists that contents never declared", () => {
    const files = baseFiles();
    files.set("stray.md", utf8("stray content\n"));
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-02")).toBe(true);
    const violation = violations.find((v) => v.rule === "PKG-02");
    expect(violation?.at).toBe("stray.md");
  });

  it("benign — every present file is declared", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-02")).toBe(false);
  });
});

describe("PKG-03: record ids are unique within their own file", () => {
  it("hostile — the same knowledge item id appears twice", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.inventory as Record<string, unknown>).knowledgeItems = 2;
    const files = baseFiles();
    const item = baseKnowledgeItem();
    files.set(
      "knowledge/items.jsonl",
      utf8(`${JSON.stringify(item)}\n${JSON.stringify(item)}\n`),
    );
    const violations = violationsFor(manifest, files);
    expect(hasRule(violations, "PKG-03")).toBe(true);
  });

  it("benign — every id in the file is unique", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-03")).toBe(false);
  });
});

describe("PKG-04: knowledge item evidence references resolve", () => {
  it("hostile — a knowledge item references evidence that does not exist", () => {
    const files = baseFiles();
    files.set(
      "knowledge/items.jsonl",
      jsonLine(
        baseKnowledgeItem({
          evidence: {
            supports: ["ev-does-not-exist"],
            contradicts: [],
            qualifies: [],
            contextualizes: [],
          },
        }),
      ),
    );
    // minimumVerifiedEvidencePerMaterialItem: 0 isolates this case from PKG-11,
    // which would otherwise also fire because the dangling reference resolves
    // to zero verified evidence records.
    const violations = violationsFor(baseManifest(), files, {
      minimumVerifiedEvidencePerMaterialItem: 0,
    });
    expect(hasRule(violations, "PKG-04")).toBe(true);
  });

  it("benign — every evidence reference resolves", () => {
    const violations = violationsFor(baseManifest(), baseFiles(), {
      minimumVerifiedEvidencePerMaterialItem: 0,
    });
    expect(hasRule(violations, "PKG-04")).toBe(false);
  });
});

describe("PKG-05: evidence.sourceId resolves to a source", () => {
  it("hostile — evidence references a source that does not exist", () => {
    const files = baseFiles();
    files.set(
      "evidence/index.jsonl",
      jsonLine(baseEvidence({ sourceId: "src-does-not-exist" })),
    );
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-05")).toBe(true);
  });

  it("benign — every evidence.sourceId resolves", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-05")).toBe(false);
  });
});

describe("PKG-06: relationships resolve to a knowledge item in this capsule", () => {
  it("hostile — a relationship points at an unknown knowledge item", () => {
    const files = baseFiles();
    files.set(
      "knowledge/items.jsonl",
      jsonLine(
        baseKnowledgeItem({
          relationships: {
            dependsOn: [],
            relatedTo: ["ki-does-not-exist"],
            conflictsWith: [],
            supersedes: [],
          },
        }),
      ),
    );
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-06")).toBe(true);
  });

  it("benign — no relationship is declared", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-06")).toBe(false);
  });
});

describe("PKG-07: inventory counts equal actual record counts", () => {
  it("hostile — inventory.knowledgeItems disagrees with the file's record count", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.inventory as Record<string, unknown>).knowledgeItems = 5;
    const violations = violationsFor(manifest, baseFiles());
    expect(hasRule(violations, "PKG-07")).toBe(true);
    const violation = violations.find((v) => v.rule === "PKG-07");
    expect(violation?.message).toContain("knowledgeItems");
  });

  it("benign — inventory counts match", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-07")).toBe(false);
  });
});

describe("PKG-09: dependency IDs are unique and do not name this capsule", () => {
  it("hostile — a dependency id equals the capsule's own id", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    manifest.dependencies = [
      { id: manifest.id, versionRange: "^1.0.0", policy: "required" },
    ];
    const violations = violationsFor(manifest, baseFiles());
    expect(hasRule(violations, "PKG-09")).toBe(true);
  });

  it("benign — dependencies never reference the capsule's own id", () => {
    const violations = violationsFor(baseManifest(), baseFiles());
    expect(hasRule(violations, "PKG-09")).toBe(false);
  });

  it("hostile — repeated dependency IDs are rejected despite different ranges and policies", () => {
    const dependencies = [
      { id: "example/dependency", versionRange: "^1.0.0", policy: "required" },
      { id: "example/dependency", versionRange: "~2.0.0", policy: "optional" },
    ] as const;

    for (const orderedDependencies of [dependencies, [...dependencies].reverse()]) {
      const manifest = baseManifest({ dependencies: orderedDependencies });
      const violations = violationsFor(manifest, baseFiles());
      expect(violations.filter((violation) => violation.rule === "PKG-09")).toEqual([
        {
          rule: "PKG-09",
          message:
            'dependency 1 repeats id "example/dependency" first declared at dependency 0',
          at: "capsule.json#/dependencies/1",
        },
      ]);
    }
  });

  it("benign — distinct dependency IDs may use different ranges and policies", () => {
    const manifest = baseManifest({
      dependencies: [
        { id: "example/required", versionRange: "^1.0.0", policy: "required" },
        { id: "example/optional", versionRange: "~2.0.0", policy: "optional" },
      ],
    });
    const violations = violationsFor(manifest, baseFiles());
    expect(hasRule(violations, "PKG-09")).toBe(false);
  });
});

describe("PKG-10: scope.json is deep-equal to capsule.json#/scope", () => {
  it("hostile — scope.json disagrees with the manifest's scope", () => {
    const files = baseFiles();
    files.set(
      "scope.json",
      utf8(
        `${JSON.stringify({ includes: ["a different scope"], excludes: [], assumptions: [] })}\n`,
      ),
    );
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-10")).toBe(true);
  });

  it("benign — scope.json matches capsule.json#/scope (formatting may still differ)", () => {
    const files = baseFiles();
    // Deliberately different byte formatting (spaces, key order does not
    // matter since PKG-10 compares parsed values, per CAPSULE_FORMAT.md).
    files.set(
      "scope.json",
      utf8(
        `${JSON.stringify({ assumptions: ["test fixture only"], excludes: [], includes: ["fixture scope"] }, null, 2)}\n`,
      ),
    );
    const violations = violationsFor(baseManifest(), files);
    expect(hasRule(violations, "PKG-10")).toBe(false);
  });
});

describe("PKG-12: recomputed content digest equals the manifest digest", () => {
  it("hostile — manifest.digest does not match the recomputed digest", () => {
    const manifest = baseManifest({
      status: "published",
      publishedAt: FIXTURE_TIMESTAMP,
      digest: `sha256:${"0".repeat(64)}`,
    });
    const violations = violationsFor(manifest, baseFiles());
    expect(hasRule(violations, "PKG-12")).toBe(true);
    const violation = violations.find((v) => v.rule === "PKG-12");
    expect(violation?.message).toContain("does not match the files");
  });

  it("hostile — requireDigest forced true demands a digest even on a draft", () => {
    // The schema no longer demands a digest: a source folder has none. PKG-12
    // demands it for a published capsule, and this override demands it for a draft.
    const manifest = baseManifest(); // draft, no digest
    const violations = violationsFor(manifest, baseFiles(), {
      requireDigest: true,
    });
    expect(hasRule(violations, "PKG-12")).toBe(true);
    const violation = violations.find((v) => v.rule === "PKG-12");
    expect(violation?.message).toContain("has no digest");
  });

  it("benign — manifest.digest matches the recomputed digest", () => {
    const files = baseFiles();
    // publishedAt is inside the hashed manifest value (only status, digest,
    // and signatures are omitted), so the digest must be computed against a
    // manifest that already carries the exact publishedAt it will be
    // published with — computing it before that field is set, then
    // attaching it afterward, would compute the digest of a different
    // canonical stream and legitimately fail PKG-12.
    const draftWithPublishedAt = baseManifest({
      publishedAt: FIXTURE_TIMESTAMP,
    }) as Record<string, unknown>;
    const draftValidation = validateCapsulePackage(
      buildPackage(draftWithPublishedAt, files),
      {
        minimumVerifiedEvidencePerMaterialItem: 1,
        mode: "import",
        requireDigest: false,
      },
    );
    expect(hasRule(draftValidation.violations, "PKG-12")).toBe(false);

    const published = clone(draftWithPublishedAt) as Record<string, unknown>;
    published.status = "published";
    published.digest = draftValidation.digest;
    const violations = violationsFor(published, files);
    expect(hasRule(violations, "PKG-12")).toBe(false);
  });
});

describe("collected violations: multiple failures are reported together", () => {
  it("does not stop at the first rule violation", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.inventory as Record<string, unknown>).knowledgeItems = 99;
    manifest.dependencies = [
      { id: manifest.id, versionRange: "^1.0.0", policy: "required" },
    ];
    const files = baseFiles();
    files.set("stray.md", utf8("stray\n"));
    const violations = violationsFor(manifest, files);
    expect(hasRule(violations, "PKG-02")).toBe(true);
    expect(hasRule(violations, "PKG-07")).toBe(true);
    expect(hasRule(violations, "PKG-09")).toBe(true);
  });
});

// Bonus coverage beyond the enumerated rule list: PKG-08 and PKG-11 protect
// two invariants `AGENTS.md` and `CAPSULE_FORMAT.md` name explicitly (declared
// check/evaluation counts, and evidence-backed material knowledge), so they
// are exercised here even though they were not in the assigned rule list.
describe("PKG-08 (bonus): declared check/evaluation counts agree with inventory", () => {
  it("hostile — inventory.checks disagrees with contents.checks length", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.contents as Record<string, unknown>).checks = ["checks/one.md"];
    (manifest.inventory as Record<string, unknown>).checks = 2;
    const files = baseFiles();
    files.set("checks/one.md", utf8("# Check\n"));
    const violations = violationsFor(manifest, files);
    expect(hasRule(violations, "PKG-08")).toBe(true);
  });

  it("benign — inventory.checks matches contents.checks length", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.contents as Record<string, unknown>).checks = ["checks/one.md"];
    (manifest.inventory as Record<string, unknown>).checks = 1;
    const files = baseFiles();
    files.set("checks/one.md", utf8("# Check\n"));
    const violations = violationsFor(manifest, files);
    expect(hasRule(violations, "PKG-08")).toBe(false);
  });
});

describe("PKG-11 (bonus): material items meet the profile's verified-evidence minimum", () => {
  it("hostile — a material item's only evidence is unverified", () => {
    const files = baseFiles();
    files.set(
      "evidence/index.jsonl",
      jsonLine(
        baseEvidence({ verification: { status: "unverified", method: "fixture" } }),
      ),
    );
    const violations = violationsFor(baseManifest(), files, {
      minimumVerifiedEvidencePerMaterialItem: 1,
    });
    expect(hasRule(violations, "PKG-11")).toBe(true);
  });

  it("benign — the material item has enough verified evidence", () => {
    const violations = violationsFor(baseManifest(), baseFiles(), {
      minimumVerifiedEvidencePerMaterialItem: 1,
    });
    expect(hasRule(violations, "PKG-11")).toBe(false);
  });

  it("a non-material kind (definition) carries no evidence minimum even with zero evidence", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.inventory as Record<string, unknown>).knowledgeItems = 1;
    const files = baseFiles();
    files.set(
      "knowledge/items.jsonl",
      jsonLine(
        baseKnowledgeItem({
          kind: "definition",
          evidence: {
            supports: [],
            contradicts: [],
            qualifies: [],
            contextualizes: [],
          },
        }),
      ),
    );
    const violations = violationsFor(manifest, files, {
      minimumVerifiedEvidencePerMaterialItem: 1,
    });
    expect(hasRule(violations, "PKG-11")).toBe(false);
  });

  it("an accepted material item restated with zero evidence but a non-accepted status carries no minimum", () => {
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    const files = baseFiles();
    files.set(
      "knowledge/items.jsonl",
      jsonLine(
        baseKnowledgeItem({
          status: "proposed",
          evidence: {
            supports: [],
            contradicts: [],
            qualifies: [],
            contextualizes: [],
          },
        }),
      ),
    );
    const violations = violationsFor(manifest, files, {
      minimumVerifiedEvidencePerMaterialItem: 1,
    });
    expect(hasRule(violations, "PKG-11")).toBe(false);
  });
});

describe("mode: publication vs import", () => {
  it("publication mode enforces LF-only text entries (FMT-01) that import mode ignores", () => {
    const files = baseFiles();
    files.set("changelog.md", utf8("# Changelog\r\n"));
    const importViolations = violationsFor(baseManifest(), files, {
      mode: "import",
    });
    const publicationViolations = violationsFor(baseManifest(), files, {
      mode: "publication",
    });
    expect(hasRule(importViolations, "FMT-01")).toBe(false);
    expect(hasRule(publicationViolations, "FMT-01")).toBe(true);
  });

  it("publication mode enforces ascending id order (FMT-03) that import mode ignores", () => {
    const files = baseFiles();
    const first = baseSource({ id: "src-b" });
    const second = baseSource({ id: "src-a" });
    files.set(
      "sources/index.jsonl",
      utf8(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`),
    );
    const manifest = clone(baseManifest()) as Record<string, unknown>;
    (manifest.inventory as Record<string, unknown>).sources = 2;
    const importViolations = violationsFor(manifest, files, { mode: "import" });
    const publicationViolations = violationsFor(manifest, files, {
      mode: "publication",
    });
    expect(hasRule(importViolations, "FMT-03")).toBe(false);
    expect(hasRule(publicationViolations, "FMT-03")).toBe(true);
  });
});
