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
  test("design-guidelines: the word count line, exit 0, no vault created", async () => {
    const box = await fresh();
    const result = await kc(box, ["check", DESIGN]);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out.split("\n").slice(0, 2)).toEqual(["aikongen/design-guidelines@1.1.0: 2 pieces of advice", "  advice: 2,392 words; split before about 2,000"]);
    await expect(stat(box.vault)).rejects.toThrow();
  });

  test("documentation-guidelines skips a quoted path; capsule-writing-guidelines finds its dates", async () => {
    const box = await fresh();
    const docs = await kc(box, ["check", DOCS]);
    expect(docs.out.split("\n").slice(0, 2)).toEqual(["aikongen/documentation-guidelines@1.1.0: 1 piece of advice", '  skipped: line 72 "/*.md" look quoted, not paths']);
    const writing = await kc(box, ["check", WRITING]);
    expect(writing.out.split("\n")[0]).toBe("aikongen/capsule-writing-guidelines@1.0.0: 2 pieces of advice");
    expect(writing.out).toContain("  advice: 6 dates (lines 5, 13, 17, 19, 23, 72); dates go stale");
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
        "aikongen/documentation-guidelines@1.1.0: 3 pieces of advice",
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
    expect(result.out).toBe("tests/clean@1.1.0: no advice");
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
    for (const folder of [DESIGN, DOCS, WRITING]) await kc(box, ["add", folder]);
    const result = await kc(box, ["check"]);
    expect(result.code).toBe(0);
    const lines = result.out.split("\n");
    expect(lines.filter((l) => !l.startsWith("  "))).toEqual([
      "aikongen/capsule-writing-guidelines@1.0.0: 2 pieces of advice",
      "aikongen/design-guidelines@1.1.0: 2 pieces of advice",
      "aikongen/documentation-guidelines@1.1.0: 1 piece of advice",
      "triggers of aikongen/capsule-writing-guidelines and aikongen/documentation-guidelines share: writing, changing, reviewing",
    ]);
    expect(lines).toContain("  advice: 2,392 words; split before about 2,000");
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
    const advised = await kc(box, ["publish", DESIGN]);
    expect(advised.out).toBe(`published aikongen/design-guidelines@1.1.0\n2 pieces of advice; run kc check ${DESIGN}`);
    const again = await kc(box, ["publish", DESIGN]);
    expect(again.out).toBe(`aikongen/design-guidelines@1.1.0 is already in the vault, unchanged\n2 pieces of advice; run kc check ${DESIGN}`);
    const one = await folderWith(box, "one", "# Title\n\nWritten 2026-11-01.\n");
    expect((await kc(box, ["publish", one])).out).toBe(`published aikongen/documentation-guidelines@1.1.0\n1 piece of advice; run kc check ${one}`);
    const clean = await folderWith(box, "clean", "# Title\n\nWrite short sentences.\n", CLEAN);
    expect((await kc(box, ["publish", clean])).out).toBe("published tests/clean@1.1.0");
  });
});
