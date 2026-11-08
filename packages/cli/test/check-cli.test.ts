import { afterAll, describe, expect, test } from "bun:test";
import { cp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DESIGN, DOCS, REPO, kc, sandbox, type Sandbox } from "./helpers.ts";

const WRITING = join(REPO, "examples", "capsule-writing-guidelines");

const boxes: Sandbox[] = [];
async function fresh(): Promise<Sandbox> {
  const box = await sandbox();
  boxes.push(box);
  return box;
}
afterAll(async () => {
  for (const box of boxes) await rm(box.root, { recursive: true, force: true });
});

/** A copy of an example folder with its own canonical.md text, and optionally another id and trigger. */
async function folderWith(box: Sandbox, name: string, canonical: string, own?: { id: string; trigger: string }): Promise<string> {
  const dir = join(box.root, name);
  await cp(DOCS, dir, { recursive: true });
  await writeFile(join(dir, "canonical.md"), canonical);
  if (own !== undefined) {
    const manifest = JSON.parse(await readFile(join(dir, "capsule.json"), "utf8")) as Record<string, unknown>;
    manifest["id"] = own.id;
    manifest["trigger"] = own.trigger;
    await writeFile(join(dir, "capsule.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return dir;
}

const CLEAN = { id: "tests/clean", trigger: "Use when writing short text." };

describe("check a folder", () => {
  test("design-guidelines: exit 0, advice only, no vault created", async () => {
    const box = await fresh();
    const result = await kc(box, ["check", DESIGN]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.split("\n")[0]).toBe("aikongen/design-guidelines@1.2.0: 1 piece of advice");
    expect(result.out.split("\n")[1]).toMatch(/^ {2}advice: \d+ paragraphs with a rule and no reason \(lines /);
    await expect(stat(box.vault)).rejects.toThrow();
  });

  test("documentation-guidelines skips a quoted path; capsule-writing-guidelines has no advice", async () => {
    const box = await fresh();
    const docs = await kc(box, ["check", DOCS]);
    expect(docs.out.split("\n").slice(0, 2)).toEqual(["aikongen/documentation-guidelines@1.2.0: 1 piece of advice", '  skipped: line 72 "/*.md" look quoted, not paths']);
    const writing = await kc(box, ["check", WRITING]);
    expect(writing.out).toBe("aikongen/capsule-writing-guidelines@1.1.0: no advice");
  });

  test("over 2,000 words, exact line", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "long", `# Title\n\n${Array(2001).fill("word").join(" ")}\n`);
    const result = await kc(box, ["check", dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("aikongen/documentation-guidelines@1.2.0: 1 piece of advice\n  advice: 2,003 words; split before about 2,000");
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
        "aikongen/documentation-guidelines@1.2.0: 3 pieces of advice",
        '  advice: line 3 "[the guide](guide.md)": a reader with only this capsule cannot follow it',
        '  advice: line 3 "https://example.com": a reader with only this capsule cannot follow it',
        '  skipped: line 4 "https://quoted.example" look quoted, not links',
        "  advice: 2 dates (line 5); dates go stale",
      ].join("\n"),
    );
  });

  test("nothing to say", async () => {
    const box = await fresh();
    const dir = await folderWith(box, "clean", "# Title\n\nWrite short sentences.\n", CLEAN);
    const result = await kc(box, ["check", dir]);
    expect(result.out).toBe("tests/clean@1.2.0: no advice");
    expect(result.code).toBe(0);
  });

  test("a folder that is not a capsule, a missing folder and two arguments are usage errors", async () => {
    const box = await fresh();
    const empty = join(box.root, "empty");
    await cp(DOCS, empty, { recursive: true });
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
        "tests/one@1.2.0: 1 piece of advice",
        "  advice: 1 date (line 3); dates go stale",
        "tests/three@1.2.0: no advice",
        "tests/two@1.2.0: no advice",
        "triggers of tests/one and tests/two share: writing, changing, reviewing",
      ].join("\n"),
    );
  });

  test("a pinned example with nothing to say", async () => {
    const box = await fresh();
    await kc(box, ["add", WRITING]);
    expect((await kc(box, ["check"])).out).toBe("aikongen/capsule-writing-guidelines@1.1.0: no advice");
  });

  test("a pinned capsule that the vault lacks is an error", async () => {
    const box = await fresh();
    await kc(box, ["add", DOCS]);
    await rm(box.vault, { recursive: true });
    await kc(box, ["init"]);
    const result = await kc(box, ["check"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("is not in the vault");
  });
});

describe("publish points to check", () => {
  test("one extra line when there is advice, nothing when there is none", async () => {
    const box = await fresh();
    const dated = await folderWith(box, "dated", "# Title\n\nWritten 2026-11-01, edited 2026-11-02.\n");
    expect((await kc(box, ["publish", dated])).out).toBe(`published aikongen/documentation-guidelines@1.2.0\n1 piece of advice; run kc check ${dated}`);
    expect((await kc(box, ["publish", dated])).out).toBe(`aikongen/documentation-guidelines@1.2.0 is already in the vault, unchanged\n1 piece of advice; run kc check ${dated}`);
    const clean = await folderWith(box, "clean", "# Title\n\nWrite short sentences.\n", CLEAN);
    expect((await kc(box, ["publish", clean])).out).toBe("published tests/clean@1.2.0");
  });
});
