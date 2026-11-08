import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DESIGN, DOCS, REPO, kc, sandbox, type Sandbox } from "./helpers.ts";

const WRITING = join(REPO, "examples", "capsule-writing-guidelines");
const EVIDENCE = join(REPO, "examples", "design-evidence-guidelines");

const boxes: Sandbox[] = [];
async function fresh(): Promise<Sandbox> {
  const box = await sandbox();
  boxes.push(box);
  return box;
}
afterAll(async () => {
  for (const box of boxes) await rm(box.root, { recursive: true, force: true });
});

const BASE = { id: "tests/base", trigger: "Use when writing short text." };

/** A capsule folder built here, so the tests do not depend on the examples' text. */
async function folderWith(box: Sandbox, name: string, canonical: string, own: { id: string; trigger: string } = BASE): Promise<string> {
  const dir = join(box.root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "canonical.md"), canonical);
  const manifest = {
    id: own.id,
    version: "1.0.0",
    kind: "guidelines",
    trigger: own.trigger,
    scope: { includes: ["short text"], excludes: ["long text"] },
    contents: { canonical: "canonical.md" },
  };
  await writeFile(join(dir, "capsule.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

describe("check a folder", () => {
  test("each example: exit 0, advice only, a header in the usual shape, no vault created", async () => {
    const box = await fresh();
    for (const folder of [DESIGN, DOCS, WRITING, EVIDENCE]) {
      const result = await kc(box, ["check", folder]);
      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out.split("\n")[0]).toMatch(/^aikongen\/[a-z-]+@\d+\.\d+\.\d+: (no advice|\d+ pieces? of advice)$/);
    }
    await expect(stat(box.vault)).rejects.toThrow();
  });

  test("over 2,000 words, exact line", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "long", `# Title\n\n${Array(2001).fill("word").join(" ")}\n`);
    const result = await kc(box, ["check", dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("tests/base@1.0.0: 1 piece of advice\n  advice: 2,003 words; split before about 2,000");
  });

  test("links, dates and quoted words, exact output", async () => {
    const box = await fresh();
    const dir = await folderWith(
      box,
      "linky",
      ["# Title", "", "See [the guide](guide.md) or https://example.com.", 'Say "https://quoted.example" or `http` here.', "Written 2026-11-01, edited 2026-11-02.", ""].join("\n"),
    );
    const result = await kc(box, ["check", dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        "tests/base@1.0.0: 3 pieces of advice",
        '  advice: line 3 "[the guide](guide.md)": a reader with only this capsule cannot follow it',
        '  advice: line 3 "https://example.com": a reader with only this capsule cannot follow it',
        '  skipped: line 4 "https://quoted.example" look quoted, not links',
        "  advice: 2 dates (line 5); dates go stale",
      ].join("\n"),
    );
  });

  test("a quoted path is skipped, not advised", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "paths", "# Title\n\nApplies to `./a.md` and to docs/x.md.\n");
    expect((await kc(box, ["check", dir])).out).toBe(
      ['tests/base@1.0.0: 1 piece of advice', '  advice: line 3 "docs/x.md": a path is a pointer; put the substance here', '  skipped: line 3 "./a.md" look quoted, not paths'].join("\n"),
    );
  });

  test("nothing to say", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "clean", "# Title\n\nWrite short sentences.\n");
    const result = await kc(box, ["check", dir]);
    expect(result.out).toBe("tests/base@1.0.0: no advice");
    expect(result.code).toBe(0);
  });

  test("an empty canonical.md gives no advice", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "empty-text", "");
    const result = await kc(box, ["check", dir]);
    expect(result.out).toBe("tests/base@1.0.0: no advice");
    expect(result.code).toBe(0);
  });

  test("a CRLF canonical.md keeps the right line numbers", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "crlf", ["# Title", "", "See https://a.io now.", "Written 2026-01-01.", ""].join("\r\n"));
    expect((await kc(box, ["check", dir])).out).toBe(
      ["tests/base@1.0.0: 2 pieces of advice", '  advice: line 3 "https://a.io": a reader with only this capsule cannot follow it', "  advice: 1 date (line 4); dates go stale"].join("\n"),
    );
  });

  test("a folder that is not a capsule, a missing folder and two arguments are usage errors", async () => {
    const box = await fresh();
    const empty = await folderWith(box, "no-manifest", "# Title\n");
    await rm(join(empty, "capsule.json"));
    const notCapsule = await kc(box, ["check", empty]);
    expect(notCapsule.code).toBe(1);
    expect(notCapsule.err).toBe(`error: ${empty} has no capsule.json; see docs/capsule-format.md`);
    const missing = await kc(box, ["check", join(box.root, "nope")]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("does not exist");
    const two = await kc(box, ["check", DESIGN, DOCS]);
    expect(two.code).toBe(1);
    expect(two.err).toBe("usage: kc check [folder]");
  });
});

