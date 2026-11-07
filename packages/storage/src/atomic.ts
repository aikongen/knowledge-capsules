import { randomBytes } from "node:crypto";
import { link, mkdir, open, rename, rm, readdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { KcError } from "@kc/contracts";
import { err, ok, type Result } from "@kc/domain";

/** Marker prefix used by every staging artifact this module creates. */
const STAGING_MARKER = ".kc-tmp-";

function stagingName(finalName: string): string {
  return `${STAGING_MARKER}${finalName}.${randomBytes(8).toString("hex")}`;
}

function isStagingEntry(entry: string): boolean {
  return entry.startsWith(STAGING_MARKER) && entry.length > STAGING_MARKER.length && basename(entry) === entry;
}

/**
 * Stable staging entry for an operation whose final target is already known.
 * Recovery must receive this exact entry; it never sweeps by prefix.
 */
export function stagingEntryForTarget(targetPath: string): string {
  return `${STAGING_MARKER}${basename(targetPath)}`;
}

function toInternalError(operation: string, error: unknown): KcError {
  return new KcError("internal", `${operation} failed`, {
    details: [{ at: "/", message: String((error as Error).message ?? error) }],
  }).withCause(error);
}

function committedStateError(
  operation: string,
  targetPath: string,
  cause: unknown,
  details: Record<string, unknown> = {},
): KcError {
  return new KcError("internal", `${operation} committed but a post-commit step failed`, {
    retryable: true,
    details: [{
      at: targetPath,
      message: "retry the exact command; canonical bytes are already committed",
      canonicalCommitted: true,
      ...details,
    }],
    cause,
  });
}

function unsupportedCreateOnlyError(targetPath: string, cause: unknown): KcError {
  return new KcError("policy_denied", "filesystem does not support atomic create-only publication", {
    details: [{
      at: targetPath,
      message: `hard-link publication failed with ${(cause as NodeJS.ErrnoException).code ?? "an unknown error"}`,
    }],
    cause,
  });
}

function isUnsupportedCreateOnlyError(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException).code;
  return code === "EXDEV" || code === "ENOSYS" || code === "ENOTSUP" ||
    code === "EOPNOTSUPP" || code === "EPERM";
}

function isIgnorableFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  // Opening or syncing a directory is not supported on every platform.
  // Treat these explicit platform limitations as best effort; durability of
  // the directory entry remains unknown rather than being overclaimed.
  return code === "EISDIR" || code === "ENOSYS" || code === "EPERM";
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!isIgnorableFsyncError(error)) throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Write-temp-then-rename with `fsync` of the file and a best-effort parent
 * directory sync. The temp file lives beside the target so the final rename
 * stays on one filesystem, and a crash mid-write cannot expose a truncated
 * target.
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string | Uint8Array,
  options: { readonly mode?: number } = {},
): Promise<Result<void>> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, stagingName(basename(targetPath)));
  let handle: FileHandle | undefined;
  let stagingFailure: unknown;
  try {
    handle = await open(tempPath, "wx", options.mode ?? 0o644);
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    stagingFailure = error;
  } finally {
    await handle?.close();
  }
  if (stagingFailure !== undefined) {
    await rm(tempPath, { force: true });
    return err(toInternalError("writeFileAtomic: staging write", stagingFailure));
  }

  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    return err(toInternalError("writeFileAtomic: rename", error));
  }

  try {
    await fsyncDirectory(dir);
  } catch (error) {
    return err(committedStateError("writeFileAtomic", targetPath, error));
  }

  return ok(undefined);
}

/**
 * Writes immutable bytes without ever replacing an existing target. The final
 * same-filesystem hard-link is create-only: unlike rename it cannot silently
 * overwrite a receipt written by a competing process. Callers must inspect
 * an `already_exists` result and compare bytes themselves.
 */
