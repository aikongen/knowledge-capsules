import { KcError, type ErrorCode, type ErrorDetail } from "@kc/contracts";

/**
 * `CAPSULE_FORMAT.md` names `PKG-01`..`PKG-12` and requires each failure to be
 * reported "with the `validation_failed` code and the failing rule's
 * identifier", so an operator can tell which rule rejected a capsule.
 */
export const PACKAGE_RULES = [
  "PKG-01",
  "PKG-02",
  "PKG-03",
  "PKG-04",
  "PKG-05",
  "PKG-06",
  "PKG-07",
  "PKG-08",
  "PKG-09",
  "PKG-10",
  "PKG-11",
  "PKG-12",
] as const;

export type PackageRuleId = (typeof PACKAGE_RULES)[number];

/**
 * The spec's "Path rules" section is normative but unnumbered. Import failures
 * are useless without a stable referent, so each sentence there gets an
 * identifier on the same pattern as `PKG-*`.
 */
export const PATH_RULES = [
  "PATH-01",
  "PATH-02",
  "PATH-03",
  "PATH-04",
  "PATH-05",
  "PATH-06",
  "PATH-07",
  "PATH-08",
  "PATH-09",
  "PATH-10",
  "PATH-11",
  "PATH-12",
  "PATH-13",
] as const;

export type PathRuleId = (typeof PATH_RULES)[number];

/** Limits the spec requires ("archive size, entry count, and per-entry limits") . */
export const ARCHIVE_RULES = [
  "ARC-01",
  "ARC-02",
  "ARC-03",
  "ARC-04",
  "ARC-05",
  "ARC-06",
  "ARC-07",
  "ARC-08",
] as const;

export type ArchiveRuleId = (typeof ARCHIVE_RULES)[number];

/**
 * Byte-level rules the spec states under "Record ordering" and "Line endings".
 * They are explicitly *publication* rules, not import rules: entry bytes are
 * hashed exactly as stored, so an already-published capsule must never be
 * re-checked against them or its digest could not be reproduced.
 */
export const FORMAT_RULES = ["FMT-01", "FMT-02", "FMT-03", "FMT-04"] as const;

export type FormatRuleId = (typeof FORMAT_RULES)[number];

export type RuleId =
  | PackageRuleId
  | PathRuleId
  | ArchiveRuleId
  | FormatRuleId;

export const RULE_DESCRIPTIONS: Readonly<Record<RuleId, string>> = {
  "PKG-01":
    "every path in contents exists in the package and is in the canonical entry set",
  "PKG-02":
    "no file exists in the package that is absent from the canonical entry set",
  "PKG-03":
    "knowledgeItem.id, source.id and evidence.id are unique within their own file",
  "PKG-04":
    "every knowledgeItem evidence reference exists in the evidence index",
  "PKG-05": "every evidence.sourceId exists in the source index",
  "PKG-06":
    "every knowledgeItem relationship resolves to a knowledge item in this capsule",
  "PKG-07":
    "inventory knowledgeItems/sources/evidence equal the record counts of their files",
  "PKG-08":
    "inventory.checks counts contents.checks and inventory.evaluations counts the evaluations manifest checks",
  "PKG-09": "dependency ids are unique and do not equal this capsule's own id",
  "PKG-10": "scope.json parsed is deep-equal to capsule.json#/scope",
  "PKG-11":
    "every material knowledge item meets the profile's minimum verified evidence",
  "PKG-12": "the recomputed content digest equals the manifest digest",
  "PATH-01": "path is empty",
  "PATH-02": "path is absolute",
  "PATH-03": "path contains a '..' segment",
  "PATH-04": "path contains a '.' segment",
  "PATH-05": "path contains an empty segment",
  "PATH-06": "path contains a backslash",
  "PATH-07": "entry is a directory entry",
  "PATH-08": "path exceeds 512 bytes when UTF-8 encoded",
  "PATH-09": "path segment has leading or trailing whitespace",
  "PATH-10": "path segment ends with '.'",
  "PATH-11": "path contains a code point below U+0020",
  "PATH-12":
    "two entries collide on the NFC + ASCII-case-folded form of their path",
  "PATH-13": "entry is a symbolic link or another non-regular file",
  "ARC-01": "archive exceeds the maximum accepted byte size",
  "ARC-02": "archive exceeds the maximum accepted entry count",
  "ARC-03": "an entry exceeds the maximum accepted uncompressed size",
  "ARC-04": "the archive exceeds the maximum total uncompressed size",
  "ARC-05": "an entry exceeds the maximum accepted compression ratio",
  "ARC-06": "the archive uses an unsupported or malformed ZIP structure",
  "ARC-07": "an entry's CRC-32 does not match its decompressed bytes",
  "ARC-08": "an entry's local header disagrees with its central directory record",
  "FMT-01": "a text entry contains a CR byte",
  "FMT-02": "a text entry does not end with exactly one LF",
  "FMT-03": "records in a JSONL index are not sorted as the spec requires",
  "FMT-04": "an entry is not well-formed for its declared role",
};

export interface RuleViolation extends ErrorDetail {
  readonly rule: RuleId;
  readonly message: string;
  /** JSON Pointer or package-relative path the problem attaches to. */
  readonly at?: string;
}

export function violation(
  rule: RuleId,
  message: string,
  at?: string,
): RuleViolation {
  return at === undefined ? { rule, message } : { rule, message, at };
}

function summarize(violations: readonly RuleViolation[]): string {
  const head = violations[0];
  return head === undefined ? "the capsule is not valid" : head.message;
}

/**
 * Raises the shared envelope with every failing rule preserved in `details`.
 * Reporting one rule at a time makes a malformed capsule painful to repair,
 * which is the same reason `@kc/contracts` runs Ajv with `allErrors`.
 */
export function ruleError(
  code: ErrorCode,
  violations: readonly RuleViolation[],
): KcError {
  return new KcError(code, summarize(violations), { details: violations });
}

export function throwIfViolated(
  code: ErrorCode,
  violations: readonly RuleViolation[],
): void {
  if (violations.length > 0) throw ruleError(code, violations);
}