describe("check this repository", () => {
  test("without kc.json it says so in one line and exits 0", async () => {
    const box = await fresh();
    const result = await kc(box, ["check"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("this repository has no kc.json; nothing to check");
  });

  test("every pinned capsule from the vault, then the triggers they share", async () => {
    const box = await fresh();
    const one = await folderWith(box, "one", "# Title\n\nWritten 2026-11-01.\n", { id: "tests/one", trigger: "Use when writing, changing or reviewing text." });
    const two = await folderWith(box, "two", "# Title\n\nWrite short sentences.\n", { id: "tests/two", trigger: "Use when reviewing, writing or changing code." });
    const three = await folderWith(box, "three", "# Title\n\nWrite short sentences.\n", { id: "tests/three", trigger: "Use when designing screens." });
    for (const folder of [one, two, three]) await kc(box, ["add", folder]);
    const result = await kc(box, ["check"]);
    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        "tests/one@1.0.0: 1 piece of advice",
        "  advice: 1 date (line 3); dates go stale",
        "tests/three@1.0.0: no advice",
        "tests/two@1.0.0: no advice",
        "triggers of tests/one and tests/two share: writing, changing, reviewing",
      ].join("\n"),
    );
  });

  test("a pin the vault lacks is skipped in one line, the others are still checked, exit 0", async () => {
    const box = await fresh();
    await kc(box, ["add", await folderWith(box, "one", "# Title\n\nWrite short sentences.\n", { id: "tests/one", trigger: "Use when writing short text." })]);
    const path = join(box.project, "kc.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as { capsules: unknown[] };
    manifest.capsules.unshift({ id: "aikongen/gone", version: "1.0.0", digest: `sha256:${"0".repeat(64)}` });
    await writeFile(path, JSON.stringify(manifest));
    const result = await kc(box, ["check"]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toBe("skipped: aikongen/gone@1.0.0 is not in the vault\ntests/one@1.0.0: no advice");
  });
});

describe("publish points to check", () => {
  test("one extra line when there is advice, nothing when there is none", async () => {
    const box = await fresh();
    const dated = await folderWith(box, "dated", "# Title\n\nWritten 2026-11-01, edited 2026-11-02.\n");
    expect((await kc(box, ["publish", dated])).out).toBe(`published tests/base@1.0.0\n1 piece of advice; run kc check ${dated}`);
    expect((await kc(box, ["publish", dated])).out).toBe(`tests/base@1.0.0 is already in the vault, unchanged\n1 piece of advice; run kc check ${dated}`);
    const clean = await folderWith(box, "clean", "# Title\n\nWrite short sentences.\n", { id: "tests/clean", trigger: "Use when writing short text." });
    expect((await kc(box, ["publish", clean])).out).toBe("published tests/clean@1.0.0");
  });

  test("a folder named like a zip is published; the advice step never fails the command", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "x.zip", "# Title\n\nWritten 2026-11-01.\n");
    const result = await kc(box, ["publish", dir]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.split("\n")[0]).toBe("published tests/base@1.0.0");
  });
});
