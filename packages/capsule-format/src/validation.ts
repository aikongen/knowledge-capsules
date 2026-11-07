import { KcError, sharedValidator, type SchemaName } from "@kc/contracts";
import {
  checkMaterialEvidence,
  isMaterial,
  type KnowledgeItemKind,
  type KnowledgeItemStatus,
  type LocalId,
} from "@kc/domain";

import { computeContentDigest, type CapsuleEntry } from "./digest.ts";
import { parseJsonl, type JsonlRecord } from "./jsonl.ts";
import {
  MANIFEST_PATH,
  canonicalEntrySet,
  declaredContentPaths,
  manifestEntryBytes,
  parseJsonBytes,
  parseManifest,
  type CapsuleManifest,
} from "./manifest.ts";
import { compareUtf8, collectDuplicatePathViolations, collectPathViolations } from "./paths.ts";
import { deepEqual, type CapsulePackage } from "./package.ts";
import { throwIfViolated, violation, type RuleViolation } from "./rules.ts";

/**
 * `CAPSULE_FORMAT.md` defines a material item as one whose `kind` is one of
 * these and whose `status` is `accepted`. Definitions, examples, patterns,
 * checks and known unknowns carry no evidence minimum.
 */
// Materiality is defined once, in @kc/domain. A second copy here is what let
// PKG-11 drift into counting evidence that contradicts the claim it was meant
// to support.

const EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "qualifies",
  "contextualizes",
] as const;

const RELATIONSHIP_KINDS = [
  "dependsOn",
  "relatedTo",
  "conflictsWith",
  "supersedes",
] as const;

/** Entries the spec's line-ending rule applies to. Attachments are never rewritten. */
const TEXT_EXTENSIONS = [".md", ".json", ".jsonl", ".txt"];

interface KnowledgeItemRecord {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly evidence?: Partial<Record<string, readonly string[]>>;
  readonly relationships?: Partial<Record<string, readonly string[]>>;
}

interface EvidenceRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly verification?: { readonly status?: string };
}

interface SourceRecord {
  readonly id: string;
}

/**
 * `publication` additionally enforces the byte-level rules the spec states for
 * authoring (LF-only, single trailing LF, record ordering). Those must never
 * run at import: entry bytes are hashed exactly as stored, so re-judging an
 * already-published capsule against them could reject a capsule whose digest
 * verifies.
 */
export type ValidationMode = "publication" | "import";

export interface ValidateCapsuleOptions {
  /**
   * The active profile's `minimumVerifiedEvidencePerMaterialItem`. Passed in
   * rather than loaded so this package stays free of profile resolution.
   */
  readonly minimumVerifiedEvidencePerMaterialItem: number;
  readonly mode?: ValidationMode;
  /**
   * Demand a manifest digest even for a draft. Defaults to the schema's own
   * rule: required once status is published, superseded, or archived.
   */
  readonly requireDigest?: boolean;
}

export interface CapsuleValidation {
  readonly manifest: CapsuleManifest;
  /** Recomputed from the canonical entry stream; the manifest's is never trusted. */
  readonly digest: string;
  readonly entries: readonly CapsuleEntry[];
  readonly violations: readonly RuleViolation[];
}

const PUBLISHED_STATUSES = new Set(["published", "superseded", "archived"]);

function schemaViolations(
  name: SchemaName,
  records: readonly JsonlRecord[],
  path: string,
): RuleViolation[] {
  const validator = sharedValidator();
  const found: RuleViolation[] = [];
  for (const record of records) {
    const result = validator.validate(name, record.value);
    if (result.ok) continue;
    for (const failure of result.errors) {
      found.push(
        violation(
          "FMT-04",
          `${name} record: ${failure.at} ${failure.message}`,
          `${path}:${String(record.line)}`,
        ),
      );
    }
  }
  return found;
}

function duplicateIdViolations(
  records: readonly JsonlRecord[],
  path: string,
): RuleViolation[] {
  const seen = new Set<string>();
  const found: RuleViolation[] = [];
  for (const record of records) {
    const id = (record.value as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) {
      found.push(
        violation(
          "PKG-03",
          `duplicate id "${id}"`,
          `${path}:${String(record.line)}`,
        ),
      );
      continue;
    }
    seen.add(id);
  }
  return found;
}

