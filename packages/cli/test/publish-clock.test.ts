import { afterAll, describe, expect, test } from "bun:test";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Vault } from "../src/vault.ts";
import { DESIGN, sandbox, variant, type Sandbox } from "./helpers.ts";

const boxes: Sandbox[] = [];
afterAll(async () => {
  for (const box of boxes) await rm(box.root, { recursive: true, force: true });
});

const T0 = new Date("2026-11-07T10:00:00Z");

async function draftFolder(): Promise<{ box: Sandbox; dir: string }> {
  const box = await sandbox();
  boxes.push(box);
  const dir = await variant(box, DESIGN, "clock", "1.4.0");
  const path = join(dir, "capsule.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  for (const key of ["digest", "publishedAt", "status"]) delete manifest[key];
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return { box, dir };
}

describe("publish with an injected clock", () => {
  test("same content two seconds later is a no-op that keeps the first publishedAt", async () => {
    const { box, dir } = await draftFolder();
    let now = T0;
    const vault = new Vault(box.vault, () => now);
    await vault.init();
    const first = await vault.publish(dir);
    now = new Date(T0.getTime() + 2000);
    const second = await vault.publish(dir);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.version).toBe(first.record.version);
    expect(second.record.digest).toBe(first.record.digest);
    expect(second.record.publishedAt).toBe("2026-11-07T10:00:00Z");
    const versions = await vault.versions(first.record.id);
    expect(versions.length).toBe(1);
    expect(versions[0]?.publishedAt).toBe("2026-11-07T10:00:00Z");
    expect(await readdir(join(box.vault, "capsules", first.record.id, "versions"))).toEqual(["1.4.0"]);
  });

  test("different content two seconds later is refused as immutable_version", async () => {
    const { box, dir } = await draftFolder();
    let now = T0;
    const vault = new Vault(box.vault, () => now);
    await vault.init();
    await vault.publish(dir);
    await writeFile(join(dir, "canonical.md"), `${await readFile(join(dir, "canonical.md"), "utf8")}\nChanged.\n`);
    now = new Date(T0.getTime() + 2000);
    await expect(vault.publish(dir)).rejects.toMatchObject({ code: "immutable_version" });
  });
});
