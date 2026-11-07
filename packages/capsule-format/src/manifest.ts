import { KcError, sharedValidator, type ValidationFailure } from "@kc/contracts";

import { canonicalJsonBytes } from "./jcs.ts";
import { normalizeEntryPath } from "./paths.ts";

/** `capsule.json` is the one fixed path in every package. */
export const MANIFEST_PATH = "capsule.json";

/**
 * Omitted from the hashed manifest as *absent keys*, never `null` and never
 * `[]` — JCS of `{"digest":null}` differs from JCS of `{}`.
 *
 * `status` in particular must not be hashed: the lifecycle allows
 * `published → superseded → archived`, and hashing it would break the recorded
 * digest of every superseded version and every lockfile pinned to it.
 */
export const UNHASHED_MANIFEST_KEYS = [
  "status",
  "digest",
  "signatures",
] as const;

export type CapsuleKind = "guidelines" | "research";

export const CAPSULE_KINDS: readonly CapsuleKind[] = ["guidelines", "research"];

export interface CapsuleContents {
  /** The markdown; the only content file every kind requires. */
  readonly canonical: string;
  /** Required by kind `research`: a copy of `scope` as a file. */
  readonly scope?: string;
  /** Items, sources and evidence files: required by kind `research`, optional for `guidelines`. */
  readonly knowledgeItems?: string;
  readonly sources?: string;
  readonly evidence?: string;
  readonly evaluations?: string;
  /** Provenance, ledger and changelog: required by kind `research`. */
  readonly provenance?: string;
  readonly provenanceLedger?: string;
  readonly changelog?: string;
  readonly patterns?: readonly string[];
  readonly examples?: readonly string[];
  readonly checks?: readonly string[];
  readonly attachments?: readonly string[];
}

export interface CapsuleInventory {
  readonly knowledgeItems?: number;
  readonly sources?: number;
  readonly evidence?: number;
  readonly checks?: number;
  readonly evaluations?: number;
}

export interface CapsuleDependency {
  readonly id: string;
  readonly versionRange: string;
  readonly policy: "required" | "optional" | "development";
  readonly digest?: string;
  readonly reason?: string;
}

/**
 * The manifest fields this package reads. `contracts/capsule-manifest.schema.json`
 * stays the source of truth — every manifest passes through Ajv before it is
 * seen as this type — so this interface is a view, not a second contract.
 */
