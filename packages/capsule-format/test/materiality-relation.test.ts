import { describe, expect, it } from "bun:test";

import {
  validateCapsulePackage,
  type ValidateCapsuleOptions,
} from "../src/validation.ts";
import {
  baseEvidence,
  baseFiles,
  baseKnowledgeItem,
  baseManifest,
  buildPackage,
  jsonLine,
} from "./support/fixtures.ts";

function violationsFor(
  manifest: Record<string, unknown>,
  files: Map<string, Uint8Array>,
  options: Partial<ValidateCapsuleOptions> = {},
) {
  const pkg = buildPackage(manifest, files);
  return validateCapsulePackage(pkg, {
    minimumVerifiedEvidencePerMaterialItem: 1,
    mode: "import",
    ...options,
  }).violations;
}

/**
 * PKG-11 is the mechanical form of the product's central promise: a material
 * knowledge item traces to evidence or is marked uncertain.
 *
 * The relation matters. A claim is not supported by evidence that contradicts
 * it, and counting the wrong bucket lets a capsule publish an accepted claim
 * whose only backing is a verified refutation of itself — the exact false
 * authority PRESSURE_TEST.md warns about, arrived at through a green gate.
 */
describe("PKG-11 counts only supporting evidence", () => {
  function itemWithRelation(relation: string) {
    const item = baseKnowledgeItem({
      id: "ki-claim",
      kind: "claim",
      status: "accepted",
      evidence: {
        supports: [],
        contradicts: [],
        qualifies: [],
        contextualizes: [],
        [relation]: ["ev-only"],
      },
    });
    const evidence = baseEvidence({
      id: "ev-only",
      relation: relation === "supports" ? "supports" : relation,
      verification: {
        status: "verified",
        method: "manual",
        verifiedAt: "2026-08-31T16:00:00.000Z",
      },
    });
    const files = baseFiles();
    files.set("knowledge/items.jsonl", jsonLine(item));
    files.set("evidence/index.jsonl", jsonLine(evidence));
    return files;
  }

  it("accepts a material claim backed by verified supporting evidence", () => {
    const violations = violationsFor(baseManifest(), itemWithRelation("supports"));
    expect(violations.filter((v) => v.rule === "PKG-11")).toEqual([]);
  });

  for (const relation of ["contradicts", "qualifies", "contextualizes"]) {
    it(`rejects a material claim whose only verified evidence ${relation} it`, () => {
      const violations = violationsFor(
        baseManifest(),
        itemWithRelation(relation),
      );
      expect(
        violations.filter((v) => v.rule === "PKG-11").length,
        `expected PKG-11 for ${relation}-only evidence, got: ${JSON.stringify(violations)}`,
      ).toBe(1);
    });
  }

  it("still exempts a known_unknown with no evidence at all", () => {
    const item = baseKnowledgeItem({
      id: "ki-unknown",
      kind: "known_unknown",
      status: "accepted",
      evidence: {
        supports: [],
        contradicts: [],
        qualifies: [],
        contextualizes: [],
      },
    });
    const files = baseFiles();
    files.set("knowledge/items.jsonl", jsonLine(item));
    files.set("evidence/index.jsonl", jsonLine(baseEvidence()));
    const manifest = baseManifest();
    expect(
      violationsFor(manifest, files).filter((v) => v.rule === "PKG-11"),
    ).toEqual([]);
  });
});
