import { isAbsolute, join, resolve, sep } from "node:path";

import { KcError } from "@kc/contracts";
import {
  capsuleIdParts,
  digestHex,
  err,
  ok,
  parseCapsuleId,
  parseDigest,
  parseLocalId,
  parseSemver,
  type Result,
} from "@kc/domain";

/**
 * The canonical vault tree from `ARCHITECTURE.md` "Canonical vault":
 *
 * ```
 * <vault>/
 * ├── capsules/<namespace>/<slug>/{drafts,versions}/...
 * ├── sources/<source-id>/...
 * ├── artifacts/<run-id>/...
 * ├── exports/
 * ├── database.sqlite
 * ├── vault.json
 * └── runtime/
 * ```
 */
export interface VaultLayout {
  readonly root: string;
  readonly capsulesDir: string;
  readonly sourcesDir: string;
  readonly artifactsDir: string;
  readonly exportsDir: string;
  readonly databasePath: string;
  readonly vaultManifestPath: string;
  readonly runtimeDir: string;
  readonly runtimeLeaseDatabasePath: string;
}

export function vaultLayout(root: string): VaultLayout {
  const absoluteRoot = resolve(root);
  return {
    root: absoluteRoot,
    capsulesDir: join(absoluteRoot, "capsules"),
    sourcesDir: join(absoluteRoot, "sources"),
    artifactsDir: join(absoluteRoot, "artifacts"),
    exportsDir: join(absoluteRoot, "exports"),
    databasePath: join(absoluteRoot, "database.sqlite"),
    vaultManifestPath: join(absoluteRoot, "vault.json"),
    runtimeDir: join(absoluteRoot, "runtime"),
    runtimeLeaseDatabasePath: join(absoluteRoot, "runtime", "lease.sqlite"),
  };
}

/**
 * Every directory this module hands back is re-checked against `root` after
 * joining, on top of the identifier validation each helper already does.
 * A future identifier rule with a gap should fail closed here rather than
 * silently escape the vault — cheap insurance against exactly the class of
 * bug this module exists to prevent.
 */
function containedPath(root: string, path: string): Result<string> {
  const resolved = resolve(path);
  const boundary = resolved === root ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(boundary)) {
    return err(
      new KcError(
        "validation_failed",
        "resolved path escapes the vault root",
        { details: [{ at: "/", message: `${resolved} is outside ${root}` }] },
      ),
    );
  }
  return ok(resolved);
}

/**
 * Untrusted `namespace`/`slug` pair (may originate from imported capsules or
 * model output). Reuses the shared `capsuleId` contract pattern rather than
 * re-deriving traversal rules: the pattern's character class already excludes
 * `/`, `\`, and leading `.`, so `..`, absolute forms, embedded separators, and
 * percent-encoded traversal (`%2e%2e` contains `%`, which the pattern forbids)
 * are all rejected by the same check that validates every other capsule ID.
 */
export function resolveCapsuleDir(
  layout: VaultLayout,
  namespace: string,
  slug: string,
): Result<string> {
  const idResult = parseCapsuleId(`${namespace}/${slug}`, "/namespace+slug");
  if (!idResult.ok) return idResult;
  const parts = capsuleIdParts(idResult.value);
  return containedPath(
    layout.root,
    join(layout.capsulesDir, parts.namespace, parts.slug),
  );
}

export function resolveCapsuleDraftsDir(
  layout: VaultLayout,
  namespace: string,
  slug: string,
): Result<string> {
  const capsuleDir = resolveCapsuleDir(layout, namespace, slug);
  if (!capsuleDir.ok) return capsuleDir;
  return containedPath(layout.root, join(capsuleDir.value, "drafts"));
}

export function resolveCapsuleDraftDir(
  layout: VaultLayout,
  namespace: string,
  slug: string,
  draftId: string,
): Result<string> {
  const draftsDir = resolveCapsuleDraftsDir(layout, namespace, slug);
  if (!draftsDir.ok) return draftsDir;
  const draftIdResult = parseLocalId(draftId, "/draftId");
  if (!draftIdResult.ok) return draftIdResult;
  return containedPath(layout.root, join(draftsDir.value, draftIdResult.value));
}

export function resolveCapsuleVersionsDir(
  layout: VaultLayout,
  namespace: string,
  slug: string,
): Result<string> {
  const capsuleDir = resolveCapsuleDir(layout, namespace, slug);
  if (!capsuleDir.ok) return capsuleDir;
  return containedPath(layout.root, join(capsuleDir.value, "versions"));
}

/**
 * The digest folder uses only the hex payload, never the `sha256:` prefixed
 * form: a literal `:` is invalid in an NTFS/FAT filename, and a digest-named
 * directory containing one would make the published version unreadable on
 * Windows. `ARCHITECTURE.md`'s `<digest>` placeholder is the content digest,
 * not its serialized string form.
 */
export function resolveCapsuleVersionDir(
  layout: VaultLayout,
  namespace: string,
  slug: string,
  version: string,
  digest: string,
): Result<string> {
  const versionsDir = resolveCapsuleVersionsDir(layout, namespace, slug);
  if (!versionsDir.ok) return versionsDir;
  const semverResult = parseSemver(version, "/version");
  if (!semverResult.ok) return semverResult;
  const digestResult = parseDigest(digest, "/digest");
  if (!digestResult.ok) return digestResult;
  return containedPath(
    layout.root,
    join(versionsDir.value, semverResult.value, digestHex(digestResult.value)),
  );
}

/** Untrusted `source-id` (opaque, capsule-lineage-scoped local identifier). */
export function resolveSourceDir(layout: VaultLayout, sourceId: string): Result<string> {
  const idResult = parseLocalId(sourceId, "/sourceId");
  if (!idResult.ok) return idResult;
  return containedPath(layout.root, join(layout.sourcesDir, idResult.value));
}

/** Untrusted `run-id` (opaque, per-research-run identifier). */
export function resolveArtifactRunDir(layout: VaultLayout, runId: string): Result<string> {
  const idResult = parseLocalId(runId, "/runId");
  if (!idResult.ok) return idResult;
  return containedPath(layout.root, join(layout.artifactsDir, idResult.value));
}

/** True when `candidate` is a bare, safe, single path segment on its own. */
export function isSafePathSegment(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (isAbsolute(candidate)) return false;
  return parseLocalId(candidate).ok;
}
