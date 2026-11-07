/**
 * The shared error envelope every interface returns.
 *
 * `contracts/README.md` requires "a shared machine code plus human message and
 * structured details" across UI, CLI, MCP, SDK and HTTP. Codes are a closed set
 * so callers can branch on them without parsing prose, and so a rename shows up
 * as a type error rather than as a silently dead `catch` branch.
 */
export const ERROR_CODES = [
  "validation_failed",
  "not_found",
  "conflict",
  "immutable_version",
  "digest_mismatch",
  "unsupported_schema_version",
  "archive_rejected",
  "policy_denied",
  "unauthorized",
  "vault_locked",
  "vault_not_found",
  "cancelled",
  "timeout",
  "runtime_unavailable",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  /** JSON Pointer, file path, or field name the problem attaches to. */
  readonly at?: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: readonly ErrorDetail[];
  /** Present when the failure happened inside a traced operation. */
  readonly traceId?: string;
  readonly retryable: boolean;
}

export class KcError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[];
  readonly retryable: boolean;
  readonly traceId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: readonly ErrorDetail[];
      retryable?: boolean;
      traceId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "KcError";
    this.code = code;
    this.details = options.details ?? [];
    this.retryable = options.retryable ?? false;
    if (options.traceId !== undefined) this.traceId = options.traceId;
  }

  /**
   * Attach the underlying failure to an error that was already built.
   *
   * Rule violations are constructed by helpers that know the rule but not what
   * threw, so the cause has to be added afterwards. Losing it would leave a
   * rejected capsule reported only as "could not be decompressed" with no way
   * to tell a corrupt archive from a bug in the reader.
   */
  withCause(cause: unknown): this {
    this.cause = cause;
    return this;
  }

  toEnvelope(): ErrorEnvelope {
    const envelope: {
      code: ErrorCode;
      message: string;
      details: readonly ErrorDetail[];
      retryable: boolean;
      traceId?: string;
    } = {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
    if (this.traceId !== undefined) envelope.traceId = this.traceId;
    return envelope;
  }
}

export function isKcError(value: unknown): value is KcError {
  return value instanceof KcError;
}
