import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "bun:test";

import { AtomicDirectoryArtifactSink, MemoryArtifactSink } from "../src/artifact-sink.ts";
import { AcquisitionDeniedError, AcquisitionFailedError } from "../src/errors.ts";
import { SourceAcquisitionGateway } from "../src/gateway.ts";
import type {
  AcquisitionRequest,
  ArtifactSink,
  CommandRunner,
  HostResolver,
  HttpResponseStream,
  HttpTransport,
} from "../src/types.ts";

const createdDirectories: string[] = [];
const clock = { now: () => new Date("2026-09-01T05:00:00.000Z") };
const publicResolver: HostResolver = {
  resolve: async (hostname) =>
    hostname === "private.test"
      ? [{ address: "127.0.0.1", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
};

function body(...chunks: string[]): AsyncIterable<Uint8Array> {
  return (async function* stream() {
    for (const chunk of chunks) yield new TextEncoder().encode(chunk);
  })();
}

function httpRequest(overrides: Partial<AcquisitionRequest> = {}): AcquisitionRequest {
  return {
    id: "acq-http-1",
    researchRunId: "run-1",
    candidateId: "candidate-1",
    requestedAt: "2026-09-01T04:59:00.000Z",
    kind: "http",
    locator: { uri: "https://example.test/source" },
    policy: {
      allowedSchemes: ["https"],
      allowPrivateNetwork: false,
      maxRedirects: 2,
      maxBytes: 32,
      timeoutMs: 1000,
      allowedMimeTypes: ["text/plain"],
      classification: "public",
    },
    ...overrides,
  };
}

class QueueTransport implements HttpTransport {
  readonly seen: string[] = [];
  readonly #responses: HttpResponseStream[];

  constructor(responses: HttpResponseStream[]) {
    this.#responses = responses;
  }

  async request(url: URL): Promise<HttpResponseStream> {
    this.seen.push(url.toString());
    const response = this.#responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  }
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true })));
});

