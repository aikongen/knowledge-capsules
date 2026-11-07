import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { AcquisitionCancelledError, AcquisitionDeniedError, AcquisitionFailedError } from "./errors.ts";
import type { ArtifactSink } from "./types.ts";

/**
 * Stores flat, content-addressed logical artifacts beneath an owner-managed
 * 0700 directory. The directory itself is admitted before every write and may
 * not be a symlink. Node has no descriptor-relative open/link APIs, therefore
 * this does not defend against a malicious same-user process replacing the
 * configured root after admission; callers must provide a stable private root.
 */
export class AtomicDirectoryArtifactSink implements ArtifactSink {
  readonly #root: string;
  readonly #beforeCommit: (() => void | Promise<void>) | undefined;

  constructor(root: string, options: AtomicDirectoryArtifactSinkOptions = {}) {
    this.#root = resolve(root);
    this.#beforeCommit = options.beforeCommit;
  }

  async put(relativePath: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    if (
      isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      relativePath.split("/").includes("..")
    ) {
      throw new AcquisitionDeniedError("path_denied", "artifact_path_denied", "unsafe artifact path");
    }
    throwIfAborted(signal);
    const canonicalRoot = await admittedRoot(this.#root, signal);
    // Do not traverse relative-path parents after admission. A deterministic
    // flat object filename keeps every write and link directly beneath root.
    const target = join(canonicalRoot, artifactObjectName(relativePath));
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await settleWithinSignal(writeFile(temporary, bytes, { flag: "wx", mode: 0o600 }), signal, async () => {
        await unlink(temporary).catch(() => undefined);
      });
      throwIfAborted(signal);
      await settleWithinSignal(Promise.resolve(this.#beforeCommit?.()), signal);
      throwIfAborted(signal);
      try {
        await settleWithinSignal(link(temporary, target), signal, async () => {
          // A successful late link belongs to this invocation, so remove it.
          await unlink(target).catch(() => undefined);
        });
      } catch (error) {
        if (!isDestinationConflict(error)) throw error;
        if (!(await existingArtifactMatches(target, bytes, signal))) {
          throw new AcquisitionFailedError("artifact_conflict", "artifact path already contains different bytes");
        }
      }
      throwIfAborted(signal);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return relative(canonicalRoot, target).replaceAll("\\", "/");
  }
}

export interface AtomicDirectoryArtifactSinkOptions {
  /** Test seam used to prove callers cannot redirect a nested logical path. */
  readonly beforeCommit?: () => void | Promise<void>;
}

function artifactObjectName(relativePath: string): string {
  return `.kc-artifact-${createHash("sha256").update(relativePath).digest("hex")}`;
}

function isDestinationConflict(error: unknown): boolean {
  if (!(typeof error === "object" && error !== null && "code" in error)) return false;
  // Windows reports an existing hard-link target as EPERM on some supported filesystems.
  return error.code === "EEXIST" || error.code === "EPERM";
}

async function existingArtifactMatches(target: string, bytes: Uint8Array, signal?: AbortSignal): Promise<boolean> {
  const metadata = await settleWithinSignal(lstat(target).catch(() => null), signal);
  if (
    metadata === null ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size !== bytes.byteLength
  ) {
    return false;
  }
  const existing = await settleWithinSignal(readFile(target), signal);
  return Buffer.from(existing).equals(Buffer.from(bytes));
}

export class MemoryArtifactSink implements ArtifactSink {
  readonly artifacts = new Map<string, Uint8Array>();

  async put(relativePath: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    this.artifacts.set(relativePath, bytes.slice());
    return relativePath;
  }
}

async function admittedRoot(root: string, signal?: AbortSignal): Promise<string> {
  await settleWithinSignal(mkdir(root, { recursive: true, mode: 0o700 }), signal);
  const metadata = await settleWithinSignal(lstat(root), signal);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new AcquisitionDeniedError("path_denied", "artifact_root_denied", "artifact root must be a real directory");
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    throw new AcquisitionDeniedError(
      "path_denied",
      "artifact_root_permissions",
      "artifact root must have mode 0700",
    );
  }
  const expectedUid = process.getuid?.();
  if (expectedUid !== undefined && metadata.uid !== expectedUid) {
    throw new AcquisitionDeniedError("path_denied", "artifact_root_owner", "artifact root must be owned by this user");
  }
  return await settleWithinSignal(realpath(root), signal);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new AcquisitionCancelledError();
}

/**
 * Filesystem operations are not cancellable. Keep their late rejection
 * observed, and clean up a late successful temporary write/link where safe.
 */
async function settleWithinSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onLateResolution?: (value: T) => Promise<void>,
): Promise<T> {
  if (!signal) return await operation;
  if (signal.aborted) {
    void operation.then(
      async (value) => await onLateResolution?.(value),
      () => undefined,
    ).catch(() => undefined);
    throwIfAborted(signal);
  }
  let settled = false;
  let onAbort: (() => void) | undefined;
  const observed = operation.then(
    async (value) => {
      if (settled) await onLateResolution?.(value);
      return value;
    },
    (error: unknown) => {
      throw error;
    },
  );
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new AcquisitionCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([observed, aborted]);
  } finally {
    settled = true;
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
