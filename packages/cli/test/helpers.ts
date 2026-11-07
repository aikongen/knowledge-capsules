import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { run } from "../src/cli.ts";

export const REPO = resolve(import.meta.dir, "..", "..", "..");
export const DESIGN = join(REPO, "examples", "design-guidelines");
export const DOCS = join(REPO, "examples", "documentation-guidelines");
export const ENTRY = join(REPO, "packages", "cli", "src", "main.ts");

export interface Sandbox {
  readonly root: string;
  readonly vault: string;
  readonly project: string;
  readonly home: string;
}

export async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "kc-test-"));
  return { root, vault: join(root, "vault"), project: join(root, "project"), home: join(root, "home") };
}

export async function kc(
  box: Sandbox,
  argv: string[],
  options: { vault?: string; cwd?: string; env?: Record<string, string>; onPath?: string; compiled?: boolean } = {},
): Promise<{ code: number; out: string; err: string }> {
  const { mkdir } = await import("node:fs/promises");
  const cwd = options.cwd ?? box.project;
  await mkdir(cwd, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    cwd,
    env: { KC_VAULT: options.vault ?? box.vault, ...options.env },
    home: box.home,
    self: options.compiled === false ? { command: "/usr/bin/bun", args: ["/src/main.ts", "mcp"], compiled: false } : { command: "/opt/kc/kc", args: ["mcp"], compiled: true },
    onPath: () => options.onPath,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A copy of an example capsule folder with canonical.md changed, optionally another version. */
export async function variant(box: Sandbox, source: string, name: string, version?: string): Promise<string> {
  const dir = join(box.root, name);
  await cp(source, dir, { recursive: true });
  await writeFile(join(dir, "canonical.md"), `${await readFile(join(dir, "canonical.md"), "utf8")}\nExtra line.\n`);
  if (version !== undefined) {
    const manifest = JSON.parse(await readFile(join(dir, "capsule.json"), "utf8")) as Record<string, unknown>;
    manifest["version"] = version;
    delete manifest["digest"];
    manifest["status"] = "draft";
    delete manifest["publishedAt"];
    await writeFile(join(dir, "capsule.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return dir;
}

/** The digest `kc publish` recorded for id@version, read from the vault's registry. */
export async function publishedDigest(box: Sandbox, id: string, version: string): Promise<string> {
  const registry = JSON.parse(await readFile(join(box.vault, "capsules", id, "registry.json"), "utf8")) as { versions: { version: string; digest: string }[] };
  const found = registry.versions.find((v) => v.version === version);
  if (found === undefined) throw new Error(`${id}@${version} is not in ${box.vault}`);
  return found.digest;
}
