import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { sharedValidator } from "@kc/contracts";
import {
  ByteCollectorDeniedError,
  ByteCollectorFailedError,
  collectBoundedBytes,
} from "./collect-bounded-bytes.ts";

import {
  AcquisitionCancelledError,
  AcquisitionDeniedError,
  AcquisitionFailedError,
  AcquisitionProgressError,
} from "./errors.ts";
import { resolveAllowedAddress, SystemHostResolver } from "./network-policy.ts";
import { PinnedHttpTransport } from "./http-transport.ts";
import { SpawnCommandRunner } from "./command-runner.ts";
import type {
  AcquisitionOutcome,
  AcquisitionRecord,
  AcquisitionRequest,
  AcquisitionResult,
  ArtifactSink,
  Clock,
  CommandRunner,
  HostResolver,
  HttpTransport,
  SourceGatewayLimits,
} from "./types.ts";

const EXACT_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_GIT_PATH = /^(?![\\/])(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).+$/u;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const STABLE_ERROR_CODE = /^[a-z][a-z0-9_]{0,79}$/u;
const MAX_OUTCOME_NOTE_LENGTH = 280;
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_TIMEOUT_MS = 60_000;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactPath(request: AcquisitionRequest, contentDigest: string): string {
  return `sources/${request.id}/${contentDigest.slice("sha256:".length)}.bin`;
}

function containedPath(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function mimeAllowed(mimeType: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowed.some((candidate) => candidate.toLowerCase() === normalized);
}

async function collectHttpBodyBytes(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    return await collectBoundedBytes(body, maxBytes, signal);
  } catch (error) {
    if (error instanceof ByteCollectorDeniedError) {
      throw new AcquisitionDeniedError(error.blockReason, error.errorCode, error.message);
    }
    if (error instanceof ByteCollectorFailedError) {
      throw new AcquisitionFailedError(error.errorCode, error.message);
    }
    throw error;
  }
}

export interface SourceGatewayOptions extends SourceGatewayLimits {
  readonly sink: ArtifactSink;
  readonly fileRoots: readonly string[];
  readonly gitRoots: readonly string[];
  readonly clock?: Clock;
  readonly resolver?: HostResolver;
  readonly transport?: HttpTransport;
  readonly commands?: CommandRunner;
  /** Injection seam for deterministic platform-policy tests. */
  readonly platform?: NodeJS.Platform;
}

export class SourceAcquisitionGateway {
  readonly #sink: ArtifactSink;
  readonly #fileRoots: readonly string[];
  readonly #gitRoots: readonly string[];
  readonly #clock: Clock;
  readonly #resolver: HostResolver;
  readonly #transport: HttpTransport;
  readonly #commands: CommandRunner;
  readonly #platform: NodeJS.Platform;
  readonly #maxRequestBytes: number;
  readonly #maxRequestTimeoutMs: number;