function idOrderViolations(
  records: readonly JsonlRecord[],
  path: string,
): RuleViolation[] {
  const found: RuleViolation[] = [];
  let previous: string | undefined;
  for (const record of records) {
    const id = (record.value as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    if (previous !== undefined && compareUtf8(previous, id) > 0) {
      found.push(
        violation(
          "FMT-03",
          `id "${id}" sorts before "${previous}"; records must ascend by id as UTF-8 bytes`,
          `${path}:${String(record.line)}`,
        ),
      );
    }
    previous = id;
  }
  return found;
}

function lineEndingViolations(
  path: string,
  bytes: Uint8Array,
): RuleViolation[] {
  if (!TEXT_EXTENSIONS.some((extension) => path.endsWith(extension))) return [];
  const found: RuleViolation[] = [];
  if (bytes.includes(0x0d)) {
    found.push(
      violation("FMT-01", `${path} has Windows line endings`, path),
    );
  }
  if (bytes.length === 0) return found;
  if (bytes.at(-1) !== 0x0a) {
    found.push(violation("FMT-02", `${path} must end with one newline`, path));
  } else if (bytes.at(-2) === 0x0a) {
    found.push(
      violation("FMT-02", `${path} must end with one newline`, path),
    );
  }
  return found;
}

function evidenceReferences(
  item: KnowledgeItemRecord,
): { relation: string; id: string }[] {
  return EVIDENCE_RELATIONS.flatMap((relation) =>
    (item.evidence?.[relation] ?? []).map((id) => ({ relation, id })),
  );
}

/**
 * Runs every named rule and returns each failure with its identifier, instead
 * of stopping at the first. `ACCEPTANCE_CRITERIA.md` P0-B asks for "actionable
 * errors"; a repair loop that surfaces one broken reference per attempt is not.
 */
export function validateCapsulePackage(
  pkg: CapsulePackage,
  options: ValidateCapsuleOptions,
): CapsuleValidation {
  const mode = options.mode ?? "import";
  const violations: RuleViolation[] = [];

  const manifestBytes = pkg.entries.get(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    throw new KcError(
      "validation_failed",
      `the zip has no ${MANIFEST_PATH}`,
      { details: [{ at: MANIFEST_PATH, message: `the zip has no ${MANIFEST_PATH}` }] },
    );
  }

  for (const path of pkg.entries.keys()) {
    violations.push(...collectPathViolations(path));
  }
  violations.push(...collectDuplicatePathViolations(pkg.entries.keys()));

  const manifest = parseManifest(manifestBytes);
  const contents = manifest.contents;
  const declared = declaredContentPaths(manifest);
  const canonical = canonicalEntrySet(manifest);

  // PKG-01 — every declared path is actually in the package.
  for (const path of declared) {
    if (!pkg.entries.has(path)) {
      violations.push(
        violation("PKG-01", `contents declares "${path}", which is missing`, path),
      );
    }
  }

  // PKG-02 — nothing is present that the manifest did not declare.
  for (const path of pkg.entries.keys()) {
    if (!canonical.has(path)) {
      violations.push(
        violation(
          "PKG-02",
          `"${path}" is present but not in the canonical entry set`,
          path,
        ),
      );
    }
  }

  if (mode === "publication") {
    for (const [path, bytes] of pkg.entries) {
      violations.push(...lineEndingViolations(path, bytes));
    }
  }

  const readJson = (path: string, bytes: Uint8Array): unknown => {
    try {
      return parseJsonBytes(bytes, path);
    } catch (error) {
      violations.push(
        violation(
          "FMT-04",
          error instanceof Error ? error.message : "unreadable JSON entry",
          path,
        ),
      );
      return undefined;
    }
  };

  const readRecords = (
    path: string,
    schema: SchemaName,
  ): JsonlRecord[] | undefined => {
    const bytes = pkg.entries.get(path);
    if (bytes === undefined) return undefined;
    let records: JsonlRecord[];
    try {
      records = parseJsonl(bytes, path);
    } catch (error) {
      const details = error instanceof KcError ? error.details : [];
      for (const detail of details) {
        violations.push(
          violation("FMT-04", detail.message, detail.at ?? path),
        );
      }
      if (details.length === 0) throw error;
      return undefined;
    }
    violations.push(...schemaViolations(schema, records, path));
    violations.push(...duplicateIdViolations(records, path));
    if (mode === "publication") {
      violations.push(...idOrderViolations(records, path));
    }
    return records;
  };

  // Kind `research` must declare all three
  // layers; the schema enforces that. Kind `guidelines` may omit any of them.
  const itemsPath = contents.knowledgeItems;
  const evidencePath = contents.evidence;
  const sourcesPath = contents.sources;
  const itemRecords =
    itemsPath === undefined ? undefined : readRecords(itemsPath, "knowledgeItem");
  const evidenceRecords =
    evidencePath === undefined ? undefined : readRecords(evidencePath, "evidence");
  const sourceRecords =
    sourcesPath === undefined ? undefined : readRecords(sourcesPath, "source");

  const items = (itemRecords ?? []).map(
    (record) => record.value as KnowledgeItemRecord,
  );
  const evidence = (evidenceRecords ?? []).map(
    (record) => record.value as EvidenceRecord,
  );
  const sources = (sourceRecords ?? []).map(
    (record) => record.value as SourceRecord,
  );

  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const sourceIds = new Set(sources.map((record) => record.id));
  const itemIds = new Set(items.map((record) => record.id));

  // PKG-04 — knowledge items point at evidence that exists.
  for (const item of items) {
    for (const reference of evidenceReferences(item)) {
      if (evidenceById.has(reference.id)) continue;
      violations.push(
        violation(
          "PKG-04",
          `knowledge item "${item.id}" references unknown evidence "${reference.id}" under ${reference.relation}`,
          `${itemsPath ?? ""}#${item.id}`,
        ),
      );
    }
  }

  // PKG-05 — evidence points at a source that exists.
  for (const record of evidence) {
    if (sourceIds.has(record.sourceId)) continue;
    violations.push(
      violation(
        "PKG-05",
        `evidence "${record.id}" references unknown source "${record.sourceId}"`,
        `${evidencePath ?? ""}#${record.id}`,
      ),
    );
  }

  // PKG-06 — relationships resolve inside this capsule.
  for (const item of items) {
    for (const kind of RELATIONSHIP_KINDS) {
      for (const id of item.relationships?.[kind] ?? []) {
        if (itemIds.has(id)) continue;
        violations.push(
          violation(
            "PKG-06",
            `knowledge item "${item.id}" ${kind} unknown item "${id}"`,
            `${itemsPath ?? ""}#${item.id}`,
          ),
        );
      }
    }
  }

  // PKG-07 — inventory counts equal actual record counts.
  const counts: [
    "knowledgeItems" | "sources" | "evidence",
    number | undefined,
    string | undefined,
  ][] = [
    ["knowledgeItems", itemRecords?.length, itemsPath],
    ["sources", sourceRecords?.length, sourcesPath],
    ["evidence", evidenceRecords?.length, evidencePath],
  ];
  for (const [field, actual, path] of counts) {
    if (actual === undefined) continue;
    const declaredCount = manifest.inventory?.[field];
    if (declaredCount === actual) continue;
    violations.push(
      violation(
        "PKG-07",
        `inventory.${field} is ${String(declaredCount)} but ${path} holds ${String(actual)} records`,
        `${MANIFEST_PATH}#/inventory/${field}`,
      ),
    );
  }

  // PKG-08 — declared check and evaluation counts.
  const declaredChecks = contents.checks?.length ?? 0;
  const inventoryChecks = manifest.inventory?.checks;
  if (inventoryChecks === undefined ? declaredChecks > 0 : inventoryChecks !== declaredChecks) {
    violations.push(
      violation(
        "PKG-08",
        `inventory.checks is ${inventoryChecks === undefined ? "absent" : String(inventoryChecks)} but contents.checks declares ${String(declaredChecks)} entries`,
        `${MANIFEST_PATH}#/inventory/checks`,
      ),
    );
  }

  let evaluationChecks = 0;
  if (contents.evaluations !== undefined) {
    const bytes = pkg.entries.get(contents.evaluations);
    if (bytes !== undefined) {
      const parsed = (readJson(contents.evaluations, bytes) ?? {}) as {
        checks?: unknown;
      };
      if (Array.isArray(parsed.checks)) evaluationChecks = parsed.checks.length;
      else if (parsed.checks !== undefined) {
        violations.push(
          violation(
            "FMT-04",
            "evaluations manifest 'checks' is not an array",
            contents.evaluations,
          ),
        );
      }
    }
  }
  const inventoryEvaluations = manifest.inventory?.evaluations;
  if (
    inventoryEvaluations === undefined
      ? evaluationChecks > 0
      : inventoryEvaluations !== evaluationChecks
  ) {
    violations.push(
      violation(
        "PKG-08",
        `inventory.evaluations is ${inventoryEvaluations === undefined ? "absent" : String(inventoryEvaluations)} but the evaluations manifest declares ${String(evaluationChecks)} checks`,
        `${MANIFEST_PATH}#/inventory/evaluations`,
      ),
    );
  }

  // PKG-09 — dependency identities are unique and never name this capsule.
  const dependencyIndexes = new Map<string, number>();
  for (const [index, dependency] of (manifest.dependencies ?? []).entries()) {
    const at = `${MANIFEST_PATH}#/dependencies/${String(index)}`;
    const firstIndex = dependencyIndexes.get(dependency.id);
    if (firstIndex === undefined) {
      dependencyIndexes.set(dependency.id, index);
    } else {
      violations.push(
        violation(
          "PKG-09",
          `dependency ${String(index)} repeats id "${dependency.id}" first declared at dependency ${String(firstIndex)}`,
          at,
        ),
      );
    }
    if (dependency.id === manifest.id) {
      violations.push(
        violation(
          "PKG-09",
          `dependency ${String(index)} is this capsule's own id "${manifest.id}"`,
          at,
        ),
      );
    }
  }

  // PKG-10 — the two canonical copies of applicability agree.
  const scopeBytes =
    contents.scope === undefined ? undefined : pkg.entries.get(contents.scope);
  if (contents.scope !== undefined && scopeBytes !== undefined) {
    const scopeValue = readJson(contents.scope, scopeBytes);
    if (scopeValue !== undefined && !deepEqual(scopeValue, manifest.scope)) {
      violations.push(
        violation(
          "PKG-10",
          `${contents.scope} is not deep-equal to capsule.json#/scope`,
          contents.scope,
        ),
      );
    }
  }

  // PKG-11 — material items meet the profile's verified-evidence minimum.
  //
  // Delegated to @kc/domain rather than recomputed here. Only the `supports`
  // bucket counts: a claim is not supported by evidence against it, and the
  // earlier local implementation flattened all four relation buckets, so an
  // accepted claim whose only verified evidence refuted it passed this gate.
  const minimum = options.minimumVerifiedEvidencePerMaterialItem;
  const domainEvidence = new Map(
    evidence.map((record) => [
      record.id as LocalId,
      {
        id: record.id as LocalId,
        status: record.verification?.status ?? "unverified",
      },
    ]),
  );
  for (const item of items) {
    // Records reached here already satisfied the schema, so the identifier
    // shapes are known-good and the brands are safe to apply.
    const materialityInput = {
      id: item.id as LocalId,
      kind: item.kind as KnowledgeItemKind,
      status: item.status as KnowledgeItemStatus,
      supports: (item.evidence?.["supports"] ?? []) as readonly LocalId[],
    };
    if (!isMaterial(materialityInput)) continue;
    const outcome = checkMaterialEvidence(
      materialityInput,
      domainEvidence,
      minimum,
    );
    if (outcome.ok) continue;
    // Dangling references are already reported as PKG-04 above; only surface
    // the insufficient-evidence finding so one defect is not counted twice.
    for (const failure of outcome.error.details) {
      if (failure["rule"] !== "PKG-11") continue;
      violations.push(
        violation(
          "PKG-11",
          `material item "${item.id}" lacks the profile minimum of ${String(minimum)} verified supporting evidence record(s); restate it as known_unknown or add evidence`,
          `${itemsPath ?? ""}#${item.id}`,
        ),
      );
    }
  }

  // PKG-12 — recompute; never trust the manifest's own digest.
  const canonicalEntries: CapsuleEntry[] = [
    { path: MANIFEST_PATH, bytes: manifestEntryBytes(manifest) },
  ];
  for (const path of declared) {
    const bytes = pkg.entries.get(path);
    if (bytes !== undefined) canonicalEntries.push({ path, bytes });
  }
  const digest = computeContentDigest(canonicalEntries);

  const requireDigest =
    options.requireDigest ?? PUBLISHED_STATUSES.has(manifest.status);
  if (manifest.digest === undefined) {
    if (requireDigest) {
      violations.push(
        violation(
          "PKG-12",
          `${MANIFEST_PATH} has no digest; run kc publish on the folder first`,
          `${MANIFEST_PATH}#/digest`,
        ),
      );
    }
  } else if (manifest.digest !== digest) {
    violations.push(
      violation(
        "PKG-12",
        `${MANIFEST_PATH} digest does not match the files; remove it and publish again`,
        `${MANIFEST_PATH}#/digest`,
      ),
    );
  }

  if (
    PUBLISHED_STATUSES.has(manifest.status) &&
    options.requireDigest !== false &&
    manifest.publishedAt === undefined
  ) {
    violations.push(
      violation("PKG-12", `${MANIFEST_PATH} has no publishedAt`, `${MANIFEST_PATH}#/publishedAt`),
    );
  }

  return { manifest, digest, entries: canonicalEntries, violations };
}

/** {@link validateCapsulePackage}, raising the shared envelope on any failure. */
export function assertCapsulePackage(
  pkg: CapsulePackage,
  options: ValidateCapsuleOptions,
): CapsuleValidation {
  const result = validateCapsulePackage(pkg, options);
  throwIfViolated("validation_failed", result.violations);
  return result;
}
