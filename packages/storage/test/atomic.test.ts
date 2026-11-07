import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as realFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const actual = { ...realFs };
const fsFaults: { directorySyncPath?: string } = {};

// Wraps the real `rename` in a mock that still calls through by default, so
// every other fs operation in this file behaves normally. Only the specific
// test below overrides it once, to force a failure precisely between the
// staging write completing and the rename that publishes it — the one
// interruption point a real crash could land on that we cannot otherwise
// provoke deterministically on a real filesystem.
// Salvage port: vitest `vi.hoisted`/`vi.mock` became bun:test `mock.module`.
const openWithFault: typeof actual.open = async (path, flags, mode) => {
  const handle = await actual.open(path, flags, mode);
  if (String(path) !== fsFaults.directorySyncPath) return handle;
  return new Proxy(handle, {
    get(target, property) {
      if (property === "sync") {
        return async () => {
          throw new Error("simulated parent directory fsync failure");
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};
const renameMock = mock(actual.rename);
mock.module("node:fs/promises", () => ({
  ...actual,
  open: mock(openWithFault),
  rename: renameMock,
}));

const { publishDirectoryAtomic, recoverStaleStaging, writeFileAtomic, writeFileCreateOnlyAtomic, writeJsonAtomic } =
  await import("../src/atomic.ts");

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kc-storage-atomic-"));
});

afterEach(async () => {
  // `mockRejectedValueOnce` only overrides the next call and then falls back
  // to the passthrough implementation set in `vi.mock` above, so no reset is
  // needed here beyond cleaning up the test's own temp directory.
  fsFaults.directorySyncPath = undefined;
  await rm(workDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates a file with complete content when the target does not yet exist", async () => {
    const target = join(workDir, "note.txt");
    const result = await writeFileAtomic(target, "hello world");
    expect(result.ok).toBe(true);
    expect(await readFile(target, "utf8")).toBe("hello world");
  });

  it("leaves no staging artifacts behind after a successful write", async () => {
    const target = join(workDir, "note.txt");
    await writeFileAtomic(target, "hello world");
    const entries = await readdir(workDir);
    expect(entries).toEqual(["note.txt"]);
  });

  it("replaces existing content atomically: the target only ever holds one whole version", async () => {
    const target = join(workDir, "note.txt");
    await writeFileAtomic(target, "version one, quite a bit longer than version two");
    await writeFileAtomic(target, "v2");
    expect(await readFile(target, "utf8")).toBe("v2");
  });

  it("never leaves a truncated file: content is either fully absent or fully present", async () => {
    const target = join(workDir, "big.txt");
    const large = "x".repeat(1_000_000);
    await writeFileAtomic(target, large);
    const content = await readFile(target, "utf8");
    expect(content.length).toBe(large.length);
    expect(content).toBe(large);
  });

  it("leaves the original file untouched when a crash is simulated between staging and rename", async () => {
    const target = join(workDir, "note.txt");
    await writeFileAtomic(target, "original content");

    renameMock.mockRejectedValueOnce(
      new Error("simulated crash before rename commits"),
    );

    const result = await writeFileAtomic(target, "would-be v2");
    expect(result.ok).toBe(false);
    expect(await readFile(target, "utf8")).toBe("original content");

    const entries = await readdir(workDir);
    expect(entries.filter((entry) => entry.startsWith(".kc-tmp-"))).toEqual([]);
  });
});

describe("writeFileCreateOnlyAtomic", () => {
  it("does not overwrite an immutable target that appeared first", async () => {
    const target = join(workDir, "receipt.json");
    expect(await writeFileCreateOnlyAtomic(target, "first")).toMatchObject({ ok: true, value: "created" });
    expect(await writeFileCreateOnlyAtomic(target, "second")).toMatchObject({ ok: true, value: "already_exists" });
    expect(await readFile(target, "utf8")).toBe("first");
  });

  it("reports a committed receipt truthfully when the parent directory sync fails", async () => {
    const target = join(workDir, "receipt.json");
    fsFaults.directorySyncPath = workDir;

    const result = await writeFileCreateOnlyAtomic(target, "receipt");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        retryable: true,
        details: [expect.objectContaining({ canonicalCommitted: true })],
      },
    });
    expect(await readFile(target, "utf8")).toBe("receipt");
  });
});

describe("writeJsonAtomic", () => {
  it("writes parseable JSON matching the given value", async () => {
    const target = join(workDir, "data.json");
    await writeJsonAtomic(target, { a: 1, b: "two" });
    const parsed = JSON.parse(await readFile(target, "utf8"));
    expect(parsed).toEqual({ a: 1, b: "two" });
  });
});