export async function writeFileCreateOnlyAtomic(
  targetPath: string,
  data: string | Uint8Array,
  options: { readonly mode?: number } = {},
): Promise<Result<"created" | "already_exists">> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, stagingName(basename(targetPath)));
  let handle: FileHandle | undefined;
  let stagingFailure: unknown;
  try {
    handle = await open(tempPath, "wx", options.mode ?? 0o644);
    await handle.writeFile(data);
    await handle.sync();
  } catch (cause) {
    stagingFailure = cause;
  } finally {
    await handle?.close();
  }
  if (stagingFailure !== undefined) {
    await rm(tempPath, { force: true });
    return err(toInternalError("writeFileCreateOnlyAtomic: staging write", stagingFailure));
  }
  try {
    await link(tempPath, targetPath);
  } catch (cause) {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupCause) {
      return err(
        new KcError("internal", "create-only publication failed and left staging residue", {
          retryable: true,
          details: [{
            at: tempPath,
            message: "remove the staging file before retrying",
            targetAlreadyExists: (cause as NodeJS.ErrnoException).code === "EEXIST",
          }],
          cause: new AggregateError([cause, cleanupCause]),
        }),
      );
    }
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return ok("already_exists");
    if (isUnsupportedCreateOnlyError(cause)) {
      return err(unsupportedCreateOnlyError(targetPath, cause));
    }
    return err(toInternalError("writeFileCreateOnlyAtomic: create-only link", cause));
  }
  let cleanupFailure: unknown;
  try {
    await rm(tempPath, { force: true });
  } catch (cause) {
    cleanupFailure = cause;
  }
  let syncFailure: unknown;
  try {
    await fsyncDirectory(dir);
  } catch (cause) {
    syncFailure = cause;
  }
  if (cleanupFailure !== undefined || syncFailure !== undefined) {
    const causes = [cleanupFailure, syncFailure].filter((cause) => cause !== undefined);
    return err(committedStateError(
      "writeFileCreateOnlyAtomic",
      targetPath,
      causes.length === 1 ? causes[0] : new AggregateError(causes),
      cleanupFailure === undefined ? {} : { stagingResidue: tempPath },
    ));
  }
  return ok("created");
}

export async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
  options: { readonly mode?: number } = {},
): Promise<Result<void>> {
  return writeFileAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * Stage a whole directory tree under a hidden sibling, then rename it into
 * place with one atomic operation. Publication writes many files (a capsule
 * version's manifest, canonical text, evidence, index); observing it
 * half-written would leak a partial version, so `stage` receives the
 * temporary directory and must have finished writing before this resolves.
 */
export async function publishDirectoryAtomic(
  targetPath: string,
  stage: (stagingDir: string) => Promise<void>,
  options: { readonly stagingEntry?: string } = {},
): Promise<Result<void>> {
  const dir = dirname(targetPath);
  const stagingEntry = options.stagingEntry ?? stagingName(basename(targetPath));
  if (!isStagingEntry(stagingEntry)) {
    return err(
      new KcError("validation_failed", "staging entry must be a hidden single path segment", {
        details: [{ at: "/stagingEntry", message: stagingEntry }],
      }),
    );
  }
  const stagingDir = join(dir, stagingEntry);
  let stagingCreated = false;

  try {
    await mkdir(dir, { recursive: true });
    await mkdir(stagingDir);
    stagingCreated = true;
    await stage(stagingDir);
  } catch (error) {
    if (stagingCreated) await rm(stagingDir, { recursive: true, force: true });
    return err(toInternalError("publishDirectoryAtomic: staging", error));
  }

  try {
    await rename(stagingDir, targetPath);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    return err(toInternalError("publishDirectoryAtomic: rename", error));
  }

  try {
    await fsyncDirectory(dir);
  } catch (error) {
    return err(committedStateError("publishDirectoryAtomic", targetPath, error));
  }

  return ok(undefined);
}

/**
 * Removes only exact staging entries owned by the caller's operation. Any
 * other marker-prefixed entry fails closed before deletion, because a prefix
 * alone cannot prove that it belongs to this process rather than user data or
 * a concurrent writer.
 */
export async function recoverStaleStaging(
  directory: string,
  operationOwnedEntries: readonly string[],
): Promise<Result<readonly string[]>> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return ok([]);
    return err(toInternalError("recoverStaleStaging: readdir", error));
  }

  const expected = new Set(operationOwnedEntries);
  const stagingEntries = entries.filter((entry) => entry.startsWith(STAGING_MARKER));
  const unknown = stagingEntries.find((entry) => !expected.has(entry));
  if (unknown !== undefined) {
    return err(
      new KcError("policy_denied", "unrecognized staging entry requires explicit recovery", {
        details: [{ at: join(directory, unknown), message: "staging entry is not owned by this operation" }],
      }),
    );
  }

  const removed: string[] = [];
  for (const entry of stagingEntries) {
    const path = join(directory, entry);
    try {
      await rm(path, { recursive: true, force: true });
      removed.push(entry);
    } catch (error) {
      return err(toInternalError(`recoverStaleStaging: rm ${entry}`, error));
    }
  }
  return ok(removed);
}
