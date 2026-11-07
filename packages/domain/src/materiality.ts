import { detail, fail, ok, type Result } from "./result.ts";
import type { LocalId } from "./ids.ts";

export const KNOWLEDGE_ITEM_KINDS = [
  "definition",
  "claim",
  "guidance",
  "decision_rule",
  "procedure",
  "pattern",
  "anti_pattern",
  "warning",
  "example",
  "check",
  "known_unknown",
] as const;

export type KnowledgeItemKind = (typeof KNOWLEDGE_ITEM_KINDS)[number];

export const KNOWLEDGE_ITEM_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "deprecated",
] as const;

export type KnowledgeItemStatus = (typeof KNOWLEDGE_ITEM_STATUSES)[number];

/**
 * Kinds that assert something about the world and can therefore be wrong in a
 * way that costs the reader something.
 *
 * A `definition` or `example` describes the capsule's own vocabulary, a
 * `pattern` or `check` is a reusable artifact, and a `known_unknown` is an
 * explicit admission — none of them carry an evidential claim, so none of them
 * carry an evidence minimum.
 */
const MATERIAL_KINDS: ReadonlySet<KnowledgeItemKind> = new Set([
  "claim",
  "guidance",
  "decision_rule",
  "procedure",
  "warning",
  "anti_pattern",
]);

export interface EvidenceVerification {
  readonly id: LocalId;
  /** From evidence.schema.json: unverified | verified | disputed | rejected. */
  readonly status: string;
}

export interface MaterialityInput {
  readonly id: LocalId;
  readonly kind: KnowledgeItemKind;
  readonly status: KnowledgeItemStatus;
  /** Evidence ids in the item's `supports` bucket. */
  readonly supports: readonly LocalId[];
}

/**
 * `AGENTS.md` requires every material knowledge item to trace to evidence or be
 * explicitly marked uncertain. "Material" is defined in CAPSULE_FORMAT.md and
 * implemented here, because an invariant that exists only in prose is one the
 * publication gate cannot enforce.
 */
export function isMaterial(item: MaterialityInput): boolean {
  return MATERIAL_KINDS.has(item.kind) && item.status === "accepted";
}

/**
 * Checks one item against the active profile's evidence minimum.
 *
 * Only the `supports` bucket counts. Contradicting and qualifying evidence is
 * valuable and must be preserved, but a claim is not supported by evidence
 * against it, and counting either would let an item satisfy the minimum with
 * material that undermines it.
 *
 * Only `verified` evidence counts. `unverified` is a model-proposed citation
 * nobody has checked, and `disputed` or `rejected` evidence actively failed —
 * treating any of them as support is the self-attestation ADR-008 exists to
 * prevent.
 */
export function checkMaterialEvidence(
  item: MaterialityInput,
  evidence: ReadonlyMap<LocalId, EvidenceVerification>,
  minimumVerifiedEvidencePerMaterialItem: number,
): Result<MaterialityInput> {
  if (!isMaterial(item)) return ok(item);

  const missing: LocalId[] = [];
  let verified = 0;
  for (const id of item.supports) {
    const record = evidence.get(id);
    if (record === undefined) {
      missing.push(id);
      continue;
    }
    if (record.status === "verified") verified += 1;
  }

  if (missing.length > 0) {
    return fail(
      "validation_failed",
      `knowledge item ${item.id} cites evidence that does not exist`,
      missing.map((id) =>
        detail("PKG-04", `/evidence/supports`, `unknown evidence id ${id}`, {
          itemId: item.id,
          evidenceId: id,
        }),
      ),
    );
  }

  if (verified < minimumVerifiedEvidencePerMaterialItem) {
    return fail(
      "validation_failed",
      `material knowledge item ${item.id} has ${verified} verified supporting ` +
        `evidence record(s), below the required ${minimumVerifiedEvidencePerMaterialItem}`,
      [
        detail(
          "PKG-11",
          "/evidence/supports",
          "verify the evidence, or restate the item as a known_unknown",
          {
            itemId: item.id,
            kind: item.kind,
            verified,
            required: minimumVerifiedEvidencePerMaterialItem,
          },
        ),
      ],
    );
  }

  return ok(item);
}

/** Publication gate: every material item in the capsule must pass. */
export function checkCapsuleMateriality(
  items: readonly MaterialityInput[],
  evidence: ReadonlyMap<LocalId, EvidenceVerification>,
  minimumVerifiedEvidencePerMaterialItem: number,
): Result<readonly MaterialityInput[]> {
  const details = items
    .map((item) =>
      checkMaterialEvidence(
        item,
        evidence,
        minimumVerifiedEvidencePerMaterialItem,
      ),
    )
    .filter((result) => !result.ok)
    .flatMap((result) => (result.ok ? [] : result.error.details));

  if (details.length > 0) {
    return fail(
      "validation_failed",
      "capsule has material knowledge items without sufficient verified evidence",
      details,
    );
  }
  return ok(items);
}