describe("publishDirectoryAtomic", () => {
  it("publishes a whole directory tree in one atomic rename", async () => {
    const target = join(workDir, "version");
    const result = await publishDirectoryAtomic(target, async (stagingDir) => {
      await writeFile(join(stagingDir, "manifest.json"), '{"a":1}');
      await mkdir(join(stagingDir, "items"));
      await writeFile(join(stagingDir, "items", "item-1.json"), '{"b":2}');
    });
    expect(result.ok).toBe(true);
    expect(await readFile(join(target, "manifest.json"), "utf8")).toBe('{"a":1}');
    expect(await readFile(join(target, "items", "item-1.json"), "utf8")).toBe('{"b":2}');
  });

  it("leaves the previous directory intact when the staging callback is interrupted", async () => {
    const target = join(workDir, "version");
    await mkdir(target);
    await writeFile(join(target, "manifest.json"), '{"previous":true}');

    const result = await publishDirectoryAtomic(target, async (stagingDir) => {
      await writeFile(join(stagingDir, "manifest.json"), '{"partial":true}');
      throw new Error("interrupted mid-publish");
    });

    expect(result.ok).toBe(false);
    expect(await readFile(join(target, "manifest.json"), "utf8")).toBe('{"previous":true}');
  });

  it("leaves the previous directory intact when a crash is simulated between staging and rename", async () => {
    const target = join(workDir, "version");
    await mkdir(target);
    await writeFile(join(target, "manifest.json"), '{"previous":true}');

    renameMock.mockRejectedValueOnce(
      new Error("simulated crash before rename commits"),
    );

    const result = await publishDirectoryAtomic(target, async (stagingDir) => {
      await writeFile(join(stagingDir, "manifest.json"), '{"partial":true}');
    });

    expect(result.ok).toBe(false);
    expect(await readFile(join(target, "manifest.json"), "utf8")).toBe('{"previous":true}');
  });

  it("leaves no staging directory behind after an interrupted publish", async () => {
    const target = join(workDir, "version");
    await publishDirectoryAtomic(target, async (stagingDir) => {
      await writeFile(join(stagingDir, "manifest.json"), "{}");
      throw new Error("interrupted");
    });
    const entries = await readdir(workDir);
    expect(entries.filter((entry) => entry.startsWith(".kc-tmp-"))).toEqual([]);
  });

  it("does not relabel a committed directory as a pre-commit failure when parent sync fails", async () => {
    const target = join(workDir, "version");
    fsFaults.directorySyncPath = workDir;

    const result = await publishDirectoryAtomic(target, async (stagingDir) => {
      await writeFile(join(stagingDir, "manifest.json"), "{}");
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "internal",
        retryable: true,
        details: [expect.objectContaining({ canonicalCommitted: true })],
      },
    });
    expect(await readFile(join(target, "manifest.json"), "utf8")).toBe("{}");
  });
});

describe("recoverStaleStaging", () => {
  it("removes staging artifacts left behind by a crash", async () => {
    const staleDir = join(workDir, ".kc-tmp-version.deadbeef");
    await mkdir(staleDir);
    await writeFile(join(staleDir, "manifest.json"), "{}");

    const result = await recoverStaleStaging(workDir, [".kc-tmp-version.deadbeef"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain(".kc-tmp-version.deadbeef");

    await expect(stat(staleDir)).rejects.toThrow();
  });

  it("does not delete live data that happens to share the directory", async () => {
    const liveDir = join(workDir, "capsules");
    await mkdir(liveDir);
    await writeFile(join(liveDir, "manifest.json"), '{"live":true}');
    const staleDir = join(workDir, ".kc-tmp-capsules.deadbeef");
    await mkdir(staleDir);

    await recoverStaleStaging(workDir, [".kc-tmp-capsules.deadbeef"]);

    expect(await readFile(join(liveDir, "manifest.json"), "utf8")).toBe('{"live":true}');
    await expect(stat(staleDir)).rejects.toThrow();
  });

  it("is a no-op on a directory with no staging artifacts", async () => {
    const result = await recoverStaleStaging(workDir, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("returns ok on a directory that does not exist", async () => {
    const result = await recoverStaleStaging(join(workDir, "does-not-exist"), []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("fails closed and preserves every staging-looking entry that was not named by the operation", async () => {
    const owned = join(workDir, ".kc-tmp-version.deadbeef");
    const unowned = join(workDir, ".kc-tmp-user-notes");
    await mkdir(owned);
    await writeFile(join(owned, "manifest.json"), "{}");
    await mkdir(unowned);
    await writeFile(join(unowned, "notes.txt"), "keep this");

    const result = await recoverStaleStaging(workDir, [".kc-tmp-version.deadbeef"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("policy_denied");
    expect(await readFile(join(owned, "manifest.json"), "utf8")).toBe("{}");
    expect(await readFile(join(unowned, "notes.txt"), "utf8")).toBe("keep this");
  });
});