  constructor(options: SourceGatewayOptions) {
    this.#sink = options.sink;
    this.#fileRoots = options.fileRoots.map((root) => resolve(root));
    this.#gitRoots = options.gitRoots.map((root) => resolve(root));
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#resolver = options.resolver ?? new SystemHostResolver();
    this.#transport = options.transport ?? new PinnedHttpTransport();
    this.#commands = options.commands ?? new SpawnCommandRunner();
    this.#platform = options.platform ?? process.platform;
    this.#maxRequestBytes = validatedGatewayLimit(
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      "maxRequestBytes",
    );
    this.#maxRequestTimeoutMs = validatedGatewayLimit(
      options.maxRequestTimeoutMs ?? DEFAULT_MAX_REQUEST_TIMEOUT_MS,
      "maxRequestTimeoutMs",
    );
  }

  async acquire(request: AcquisitionRequest, signal?: AbortSignal): Promise<AcquisitionResult> {
    assertAcquisitionRequest(request);
    // The capped deadline is only a construction guard; policy admission below
    // rejects an oversized caller request before provider work begins.
    const deadline = deadlineSignal(Math.min(request.policy.timeoutMs, this.#maxRequestTimeoutMs), signal);
    try {
      this.#assertGatewayPolicyLimits(request);
      if (deadline.signal.aborted) throw deadline.reason();
      const result =
        request.kind === "http"
          ? await this.#http(request, deadline)
          : request.kind === "file"
            ? await this.#file(request, deadline)
            : await this.#git(request, deadline);
      sharedValidator().assert<AcquisitionRecord>("sourceAcquisition", result.record, "acquisition record");
      return result;
    } catch (error) {
      const originalFailure = error instanceof AcquisitionProgressError ? error.failure : error;
      const failure = deadline.signal.aborted ? deadline.reason() : originalFailure;
      const redirectCount = error instanceof AcquisitionProgressError ? error.redirectCount : 0;
      const finalUri = error instanceof AcquisitionProgressError ? error.finalUri : undefined;
      const outcome: AcquisitionOutcome =
        failure instanceof AcquisitionCancelledError
          ? {
              status: "cancelled",
              completedAt: this.#clock.now().toISOString(),
              redirectCount,
              ...(finalUri === undefined ? {} : { finalUri }),
              errorCode: "cancelled",
            }
          : failure instanceof AcquisitionDeniedError
            ? {
                status: "blocked",
                completedAt: this.#clock.now().toISOString(),
                redirectCount,
                ...(finalUri === undefined ? {} : { finalUri }),
                blockReason: failure.blockReason,
                errorCode: safeErrorCode(failure.errorCode, "acquisition_denied"),
                notes: safeOutcomeNote(failure.message, "source acquisition denied"),
              }
            : {
                status: "failed",
                completedAt: this.#clock.now().toISOString(),
                redirectCount,
                ...(finalUri === undefined ? {} : { finalUri }),
                errorCode: failure instanceof AcquisitionFailedError
                  ? safeErrorCode(failure.errorCode, "acquisition_failed")
                  : "acquisition_failed",
                notes: safeFailureNote(failure),
              };
      const record = { ...request, outcome } satisfies AcquisitionRecord;
      sharedValidator().assert<AcquisitionRecord>("sourceAcquisition", record, "acquisition record");
      return { record };
    } finally {
      deadline.dispose();
    }
  }

  async #http(request: AcquisitionRequest, deadline: Deadline): Promise<AcquisitionResult> {
    if (!request.locator.uri) {
      throw new AcquisitionFailedError("missing_uri", "HTTP acquisition requires locator.uri");
    }
    let url = new URL(request.locator.uri);
    let redirects = 0;
    try {
      while (true) {
        try {
          const address = await deadline.race(
            resolveAllowedAddress(url, request.policy, this.#resolver, deadline.signal),
          );
          const response = await deadline.race(
            this.#transport.request(url, address, deadline.remainingMs(), deadline.signal),
            async (lateResponse) => {
              cancelResponse(lateResponse);
            },
          );
          if (REDIRECT_STATUSES.has(response.status)) {
            cancelResponse(response);
            const location = response.headers.location;
            if (!location || redirects >= request.policy.maxRedirects) {
              throw new AcquisitionDeniedError("redirect_policy", "redirect_limit", "redirect policy denied source");
            }
            url = new URL(location, url);
            redirects += 1;
            continue;
          }
          try {
            if (response.status < 200 || response.status >= 300) {
              throw new AcquisitionFailedError("http_status", `HTTP source returned ${response.status}`);
            }
            const encoding = response.headers["content-encoding"]?.toLowerCase() ?? "identity";
            if (encoding !== "identity") {
              throw new AcquisitionDeniedError(
                "size_limit",
                "encoded_response_denied",
                "encoded responses are denied because decompressed size cannot be bounded",
              );
            }
            const declaredLength = Number(response.headers["content-length"] ?? "0");
            if (Number.isFinite(declaredLength) && declaredLength > request.policy.maxBytes) {
              throw new AcquisitionDeniedError("size_limit", "content_length_too_large", "source exceeds byte limit");
            }
            const mimeType = response.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "application/octet-stream";
            if (!mimeAllowed(mimeType, request.policy.allowedMimeTypes)) {
              throw new AcquisitionDeniedError("mime_denied", "mime_denied", `MIME type ${mimeType} is denied`);
            }
            const bytes = await collectHttpBodyBytes(response.body, request.policy.maxBytes, deadline.signal);
            const contentDigest = digest(bytes);
            const localArtifactPath = await deadline.race(
              this.#sink.put(artifactPath(request, contentDigest), bytes, deadline.signal),
            );
            const record: AcquisitionRecord = {
              ...request,
              outcome: {
                status: "retrieved",
                completedAt: this.#clock.now().toISOString(),
                redirectCount: redirects,
                finalUri: url.toString(),
                httpStatus: response.status,
                mimeType,
                byteLength: bytes.byteLength,
                contentDigest,
                localArtifactPath,
                ...(request.candidateId === undefined ? {} : { sourceId: request.candidateId }),
                stableLocator: { selector: contentDigest },
              },
            };
            return { record, bytes };
          } finally {
            cancelResponse(response);
          }
        } catch (error) {
          throw new AcquisitionProgressError(asSourceAvailabilityFailure(error), redirects, url.toString());
        }
      }
    } finally {
      // The caller owns the single acquisition deadline.
    }
  }

  async #file(request: AcquisitionRequest, deadline: Deadline): Promise<AcquisitionResult> {
    if (!request.policy.allowedSchemes.includes("file")) {
      throw new AcquisitionDeniedError("scheme_not_allowed", "file_scheme_denied", "file acquisition is denied");
    }
    if (!request.locator.path) {
      throw new AcquisitionFailedError("missing_path", "file acquisition requires locator.path");
    }
    try {
      const target = await deadline.race(realpath(resolve(request.locator.path)));
      const root = await this.#matchingRoot(target, this.#fileRoots, deadline);
      const file = await deadline.race(
        open(target, constants.O_RDONLY | constants.O_NOFOLLOW),
        async (lateFile) => await lateFile.close().catch(() => undefined),
      );
      let bytes: Uint8Array;
      try {
        const metadata = await deadline.race(file.stat());
        if (!metadata.isFile()) {
          throw new AcquisitionDeniedError("path_denied", "not_regular_file", "source path is not a regular file");
        }
        if (metadata.size > request.policy.maxBytes) {
          throw new AcquisitionDeniedError("size_limit", "file_too_large", "source exceeds byte limit");
        }
        const currentTarget = await deadline.race(realpath(target));
        const currentMetadata = await deadline.race(stat(currentTarget));
        if (
          !containedPath(root, currentTarget) ||
          currentMetadata.dev !== metadata.dev ||
          currentMetadata.ino !== metadata.ino
        ) {
          throw new AcquisitionDeniedError("path_denied", "file_changed", "source path changed during acquisition");
        }
        bytes = await readBoundedFile(file, request.policy.maxBytes, deadline);
      } catch (error) {
        if (deadline.signal.aborted) throw deadline.reason();
        throw error;
      } finally {
        await deadline.race(file.close());
      }
      const mimeType = MIME_BY_EXTENSION[extname(target).toLowerCase()] ?? "application/octet-stream";
      if (!mimeAllowed(mimeType, request.policy.allowedMimeTypes)) {
        throw new AcquisitionDeniedError("mime_denied", "mime_denied", `MIME type ${mimeType} is denied`);
      }
      return await this.#retrieved(request, bytes, mimeType, {
        path: relative(root, target).replaceAll(sep, "/"),
      }, deadline);
    } finally {
      // The caller owns the single acquisition deadline.
    }
  }

  async #git(request: AcquisitionRequest, deadline: Deadline): Promise<AcquisitionResult> {
    if (!request.policy.allowedSchemes.includes("git")) {
      throw new AcquisitionDeniedError("scheme_not_allowed", "git_scheme_denied", "Git acquisition is denied");
    }
    const { repository, commit, subpath } = request.locator;
    if (!repository || !commit || !subpath) {
      throw new AcquisitionFailedError("missing_git_locator", "Git acquisition requires repository, commit, and subpath");
    }
    if (!EXACT_COMMIT.test(commit)) {
      throw new AcquisitionDeniedError("path_denied", "non_exact_commit", "Git object ID must be a full SHA-1 or SHA-256 object ID");
    }
    if (!SAFE_GIT_PATH.test(subpath)) {
      throw new AcquisitionDeniedError("path_denied", "unsafe_git_path", "Git subpath is unsafe");
    }
    if (this.#platform === "win32") {
      // SpawnCommandRunner cannot yet prove Windows descendant cleanup. This is
      // an environment capability gap, not an unsafe repository path.
      throw new AcquisitionFailedError(
        "source_unavailable",
        "Git acquisition is disabled until Windows process-tree cleanup is available",
      );
    }
    try {
    const repositoryPath = await deadline.race(realpath(resolve(repository)));
    await this.#matchingRoot(repositoryPath, this.#gitRoots, deadline);
    const verified = await deadline.race(this.#commands.run(
      "git",
      ["rev-parse", "--verify", `${commit}^{commit}`],
      repositoryPath,
      deadline.remainingMs(),
      256,
      deadline.signal,
    ));
    this.#assertGitCommand(verified, "commit probe");
    if (verified.code !== 0 || new TextDecoder().decode(verified.stdout).trim() !== commit) {
      throw new AcquisitionFailedError("commit_unavailable", "exact Git commit is unavailable");
    }
    const sizeResult = await deadline.race(this.#commands.run(
      "git",
      ["cat-file", "-s", `${commit}:${subpath}`],
      repositoryPath,
      deadline.remainingMs(),
      128,
      deadline.signal,
    ));
    this.#assertGitCommand(sizeResult, "size probe");
    const size = Number(new TextDecoder().decode(sizeResult.stdout).trim());
    if (sizeResult.code !== 0 || !Number.isSafeInteger(size) || size < 0) {
      throw new AcquisitionFailedError("git_object_unavailable", "Git object is unavailable");
    }
    if (size > request.policy.maxBytes) {
      throw new AcquisitionDeniedError("size_limit", "git_object_too_large", "Git object exceeds byte limit");
    }
    const content = await deadline.race(this.#commands.run(
      "git",
      ["show", `${commit}:${subpath}`],
      repositoryPath,
      deadline.remainingMs(),
      request.policy.maxBytes,
      deadline.signal,
    ));
    this.#assertGitCommand(content, "read");
    if (content.code !== 0) throw new AcquisitionFailedError("git_read_failed", "Git object read failed");
    const mimeType = MIME_BY_EXTENSION[extname(subpath).toLowerCase()] ?? "application/octet-stream";
    if (!mimeAllowed(mimeType, request.policy.allowedMimeTypes)) {
      throw new AcquisitionDeniedError("mime_denied", "mime_denied", `MIME type ${mimeType} is denied`);
    }
    return await this.#retrieved(request, content.stdout, mimeType, { commit, path: subpath }, deadline);
    } finally {
      // The caller owns the single acquisition deadline.
    }
  }

  async #matchingRoot(target: string, configuredRoots: readonly string[], deadline: Deadline): Promise<string> {
    for (const configured of configuredRoots) {
      const root = await deadline.race(realpath(configured).catch(() => null));
      if (root && containedPath(root, target)) return root;
    }
    throw new AcquisitionDeniedError("path_denied", "outside_allowed_roots", "source path is outside allowed roots");
  }

  async #retrieved(
    request: AcquisitionRequest,
    bytes: Uint8Array,
    mimeType: string,
    stableLocator: { readonly commit?: string; readonly path?: string },
    deadline: Deadline,
  ): Promise<AcquisitionResult> {
    const contentDigest = digest(bytes);
    const localArtifactPath = await deadline.race(
      this.#sink.put(artifactPath(request, contentDigest), bytes, deadline.signal),
    );
    const record: AcquisitionRecord = {
      ...request,
      outcome: {
        status: "retrieved",
        completedAt: this.#clock.now().toISOString(),
        redirectCount: 0,
        mimeType,
        byteLength: bytes.byteLength,
        contentDigest,
        localArtifactPath,
        ...(request.candidateId === undefined ? {} : { sourceId: request.candidateId }),
        stableLocator,
      },
    };
    return { record, bytes };
  }

  #assertGatewayPolicyLimits(request: AcquisitionRequest): void {
    if (request.policy.maxBytes > this.#maxRequestBytes) {
      throw new AcquisitionDeniedError(
        "size_limit",
        "max_bytes_exceeds_gateway_limit",
        "requested byte limit exceeds the gateway ceiling",
      );
    }
    if (request.policy.timeoutMs > this.#maxRequestTimeoutMs) {
      throw new AcquisitionDeniedError(
        "other",
        "timeout_exceeds_gateway_limit",
        "requested timeout exceeds the gateway ceiling",
      );
    }
  }

  #assertGitCommand(
    result: Awaited<ReturnType<CommandRunner["run"]>>,
    phase: "commit probe" | "size probe" | "read",
  ): void {
    if (result.timedOut) throw new AcquisitionFailedError("timeout", "Git acquisition timed out");
    if (result.cleanup === "unknown") {
      throw new AcquisitionFailedError("cleanup_failed", `Git ${phase} cleanup was not confirmed`);
    }
    if (result.launch === "unavailable" || result.launch === "failed") {
      throw new AcquisitionFailedError("source_unavailable", "Git executable is unavailable");
    }
    if (result.stdoutOverflow) {
      throw new AcquisitionFailedError("git_output_overflow", "Git command output exceeded its bounded limit");
    }
  }
}

