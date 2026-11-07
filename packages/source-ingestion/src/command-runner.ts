import { spawn } from "node:child_process";

import { AcquisitionCancelledError, AcquisitionFailedError } from "./errors.ts";
import type { CommandResult, CommandRunner } from "./types.ts";

const STDERR_LIMIT_BYTES = 16_384;
const PROCESS_CLEANUP_GRACE_MS = 100;

type ExitResult = Omit<CommandResult, "cleanup">;

export class SpawnCommandRunner implements CommandRunner {
  async run(
    executable: string,
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    maxStdoutBytes: number,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    if (signal?.aborted) throw abortReason(signal);
    const child = spawn(executable, [...args], {
      cwd,
      detached: process.platform !== "win32",
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let overflow = false;
    let cleanupPromise: Promise<CommandResult["cleanup"]> | undefined;
    let forceResult: ((result: CommandResult) => void) | undefined;
    let exitSettled = false;
    const exit = new Promise<ExitResult>((resolve) => {
      const finish = (result: ExitResult): void => {
        if (exitSettled) return;
        exitSettled = true;
        resolve(result);
      };
      child.once("error", (error) => {
        finish({
          code: null,
          signal: null,
          stdout: Buffer.alloc(0),
          stderr: "",
          timedOut,
          launch: isUnavailableExecutable(error) ? "unavailable" : "failed",
        });
      });
      child.once("close", (code, processSignal) => {
        finish({
          code,
          signal: processSignal,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          launch: "started",
        });
      });
    });
    const forced = new Promise<CommandResult>((resolve) => {
      forceResult = resolve;
    });
    const requestCleanup = (): void => {
      cleanupPromise ??= terminateProcessTree(child, PROCESS_CLEANUP_GRACE_MS).catch(() => "unknown" as const);
      void cleanupPromise.then((cleanup) => {
        // `close` can wait on an inherited pipe held by an escaped child. Once
        // cleanup has reached a bounded conclusion, return fail-closed rather
        // than waiting indefinitely for an event the runner cannot guarantee.
        forceResult?.({
          code: null,
          signal: null,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          cleanup,
          launch: "started",
        });
      });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        overflow = true;
        requestCleanup();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = STDERR_LIMIT_BYTES - stderrBytes;
      if (remaining <= 0) return;
      const retained = chunk.subarray(0, remaining);
      stderr.push(retained);
      stderrBytes += retained.length;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      requestCleanup();
    }, timeoutMs);
    timer.unref();
    const onAbort = (): void => {
      requestCleanup();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    let result: CommandResult;
    try {
      const completed = exit.then(async (exitResult) => {
        const cleanup = await (cleanupPromise ?? cleanupExitedProcessGroup(child)).catch(() => "unknown" as const);
        return { ...exitResult, cleanup } satisfies CommandResult;
      });
      result = await Promise.race([completed, forced]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) {
      if (result.cleanup === "unknown") {
        throw new AcquisitionFailedError(
          "cleanup_failed",
          "command cancellation could not confirm process-tree cleanup",
        );
      }
      throw abortReason(signal);
    }
    if (overflow) {
      return { ...result, code: null, stderr: "stdout size limit exceeded", stdoutOverflow: true };
    }
    return result;
  }
}

async function cleanupExitedProcessGroup(
  child: ReturnType<typeof spawn>,
): Promise<CommandResult["cleanup"]> {
  if (process.platform === "win32" || child.pid === undefined) return "not-required";
  const state = processGroupState(child.pid);
  return state === "absent" ? "not-required" : await terminateProcessTree(child, PROCESS_CLEANUP_GRACE_MS);
}

async function terminateProcessTree(
  child: ReturnType<typeof spawn>,
  graceMs: number,
): Promise<CommandResult["cleanup"]> {
  if (child.pid === undefined) return "unknown";
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    return "unknown";
  }
  const processGroupId = child.pid;
  if (processGroupState(processGroupId) === "absent") return "not-required";
  if (!signalProcessGroup(processGroupId, "SIGTERM")) return "unknown";
  if (await waitForGroupAbsence(processGroupId, graceMs)) return "confirmed";
  if (!signalProcessGroup(processGroupId, "SIGKILL")) return "unknown";
  return (await waitForGroupAbsence(processGroupId, graceMs)) ? "confirmed" : "unknown";
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    return isNoSuchProcess(error);
  }
}

function processGroupState(processGroupId: number): "present" | "absent" | "unknown" {
  try {
    process.kill(-processGroupId, 0);
    return "present";
  } catch (error) {
    return isNoSuchProcess(error) ? "absent" : "unknown";
  }
}

async function waitForGroupAbsence(processGroupId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (processGroupState(processGroupId) === "absent") return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  return processGroupState(processGroupId) === "absent";
}

function isNoSuchProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function isUnavailableExecutable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof AcquisitionFailedError || signal.reason instanceof AcquisitionCancelledError
    ? signal.reason
    : new AcquisitionCancelledError();
}
