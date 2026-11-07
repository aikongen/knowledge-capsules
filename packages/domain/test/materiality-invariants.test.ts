import { describe, expect, it } from "bun:test";

import {
  KNOWLEDGE_ITEM_KINDS,
  checkCapsuleMateriality,
  checkMaterialEvidence,
  isMaterial,
  type EvidenceVerification,
  type KnowledgeItemKind,
  type MaterialityInput,
} from "../src/materiality.ts";
import { assertLocalId, type LocalId } from "../src/ids.ts";

const id = (value: string): LocalId => assertLocalId(value);

function evidenceMap(
  entries: ReadonlyArray<readonly [string, string]>,
): ReadonlyMap<LocalId, EvidenceVerification> {
  return new Map(
    entries.map(([evidenceId, status]) => [
      id(evidenceId),
      { id: id(evidenceId), status },
    ]),
  );
}

function item(
  overrides: Partial<MaterialityInput> = {},
): MaterialityInput {
  return {
    id: id("ki-example"),
    kind: "claim",
    status: "accepted",
    supports: [id("ev-1")],
    ...overrides,
  };
}

// CAPSULE_FORMAT.md fixes this split. Kinds that assert something about the
// world carry an evidence minimum; kinds that describe the capsule's own
// vocabulary or admit ignorance do not.
const MATERIAL: readonly KnowledgeItemKind[] = [
  "claim",
  "guidance",
  "decision_rule",
  "procedure",
  "warning",
  "anti_pattern",
];

describe("materiality classification", () => {
  for (const kind of KNOWLEDGE_ITEM_KINDS) {
    const expected = MATERIAL.includes(kind);
    it(`${kind} is ${expected ? "" : "not "}material when accepted`, () => {
      expect(isMaterial(item({ kind, status: "accepted" }))).toBe(expected);
    });
  }

  it("is not material unless accepted", () => {
    for (const status of ["proposed", "rejected", "deprecated"] as const) {
      expect(isMaterial(item({ kind: "claim", status }))).toBe(false);
    }
  });

  it("covers every declared kind, so a new kind cannot default to immaterial unnoticed", () => {
    expect(KNOWLEDGE_ITEM_KINDS.length).toBe(11);
  });
});

describe("verified evidence minimum", () => {
  it("accepts a material item with enough verified supporting evidence", () => {
    const result = checkMaterialEvidence(
      item(),
      evidenceMap([["ev-1", "verified"]]),
      1,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a material item whose only evidence is unverified", () => {
    const result = checkMaterialEvidence(
      item(),
      evidenceMap([["ev-1", "unverified"]]),
      1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.details.some((d) => d["rule"] === "PKG-11")).toBe(true);
    }
  });

  // A model-proposed citation nobody checked, and evidence that actively
  // failed, must not be able to satisfy the minimum. This is the
  // self-attestation ADR-008 exists to prevent.
  for (const status of ["unverified", "disputed", "rejected"] as const) {
    it(`does not count ${status} evidence toward the minimum`, () => {
      const result = checkMaterialEvidence(
        item(),
        evidenceMap([["ev-1", status]]),
        1,
      );
      expect(result.ok).toBe(false);
    });
  }

  it("exempts an immaterial item with no evidence at all", () => {
    const result = checkMaterialEvidence(
      item({ kind: "definition", supports: [] }),
      evidenceMap([]),
      1,
    );
    expect(result.ok).toBe(true);
  });

  it("exempts known_unknown, the escape hatch the spec names", () => {
    const result = checkMaterialEvidence(
      item({ kind: "known_unknown", supports: [] }),
      evidenceMap([]),
      1,
    );
    expect(result.ok).toBe(true);
  });

  it("enforces a minimum above one", () => {
    const two = item({ supports: [id("ev-1"), id("ev-2")] });
    const bothVerified = evidenceMap([
      ["ev-1", "verified"],
      ["ev-2", "verified"],
    ]);
    expect(checkMaterialEvidence(two, bothVerified, 2).ok).toBe(true);
    expect(
      checkMaterialEvidence(
        two,
        evidenceMap([
          ["ev-1", "verified"],
          ["ev-2", "unverified"],
        ]),
        2,
      ).ok,
    ).toBe(false);
  });

  it("reports a dangling evidence reference as PKG-04, not as a missing minimum", () => {
    const result = checkMaterialEvidence(item(), evidenceMap([]), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details.some((d) => d["rule"] === "PKG-04")).toBe(true);
    }
  });

  // A list mixing a present id with a missing one is the only input that
  // exercises the counting loop past its `continue`, so a wrong loop variable
  // or a misplaced skip would otherwise go unnoticed.
  it("reports PKG-04 for the missing id even when another resolves", () => {
    const result = checkMaterialEvidence(
      item({ supports: [id("ev-1"), id("ev-missing")] }),
      evidenceMap([["ev-1", "verified"]]),
      1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details.length).toBe(1);
      expect(result.error.details[0]?.["rule"]).toBe("PKG-04");
      expect(result.error.details[0]?.["evidenceId"]).toBe("ev-missing");
    }
  });

  it("counts a verified record that follows a missing one once both resolve", () => {
    const result = checkMaterialEvidence(
      item({ supports: [id("ev-a"), id("ev-b")] }),
      evidenceMap([
        ["ev-a", "unverified"],
        ["ev-b", "verified"],
      ]),
      1,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

describe("capsule publication gate", () => {
  it("passes when every material item is supported", () => {
    const result = checkCapsuleMateriality(
      [
        item({ id: id("ki-1"), supports: [id("ev-1")] }),
        item({ id: id("ki-2"), kind: "definition", supports: [] }),
      ],
      evidenceMap([["ev-1", "verified"]]),
      1,
    );
    expect(result.ok).toBe(true);
  });

  it("collects every failure rather than stopping at the first", () => {
    const result = checkCapsuleMateriality(
      [
        item({ id: id("ki-1"), supports: [id("ev-1")] }),
        item({ id: id("ki-2"), supports: [id("ev-2")] }),
      ],
      evidenceMap([
        ["ev-1", "unverified"],
        ["ev-2", "unverified"],
      ]),
      1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details.length).toBe(2);
  });
});