function assertAcquisitionRequest(request: AcquisitionRequest): void {
  const placeholder: AcquisitionRecord = {
    ...request,
    outcome: {
      status: "failed",
      completedAt: request.requestedAt,
      redirectCount: 0,
      errorCode: "input_validation",
    },
  };
  sharedValidator().assert<AcquisitionRecord>(
    "sourceAcquisition",
    placeholder,
    "source acquisition request",
  );
  const locatorValid =
    (request.kind === "http" && request.locator.uri !== undefined) ||
    (request.kind === "file" && request.locator.path !== undefined) ||
    (request.kind === "git" &&
      request.locator.repository !== undefined &&
      request.locator.commit !== undefined &&
      request.locator.subpath !== undefined);
  if (!locatorValid) {
    throw new AcquisitionFailedError(
      "invalid_locator",
      `source acquisition kind ${request.kind} has an incompatible locator`,
    );
  }
}

interface Deadline {
  readonly signal: AbortSignal;
  remainingMs(): number;
  reason(): AcquisitionFailedError | AcquisitionCancelledError;
  race<T>(operation: Promise<T>, onLateResolution?: (value: T) => Promise<void>): Promise<T>;
  dispose(): void;
}

function deadlineSignal(timeoutMs: number, external?: AbortSignal): Deadline {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timeoutError = new AcquisitionFailedError("timeout", "source acquisition timed out");
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  timer.unref();
  const onAbort = (): void => {
    // External callers own cancellation semantics. Do not persist arbitrary
    // AbortSignal errors as failed acquisition notes.
    controller.abort(new AcquisitionCancelledError());
  };
  if (external?.aborted) onAbort();
  else external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    remainingMs: () => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        controller.abort(timeoutError);
        throw timeoutError;
      }
      return remaining;
    },
    reason: () =>
      controller.signal.reason instanceof AcquisitionFailedError ||
      controller.signal.reason instanceof AcquisitionCancelledError
        ? controller.signal.reason
        : new AcquisitionCancelledError(),
    race: async <T>(operation: Promise<T>, onLateResolution?: (value: T) => Promise<void>): Promise<T> => {
      if (controller.signal.aborted) {
        void operation.then(
          async (value) => await onLateResolution?.(value),
          () => undefined,
        ).catch(() => undefined);
        throw controller.signal.reason;
      }
      let settled = false;
      let onDeadlineAbort: (() => void) | undefined;
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
        onDeadlineAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onDeadlineAbort, { once: true });
      });
      try {
        return await Promise.race([observed, aborted]);
      } finally {
        settled = true;
        if (onDeadlineAbort !== undefined) controller.signal.removeEventListener("abort", onDeadlineAbort);
      }
    },
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function safeFailureNote(failure: unknown): string {
  return safeOutcomeNote(
    failure instanceof Error ? failure.message : undefined,
    "source acquisition failed",
  );
}