export interface CapsuleManifest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly version: string;
  readonly status: string;
  readonly digest?: string;
  /** Required: `guidelines` or `research`. */
  readonly kind: CapsuleKind;
  /** One line saying when an agent should pull the capsule in; required for every capsule. */
  readonly trigger: string;
  /** Required by kind `research`. */
  readonly profile?: { readonly id: string; readonly version: string };
  /** `includes` and `excludes` always; `assumptions` is required only by kind `research`. */
  readonly scope: Record<string, unknown>;
  readonly contents: CapsuleContents;
  /** Required by kind `research`; for `guidelines`, needed only to count a layer the capsule chose to carry. */
  readonly inventory?: CapsuleInventory;
  readonly dependencies?: readonly CapsuleDependency[];
  readonly [key: string]: unknown;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseJsonBytes(bytes: Uint8Array, at: string): unknown {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new KcError("validation_failed", `${at} is not valid UTF-8`, {
      details: [{ at, message: "entry is not valid UTF-8" }],
      cause,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new KcError("validation_failed", `${at} is not valid JSON`, {
      details: [
        {
          at,
          message: cause instanceof Error ? cause.message : "invalid JSON",
        },
      ],
      cause,
    });
  }
}

/** Parses and schema-validates `capsule.json`; never re-serializes the stored bytes. */
export function parseManifest(bytes: Uint8Array): CapsuleManifest {
  const value = parseJsonBytes(bytes, MANIFEST_PATH);
  if (
    typeof value === "object" &&
    value !== null &&
    !("kind" in value)
  ) {
    throw new KcError(
      "validation_failed",
      `${MANIFEST_PATH} has no "kind"; use one of: ${CAPSULE_KINDS.join(", ")}`,
      { details: [] },
    );
  }
  // Absent in a source folder: schemaVersion is "0.1" and status is "published".
  const withDefaults = { schemaVersion: "0.1", status: "published", ...(value as object) };
  const result = sharedValidator().validate<CapsuleManifest>("capsuleManifest", withDefaults);
  if (result.ok) return result.value;
  throw manifestError(result.errors);
}

/** Field name for people: "/contents/canonical" becomes "contents.canonical". */
function fieldName(pointer: string): string {
  return pointer.split("/").filter((part) => part !== "").join(".");
}

function manifestError(failures: readonly ValidationFailure[]): KcError {
  const missing = new Map<string, string[]>();
  const others: { at: string; message: string; keyword: string }[] = [];
  for (const failure of failures) {
    if (failure.keyword === "required" && failure.missing !== undefined) {
      const list = missing.get(failure.at) ?? [];
      list.push(failure.missing);
      missing.set(failure.at, list);
    } else if (failure.keyword !== "if") {
      others.push(failure);
    }
  }
  const details: { at: string; message: string; keyword: string }[] = [];
  for (const [at, names] of missing) {
    const where = at === "/" ? MANIFEST_PATH : `${MANIFEST_PATH} ${fieldName(at)}`;
    details.push({ at, keyword: "required", message: `${where} is missing: ${names.join(", ")}${at === "/" ? "; see docs/capsule-format.md" : ""}` });
  }
  for (const failure of others) {
    const field = fieldName(failure.at);
    details.push({ at: failure.at, keyword: failure.keyword, message: `${MANIFEST_PATH}: ${field === "" ? "" : `${field} `}${failure.keyword === "pattern" || failure.keyword === "format" ? "is not valid" : failure.message}` });
  }
  const head = details[0]?.message ?? `${MANIFEST_PATH} is not valid`;
  return new KcError("validation_failed", head, { details });
}

/** The manifest as hashed: same value with the three unhashed keys removed. */
export function hashedManifestValue(
  manifest: CapsuleManifest,
): Record<string, unknown> {
  const omitted = new Set<string>(UNHASHED_MANIFEST_KEYS);
  const hashed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!omitted.has(key)) hashed[key] = value;
  }
  return hashed;
}

/**
 * The bytes `capsule.json` contributes to the canonical stream: its JCS form
 * with the unhashed keys absent. Deliberately not the stored bytes — the
 * manifest is the single entry the spec canonicalizes.
 */
export function manifestEntryBytes(manifest: CapsuleManifest): Uint8Array {
  return canonicalJsonBytes(hashedManifestValue(manifest));
}

/** Paths declared by `contents`, in declaration order, NFC-normalized. */
export function declaredContentPaths(manifest: CapsuleManifest): string[] {
  const contents = manifest.contents;
  const single = [
    contents.canonical,
    contents.scope,
    contents.knowledgeItems,
    contents.sources,
    contents.evidence,
    contents.evaluations,
    contents.provenance,
    contents.provenanceLedger,
    contents.changelog,
  ].filter((path): path is string => typeof path === "string");
  const lists = [
    contents.patterns,
    contents.examples,
    contents.checks,
    contents.attachments,
  ].flatMap((list) => list ?? []);
  return [...single, ...lists].map(normalizeEntryPath);
}

/**
 * `capsule.json` plus every path reachable from `capsule.json#/contents`.
 *
 * A file present but outside this set is fatal: under the alternative reading
 * an attacker could add an undeclared file to an unpacked capsule without
 * changing its digest, and it would survive import as trusted content.
 */
export function canonicalEntrySet(manifest: CapsuleManifest): Set<string> {
  return new Set([MANIFEST_PATH, ...declaredContentPaths(manifest)]);
}