describe("SourceAcquisitionGateway", () => {
  it("retrieves, hashes, stores, and validates a bounded HTTP source", async () => {
    const sink = new MemoryArtifactSink();
    const transport = new QueueTransport([
      { status: 200, headers: { "content-type": "text/plain", "content-length": "11" }, body: body("hello ", "world"), cancel: () => undefined },
    ]);
    const gateway = new SourceAcquisitionGateway({
      sink,
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    const result = await gateway.acquire(httpRequest());

    expect(result.record.outcome).toMatchObject({
      status: "retrieved",
      byteLength: 11,
      mimeType: "text/plain",
      sourceId: "candidate-1",
      contentDigest: "sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(sink.artifacts.size).toBe(1);
    expect(new TextDecoder().decode(result.bytes)).toBe("hello world");

    const standaloneGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([
        { status: 200, headers: { "content-type": "text/plain" }, body: body("standalone"), cancel: () => undefined },
      ]),
    });
    const standalone = await standaloneGateway.acquire(httpRequest({ candidateId: undefined }));
    expect(standalone.record.outcome).toMatchObject({ status: "retrieved" });
    expect(standalone.record.outcome.sourceId).toBeUndefined();
  });

  it("revalidates each redirect and blocks a private destination", async () => {
    let redirectCancelled = false;
    const transport = new QueueTransport([
      {
        status: 302,
        headers: { location: "https://private.test/secret" },
        body: body(),
        cancel: () => {
          redirectCancelled = true;
        },
      },
    ]);
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    const result = await gateway.acquire(httpRequest());

    expect(transport.seen).toEqual(["https://example.test/source"]);
    expect(redirectCancelled).toBe(true);
    expect(result.record.outcome).toMatchObject({
      status: "blocked",
      blockReason: "private_network_denied",
      redirectCount: 1,
      finalUri: "https://private.test/secret",
    });
    expect(result.record.outcome.sourceId).toBeUndefined();
  });

  it("enforces one absolute deadline across a drip-fed HTTP body", async () => {
    let cancelled = false;
    const slowBody = (async function* stream() {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield new TextEncoder().encode("x");
      }
    })();
    const transport = new QueueTransport([
      {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: slowBody,
        cancel: () => {
          cancelled = true;
        },
      },
    ]);
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    const result = await gateway.acquire(
      httpRequest({ policy: { ...httpRequest().policy, timeoutMs: 20, maxBytes: 10_000 } }),
    );

    expect(result.record.outcome).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(cancelled).toBe(true);
  });

  it("bounds DNS resolution by the acquisition deadline and absorbs a late resolver rejection", async () => {
    let rejectResolution: ((reason?: unknown) => void) | undefined;
    const unresolved = new Promise<readonly { address: string; family: 4 | 6 }[]>((_resolve, reject) => {
      rejectResolution = reject;
    });
    const resolver: HostResolver = { resolve: async () => await unresolved };
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver,
      transport: new QueueTransport([]),
    });
    const unhandled: unknown[] = [];
    const observeUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", observeUnhandled);
    const startedAt = Date.now();
    try {
      const result = await gateway.acquire(
        httpRequest({ policy: { ...httpRequest().policy, timeoutMs: 20 } }),
      );
      expect(Date.now() - startedAt).toBeLessThan(250);
      expect(result.record.outcome).toMatchObject({ status: "failed", errorCode: "timeout" });
      rejectResolution?.(new Error("late DNS failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", observeUnhandled);
    }
  });

  it("cancels a response that resolves after the acquisition deadline", async () => {
    let resolveResponse: ((response: HttpResponseStream) => void) | undefined;
    let lateResponseCancelled = false;
    const transport: HttpTransport = {
      request: async () => await new Promise<HttpResponseStream>((resolve) => {
        resolveResponse = resolve;
      }),
    };
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    const result = await gateway.acquire(httpRequest({ policy: { ...httpRequest().policy, timeoutMs: 10 } }));
    resolveResponse?.({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: body("late"),
      cancel: () => {
        lateResponseCancelled = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.record.outcome).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(lateResponseCancelled).toBe(true);
  });

  it("blocks oversized, disallowed MIME, and encoded HTTP responses", async () => {
    const responses: HttpResponseStream[] = [
      { status: 200, headers: { "content-type": "text/plain", "content-length": "99" }, body: body(), cancel: () => undefined },
      { status: 200, headers: { "content-type": "text/html" }, body: body("ok"), cancel: () => undefined },
      { status: 200, headers: { "content-type": "text/plain", "content-encoding": "gzip" }, body: body("gzip"), cancel: () => undefined },
    ];
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport(responses),
    });

    await expect(gateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "blocked", blockReason: "size_limit" } },
    });
    await expect(gateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "blocked", blockReason: "mime_denied" } },
    });
    await expect(gateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "blocked", errorCode: "encoded_response_denied" } },
    });
  });

  it("returns source_unavailable for DNS no-answer and recognized transport availability failures", async () => {
    const noAnswers: HostResolver = { resolve: async () => [] };
    const dnsGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: noAnswers,
      transport: new QueueTransport([]),
    });
    await expect(dnsGateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "failed", errorCode: "source_unavailable" } },
    });
    const transport: HttpTransport = {
      request: async () => {
        throw Object.assign(new Error("socket unreachable"), { code: "EHOSTUNREACH" });
      },
    };
    const transportGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });
    await expect(transportGateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "failed", errorCode: "source_unavailable" } },
    });
  });

  it("blocks a streaming HTTP body that exceeds maxBytes after a truthful Content-Length", async () => {
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([{
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "3" },
        body: body("ab", "cd"),
        cancel: () => undefined,
      }]),
    });
    await expect(
      gateway.acquire(httpRequest({ policy: { ...httpRequest().policy, maxBytes: 3 } })),
    ).resolves.toMatchObject({
      record: { outcome: { status: "blocked", blockReason: "size_limit", errorCode: "response_too_large" } },
    });
  });

  it("fails closed for invalid response chunks and ignores cancel cleanup failures", async () => {
    const invalidChunkGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([{
        status: 200,
        headers: { "content-type": "text/plain" },
        body: (async function* stream() { yield "not-bytes"; })() as unknown as AsyncIterable<Uint8Array>,
        cancel: () => undefined,
      }]),
    });
    await expect(invalidChunkGateway.acquire(httpRequest())).resolves.toMatchObject({
      record: { outcome: { status: "failed", errorCode: "invalid_response_chunk" } },
    });
    const cancelFailureGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([{
        status: 302,
        headers: {},
        body: body(),
        cancel: () => {
          throw new Error("cleanup failed");
        },
      }]),
    });
    await expect(cancelFailureGateway.acquire(httpRequest({
      policy: { ...httpRequest().policy, maxRedirects: 0 },
    }))).resolves.toMatchObject({
      record: { outcome: { status: "blocked", errorCode: "redirect_limit" } },
    });
  });

  it("enforces validated gateway request ceilings before acquisition work", async () => {
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([]),
      maxRequestBytes: 16,
      maxRequestTimeoutMs: 100,
    });
    await expect(gateway.acquire(httpRequest({ policy: { ...httpRequest().policy, maxBytes: 17 } }))).resolves.toMatchObject({
      record: { outcome: { status: "blocked", errorCode: "max_bytes_exceeds_gateway_limit" } },
    });
    await expect(gateway.acquire(httpRequest({ policy: { ...httpRequest().policy, maxBytes: 16, timeoutMs: 101 } }))).resolves.toMatchObject({
      record: { outcome: { status: "blocked", errorCode: "timeout_exceeds_gateway_limit" } },
    });
    expect(() => new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(), fileRoots: [], gitRoots: [], maxRequestBytes: 0,
    })).toThrow(RangeError);
  });

  it("normalizes untrusted resolver, transport, and injected sink failure receipts", async () => {
    const resolver = {
      resolve: async () => {
        throw new Error(`Bearer resolver-secret\u0000\n${"x".repeat(500)}`);
      },
    } satisfies HostResolver;
    const resolverGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver,
      transport: new QueueTransport([]),
    });
    const resolverResult = await resolverGateway.acquire(httpRequest());
    expect(resolverResult.record.outcome).toMatchObject({ status: "failed", errorCode: "acquisition_failed" });
    expect(resolverResult.record.outcome.notes).toContain("Bearer [redacted]");
    expect(resolverResult.record.outcome.notes).not.toContain("resolver-secret");
    expect([... (resolverResult.record.outcome.notes ?? "")].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })).toBe(false);
    expect(resolverResult.record.outcome.notes?.length).toBeLessThanOrEqual(280);

    const transport: HttpTransport = {
      request: async () => {
        throw new AcquisitionDeniedError(
          "other",
          "transport code\nwith-controls",
          "https://user:password@example.test/?api_key=transport-secret&token=other-secret",
        );
      },
    };
    const transportGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });
    const transportResult = await transportGateway.acquire(httpRequest());
    expect(transportResult.record.outcome).toMatchObject({ status: "blocked", errorCode: "acquisition_denied" });
    expect(transportResult.record.outcome.notes).not.toContain("password");
    expect(transportResult.record.outcome.notes).not.toContain("transport-secret");
    expect(transportResult.record.outcome.notes).not.toContain("other-secret");

    const sink: ArtifactSink = {
      put: async () => {
        throw new AcquisitionFailedError(
          `sink-code-${"x".repeat(100)}`,
          `client_secret=sink-secret\n${"y".repeat(500)}`,
        );
      },
    };
    const sinkGateway = new SourceAcquisitionGateway({
      sink,
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([
        { status: 200, headers: { "content-type": "text/plain" }, body: body("ok"), cancel: () => undefined },
      ]),
    });
    const sinkResult = await sinkGateway.acquire(httpRequest());
    expect(sinkResult.record.outcome).toMatchObject({ status: "failed", errorCode: "acquisition_failed" });
    expect(sinkResult.record.outcome.notes).not.toContain("sink-secret");
    expect(sinkResult.record.outcome.notes?.length).toBeLessThanOrEqual(280);
  });

  it("returns an explicit cancelled record without invoking transport", async () => {
    const transport = new QueueTransport([]);
    const controller = new AbortController();
    controller.abort();
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    const result = await gateway.acquire(httpRequest(), controller.signal);

    expect(result.record.outcome.status).toBe("cancelled");
    expect(transport.seen).toEqual([]);
  });

  it("maps an arbitrary external abort reason to cancelled without persisting it", async () => {
    let release: (() => void) | undefined;
    const resolver: HostResolver = {
      resolve: async () => await new Promise<readonly { address: string; family: 4 | 6 }[]>((resolve) => {
        release = () => resolve([{ address: "93.184.216.34", family: 4 }]);
      }),
    };
    const controller = new AbortController();
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver,
      transport: new QueueTransport([]),
    });

    const pending = gateway.acquire(httpRequest(), controller.signal);
    controller.abort(new Error("/private/path token=secret"));
    const result = await pending;
    release?.();

    expect(result.record.outcome).toMatchObject({ status: "cancelled", errorCode: "cancelled" });
    expect(result.record.outcome.notes).toBeUndefined();
  });

  it("retrieves a file inside an allowed root and denies a symlink escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-source-root-"));
    const outside = await mkdtemp(join(tmpdir(), "kc-source-outside-"));
    createdDirectories.push(root, outside);
    await writeFile(join(root, "source.md"), "local evidence");
    await writeFile(join(outside, "secret.md"), "secret");
    await symlink(join(outside, "secret.md"), join(root, "escape.md"));
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [root],
      gitRoots: [],
      clock,
    });
    const base = httpRequest({
      kind: "file",
      locator: { path: join(root, "source.md") },
      policy: { ...httpRequest().policy, allowedSchemes: ["file"], allowedMimeTypes: ["text/markdown"] },
    });

    const retrieved = await gateway.acquire(base);
    const denied = await gateway.acquire({ ...base, id: "acq-file-2", locator: { path: join(root, "escape.md") } });

    expect(retrieved.record.outcome).toMatchObject({
      status: "retrieved",
      sourceId: "candidate-1",
      stableLocator: { path: "source.md" },
    });
    expect(denied.record.outcome).toMatchObject({ status: "blocked", blockReason: "path_denied" });
  });

  it("retrieves an exact committed Git blob with a stable locator", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-git-root-"));
    const repository = join(root, "repo");
    createdDirectories.push(root);
    await mkdir(repository);
    execFileSync("git", ["init", "-q"], { cwd: repository });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repository });
    execFileSync("git", ["config", "user.name", "KC Test"], { cwd: repository });
    await writeFile(join(repository, "evidence.txt"), "committed evidence\n");
    execFileSync("git", ["add", "evidence.txt"], { cwd: repository });
    execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: repository });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [root],
      clock,
    });
    const request = httpRequest({
      id: "acq-git-1",
      kind: "git",
      locator: { repository, commit, subpath: "evidence.txt" },
      policy: { ...httpRequest().policy, allowedSchemes: ["git"], allowedMimeTypes: ["text/plain"] },
    });

    const result = await gateway.acquire(request);

    expect(result.record.outcome).toMatchObject({
      status: "retrieved",
      sourceId: "candidate-1",
      stableLocator: { commit, path: "evidence.txt" },
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("committed evidence\n");
  });

  it("denies abbreviated commits and traversal Git paths before spawning Git", async () => {
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
    });
    const base = httpRequest({
      id: "acq-git-bad",
      kind: "git",
      locator: { repository: "/tmp/repo", commit: "abc123", subpath: "../secret" },
      policy: { ...httpRequest().policy, allowedSchemes: ["git"] },
    });

    const result = await gateway.acquire(base);

    expect(result.record.outcome).toMatchObject({ status: "blocked", errorCode: "non_exact_commit" });
  });

  it("applies one deadline across sequential Git commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-git-deadline-"));
    const repository = join(root, "repo");
    createdDirectories.push(root);
    await mkdir(repository);
    const commit = "a".repeat(64);
    const timeouts: number[] = [];
    const commands: CommandRunner = {
      async run(_executable, args, _cwd, timeoutMs, _maxBytes, signal) {
        timeouts.push(timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 8));
        if (signal?.aborted) throw signal.reason;
        const value = args[0] === "rev-parse"
          ? commit
          : args[0] === "cat-file"
            ? "5"
            : "hello";
        return {
          code: 0,
          signal: null,
          stdout: new TextEncoder().encode(value),
          stderr: "",
          timedOut: false,
          cleanup: "not-required",
        };
      },
    };
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [root],
      clock,
      commands,
    });
    const result = await gateway.acquire(httpRequest({
      id: "acq-git-deadline",
      kind: "git",
      locator: { repository, commit, subpath: "evidence.txt" },
      policy: {
        ...httpRequest().policy,
        allowedSchemes: ["git"],
        allowedMimeTypes: ["text/plain"],
        timeoutMs: 100,
      },
    }));

    expect(result.record.outcome).toMatchObject({ status: "retrieved" });
    expect(timeouts).toHaveLength(3);
    expect(timeouts[1]).toBeLessThan(timeouts[0] ?? Number.POSITIVE_INFINITY);
  });

  it("classifies unavailable Git and every command-phase timeout explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-git-disposition-"));
    const repository = join(root, "repo");
    const commit = "b".repeat(64);
    createdDirectories.push(root);
    await mkdir(repository);
    const request = httpRequest({
      id: "acq-git-disposition",
      kind: "git",
      locator: { repository, commit, subpath: "evidence.txt" },
      policy: { ...httpRequest().policy, allowedSchemes: ["git"], allowedMimeTypes: ["text/plain"] },
    });
    const unavailableGateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [root],
      clock,
      commands: {
        run: async () => ({
          code: null, signal: null, stdout: new Uint8Array(), stderr: "", timedOut: false,
          cleanup: "not-required", launch: "unavailable",
        }),
      },
    });
    await expect(unavailableGateway.acquire(request)).resolves.toMatchObject({
      record: { outcome: { status: "failed", errorCode: "source_unavailable" } },
    });

    for (const timedOutPhase of ["rev-parse", "cat-file", "show"] as const) {
      const gateway = new SourceAcquisitionGateway({
        sink: new MemoryArtifactSink(),
        fileRoots: [],
        gitRoots: [root],
        clock,
        commands: {
          run: async (_executable, args) => {
            const phase = args[0];
            const value = phase === "rev-parse" ? commit : phase === "cat-file" ? "5" : "hello";
            return {
              code: timedOutPhase === phase ? null : 0,
              signal: null,
              stdout: new TextEncoder().encode(value),
              stderr: "",
              timedOut: timedOutPhase === phase,
              cleanup: "not-required" as const,
            };
          },
        },
      });
      await expect(gateway.acquire({ ...request, id: `acq-git-timeout-${timedOutPhase}` })).resolves.toMatchObject({
        record: { outcome: { status: "failed", errorCode: "timeout" } },
      });
    }
  });

  it("keeps writes under the canonical root when an adversary swaps a logical parent for a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-artifact-root-"));
    const outside = await mkdtemp(join(tmpdir(), "kc-artifact-outside-"));
    createdDirectories.push(root, outside);
    await mkdir(join(root, "sources"));
    const sink = new AtomicDirectoryArtifactSink(root, {
      beforeCommit: async () => {
        await rm(join(root, "sources"), { recursive: true });
        await symlink(outside, join(root, "sources"));
      },
    });

    const writtenPath = await sink.put("sources/item/evidence.bin", new TextEncoder().encode("evidence"));

    expect(writtenPath).toMatch(/^\.kc-artifact-[a-f0-9]{64}$/u);
    await expect(readFile(join(root, writtenPath), "utf8")).resolves.toBe("evidence");
    await expect(readFile(join(outside, "item", "evidence.bin"))).rejects.toBeDefined();
  });

  it("rejects a configured artifact root that is already a symlink", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kc-artifact-parent-"));
    const outside = await mkdtemp(join(tmpdir(), "kc-artifact-target-"));
    const linkedRoot = join(parent, "artifacts");
    createdDirectories.push(parent, outside);
    await symlink(outside, linkedRoot);
    const sink = new AtomicDirectoryArtifactSink(linkedRoot);

    await expect(sink.put("sources/item/evidence.bin", new TextEncoder().encode("evidence"))).rejects.toMatchObject({
      errorCode: "artifact_root_denied",
    });
  });

  it("commits immutable artifact bytes idempotently and rejects a conflicting locator", async () => {
    const root = await mkdtemp(join(tmpdir(), "kc-artifact-immutable-"));
    createdDirectories.push(root);
    const sink = new AtomicDirectoryArtifactSink(root);
    const locator = "sources/item/evidence.bin";

    const first = await sink.put(locator, new TextEncoder().encode("same"));
    const repeated = await sink.put(locator, new TextEncoder().encode("same"));

    expect(repeated).toBe(first);
    await expect(sink.put(locator, new TextEncoder().encode("different"))).rejects.toMatchObject({
      errorCode: "artifact_conflict",
    });
    await expect(readFile(join(root, first), "utf8")).resolves.toBe("same");
    expect((await readdir(root)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("applies the acquisition deadline through artifact persistence", async () => {
    let settledLateSink = false;
    const sink: ArtifactSink = {
      put: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        settledLateSink = true;
        return "late-artifact";
      },
    };
    const gateway = new SourceAcquisitionGateway({
      sink,
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport: new QueueTransport([
        { status: 200, headers: { "content-type": "text/plain" }, body: body("ok"), cancel: () => undefined },
      ]),
    });

    const startedAt = Date.now();
    const result = await gateway.acquire(httpRequest({ policy: { ...httpRequest().policy, timeoutMs: 10 } }));

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result.record.outcome).toMatchObject({ status: "failed", errorCode: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(settledLateSink).toBe(true);
  });

  it("classifies Windows Git unavailability as an explicit platform limitation", async () => {
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      platform: "win32",
    });
    const result = await gateway.acquire(httpRequest({
      id: "acq-git-windows",
      kind: "git",
      locator: { repository: "/tmp/repo", commit: "a".repeat(40), subpath: "evidence.txt" },
      policy: { ...httpRequest().policy, allowedSchemes: ["git"] },
    }));

    expect(result.record.outcome).toMatchObject({
      status: "failed",
      errorCode: "source_unavailable",
    });
  });

  it("validates untrusted request shape before DNS or transport side effects", async () => {
    const transport = new QueueTransport([]);
    const gateway = new SourceAcquisitionGateway({
      sink: new MemoryArtifactSink(),
      fileRoots: [],
      gitRoots: [],
      clock,
      resolver: publicResolver,
      transport,
    });

    await expect(
      gateway.acquire({ ...httpRequest(), id: "invalid id" } as AcquisitionRequest),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(transport.seen).toEqual([]);
  });
});
