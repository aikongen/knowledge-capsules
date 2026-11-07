export type AcquisitionKind = "http" | "file" | "git";
export type AcquisitionStatus = "retrieved" | "blocked" | "failed" | "cancelled";
export type AcquisitionBlockReason =
  | "scheme_not_allowed"
  | "private_network_denied"
  | "redirect_policy"
  | "size_limit"
  | "mime_denied"
  | "path_denied"
  | "license_policy"
  | "classification_policy"
  | "other";

export interface AcquisitionLocator {
  readonly uri?: string;
  readonly path?: string;
  readonly repository?: string;
  readonly commit?: string;
  readonly subpath?: string;
}

export interface AcquisitionPolicy {
  readonly allowedSchemes: readonly ("https" | "http" | "file" | "git")[];
  readonly allowPrivateNetwork: boolean;
  readonly maxRedirects: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly allowedMimeTypes?: readonly string[];
  readonly classification?: "public" | "internal" | "confidential" | "restricted";
}

export interface AcquisitionRequest {
  readonly id: string;
  readonly researchRunId?: string;
  readonly candidateId?: string;
  readonly requestedAt: string;
  readonly kind: AcquisitionKind;
  readonly locator: AcquisitionLocator;
  readonly policy: AcquisitionPolicy;
}

export interface StableLocator {
  readonly commit?: string;
  readonly path?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly section?: string;
  readonly selector?: string;
}

export interface AcquisitionOutcome {
  readonly status: AcquisitionStatus;
  readonly completedAt: string;
  readonly redirectCount: number;
  readonly finalUri?: string;
  readonly httpStatus?: number;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly contentDigest?: string;
  readonly localArtifactPath?: string;
  readonly sourceId?: string;
  readonly stableLocator?: StableLocator;
  readonly blockReason?: AcquisitionBlockReason;
  readonly errorCode?: string;
  readonly notes?: string;
}

export interface AcquisitionRecord extends AcquisitionRequest {
  readonly outcome: AcquisitionOutcome;
}

export interface AcquisitionResult {
  readonly record: AcquisitionRecord;
  readonly bytes?: Uint8Array;
}

export interface Clock {
  now(): Date;
}

export interface ArtifactSink {
  /**
   * Persist bytes only while the acquisition remains admitted. Implementations
   * must not turn an aborted write into a successful artifact.
   */
  put(relativePath: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string>;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface HostResolver {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>;
}

export interface HttpResponseStream {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export interface HttpTransport {
  request(
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<HttpResponseStream>;
}

export interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cleanup: "not-required" | "confirmed" | "unknown";
  /** Process launch disposition; no raw OS diagnostic is persisted here. */
  readonly launch?: "started" | "unavailable" | "failed";
  /** The runner stopped reading because stdout exceeded its bounded limit. */
  readonly stdoutOverflow?: boolean;
}

export interface CommandRunner {
  /**
   * The runner owns its child process tree and must honor `signal`, including
   * reaping descendants before it settles. The gateway can bound an injected
   * runner that ignores cancellation, but cannot clean up a process it does
   * not own.
   */
  run(
    executable: string,
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    maxStdoutBytes: number,
    signal?: AbortSignal,
  ): Promise<CommandResult>;
}

export interface SourceGatewayLimits {
  readonly maxRequestBytes?: number;
  readonly maxRequestTimeoutMs?: number;
}
