import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { withWriteGuard } from "../src/lease.ts";
import { Database } from "../src/sqlite-driver.ts";

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "kc-storage-lease-"));
});

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true });
});

interface ContenderResult {
  readonly ok: boolean;
  readonly code?: string;
}

function spawnContender(mode: "hold" | "release", waitMs?: number): {
  readonly child: ChildProcess;
  readonly result: Promise<ContenderResult>;
} {
  const fixture = fileURLToPath(new URL("./fixtures/lease-contender.ts", import.meta.url));
  const child = spawn(process.execPath, [fixture, vaultRoot, mode, ...(waitMs === undefined ? [] : [String(waitMs)])], { stdio: ["ignore", "pipe", "pipe"] });
  const result = new Promise<ContenderResult>((resolveResult, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      try {
        resolveResult(JSON.parse(output.slice(0, newline)) as ContenderResult);
      } catch (cause) {
        reject(cause);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("\n")) reject(new Error(`contender exited before reporting: ${String(code)}`));
    });
  });
  return { child, result };
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolveExit, reject) => {
    child.once("exit", () => resolveExit());
    child.once("error", reject);
  });
}

describe("withWriteGuard", () => {
  it("runs the work and returns its value", async () => {
    expect(await withWriteGuard(vaultRoot, async () => 42)).toBe(42);
  });

  it("a second writer in the same process fails with vault_locked while the first holds the guard", async () => {
    await withWriteGuard(vaultRoot, async () => {
      await expect(withWriteGuard(vaultRoot, async () => "never", 50)).rejects.toMatchObject({
        code: "vault_locked",
        retryable: true,
      });
    });
  });

  it("a second writer waits for the first and then gets the guard", async () => {
    const order: string[] = [];
    const contender = spawnContender("hold");
    expect((await contender.result).ok).toBe(true);
    setTimeout(() => contender.child.kill("SIGKILL"), 300);
    const started = Date.now();
    await withWriteGuard(vaultRoot, async () => { order.push("second"); });
    expect(order).toEqual(["second"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    await waitForExit(contender.child);
  });

  it("releases the guard after the work finishes, and after it throws", async () => {
    await withWriteGuard(vaultRoot, async () => undefined);
    await expect(withWriteGuard(vaultRoot, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withWriteGuard(vaultRoot, async () => "again")).toBe("again");
  });

  it("holds out a real second process and recovers after the holder is killed", async () => {
    const first = spawnContender("hold");
    expect((await first.result).ok).toBe(true);

    const second = spawnContender("hold", 200);
    await expect(second.result).resolves.toEqual({ ok: false, code: "vault_locked" });
    await waitForExit(second.child);

    first.child.kill("SIGKILL");
    await waitForExit(first.child);

    const successor = spawnContender("release");
    expect((await successor.result).ok).toBe(true);
    await waitForExit(successor.child);
    expect(await withWriteGuard(vaultRoot, async () => "parent writes")).toBe("parent writes");
  }, 15_000);

  it("opens a lease.sqlite that already exists with content", async () => {
    await mkdir(join(vaultRoot, "runtime"), { recursive: true });
    const old = new Database(join(vaultRoot, "runtime", "lease.sqlite"));
    old.exec("CREATE TABLE leftover (id INTEGER)");
    old.close();
    expect(await withWriteGuard(vaultRoot, async () => "ok")).toBe("ok");
  });
});