function asSourceAvailabilityFailure(error: unknown): unknown {
  if (
    error instanceof AcquisitionCancelledError ||
    error instanceof AcquisitionDeniedError ||
    error instanceof AcquisitionFailedError
  ) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EAI_AGAIN" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET" ||
      error.code === "EHOSTUNREACH" ||
      error.code === "ENETUNREACH" ||
      error.code === "ENOTFOUND" ||
      error.code === "ETIMEDOUT")
  ) {
    return new AcquisitionFailedError("source_unavailable", "source is temporarily unavailable");
  }
  return error;
}

function validatedGatewayLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function cancelResponse(response: { cancel(): void }): void {
  try {
    response.cancel();
  } catch {
    // Cancellation is cleanup only. A transport-owned cancel failure must not
    // replace the source's policy or retrieval result.
  }
}

function safeErrorCode(value: string, fallback: string): string {
  return STABLE_ERROR_CODE.test(value) ? value : fallback;
}

function safeOutcomeNote(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .replace(/[^\x20-\x7e]/gu, " ")
    .replace(/:\/\/[^\s/:@]+:[^\s@]+@/gu, "://[redacted]@")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/([?&](?:access_)?token|[?&](?:api_)?key|[?&](?:client_)?secret|[?&]password)=([^&#\s]+)/giu, "$1=[redacted]")
    .replace(/\b(?:access_?token|api_?key|client_?secret|password|secret|authorization)\s*[:=]\s*[^\s,;]+/giu, (match) => {
      const separator = match.indexOf(":") === -1 ? "=" : ":";
      return `${match.slice(0, match.indexOf(separator) + 1)}[redacted]`;
    })
    .replace(/\s+/gu, " ")
    .trim();
  const bounded = normalized.length > MAX_OUTCOME_NOTE_LENGTH
    ? `${normalized.slice(0, MAX_OUTCOME_NOTE_LENGTH - 3)}...`
    : normalized;
  return bounded === "" ? fallback : bounded;
}

async function readBoundedFile(
  file: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  deadline: Deadline,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    if (deadline.signal.aborted) throw deadline.reason();
    const capacity = Math.min(64 * 1024, maxBytes - total + 1);
    const buffer = new Uint8Array(capacity);
    const { bytesRead } = await deadline.race(file.read(buffer, 0, buffer.byteLength, null));
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) {
      throw new AcquisitionDeniedError("size_limit", "file_too_large", "source exceeds byte limit");
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
