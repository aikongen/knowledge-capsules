import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { SpawnCommandRunner } from "../src/command-runner.ts";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true })));
});

describe("SpawnCommandRunner", () => {
  it("reports an unavailable executable without retaining spawn diagnostics", async () => {
    const result = await new SpawnCommandRunner().run(
      "kc-source-ingestion-missing-executable",
      [],
      process.cwd(),
      1_000,
      1024,
    );

    expect(result).toMatchObject({ code: null, launch: "unavailable" });
    expect(result.stderr).toBe("");
  });

  it.if(process.platform !== "win32")("returns after timeout even when the command ignores SIGTERM", async () => {
    const startedAt = Date.now();
    const result = await new SpawnCommandRunner().run(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      process.cwd(),
      20,
      1024,
    );

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toMatchObject({ code: null, timedOut: true });
    expect(["confirmed", "not-required", "unknown"]).toContain(result.cleanup);
  });

  it("caps stderr by bytes without retaining the whole stream", async () => {
    const result = await new SpawnCommandRunner().run(
      process.execPath,
      ["-e", "process.stderr.write('x'.repeat(50000));"],
      process.cwd(),
      1_000,
      1024,
    );

    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(16_384);
  });

  it.if(process.platform !== "win32")(
    "cancels a stubborn command and its descendant process group",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "kc-command-tree-"));
      createdDirectories.push(directory);
      const marker = join(directory, "grandchild.pid");
      const controller = new AbortController();
      const script = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`], { stdio: 'ignore' });",
        "writeFileSync(process.argv[1], String(child.pid));",
        "process.on('SIGTERM',()=>{});",
        "setInterval(()=>{},1000);",
      ].join("");
      const run = new SpawnCommandRunner().run(
        process.execPath,
        ["-e", script, marker],
        directory,
        5_000,
        1024,
        controller.signal,
      );
      const grandchildPid = await waitForPid(marker);

      controller.abort();

      await expect(run).rejects.toMatchObject({ name: "AcquisitionCancelledError" });
      expect(isAlive(grandchildPid)).toBe(false);
    },
  );
});

async function waitForPid(marker: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await readFile(marker, "utf8").catch(() => "");
    const pid = Number(value);
    if (Number.isInteger(pid) && pid > 0) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("grandchild PID marker was not created");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}
