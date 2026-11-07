import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DESIGN, DOCS, REPO, kc, publishedDigest, sandbox, variant, type Sandbox } from "./helpers.ts";

const boxes: Sandbox[] = [];
async function fresh(): Promise<Sandbox> {
  const box = await sandbox();
  boxes.push(box);
  return box;
}
afterAll(async () => {
  for (const box of boxes) await rm(box.root, { recursive: true, force: true });
});


async function treeHash(dir: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(d: string): Promise<void> {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) await visit(p);
      else hash.update(p).update(await readFile(p));
    }
  }
  await visit(dir);
  return hash.digest("hex");
}

describe("init", () => {
  test("creates the vault and is idempotent", async () => {
    const box = await fresh();
    const first = await kc(box, ["init"]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("created");
    expect((await stat(join(box.vault, "vault.json"))).isFile()).toBe(true);
    const second = await kc(box, ["init"]);
    expect(second.out).toContain("already exists");
  });

  test("other commands refuse a missing vault", async () => {
    const box = await fresh();
    const result = await kc(box, ["status"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no vault at");
  });
});

describe("publish", () => {
  test("publishes an example, leaves the folder alone, and is idempotent", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    const before = await treeHash(DESIGN);
    const first = await kc(box, ["publish", DESIGN]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("published surfaces/design-guidelines@1.0.1");
    const again = await kc(box, ["publish", DESIGN]);
    expect(again.out).toContain("is already in the vault, unchanged");
    expect(await treeHash(DESIGN)).toBe(before);
    const stored = join(box.vault, "capsules/surfaces/design-guidelines/versions/1.0.1", (await publishedDigest(box, "surfaces/design-guidelines", "1.0.1")).slice(7));
    expect((await stat(join(stored, "canonical.md"))).isFile()).toBe(true);
  });

  test("refuses the same id and version with different content and never rewrites published files", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    const stored = join(box.vault, "capsules/surfaces/design-guidelines");
    const before = await treeHash(stored);
    const changed = await variant(box, DESIGN, "changed");
    const staged = JSON.parse(await readFile(join(changed, "capsule.json"), "utf8")) as Record<string, unknown>;
    staged["digest"] = `sha256:${"0".repeat(64)}`;
    await writeFile(join(changed, "capsule.json"), `${JSON.stringify(staged, null, 2)}\n`);
    const stale = await kc(box, ["publish", changed]);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("capsule.json digest does not match the files; remove it and publish again");
    const manifestPath = join(changed, "capsule.json");
    const edited = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    delete edited["digest"];
    await writeFile(manifestPath, `${JSON.stringify(edited, null, 2)}\n`);
    const result = await kc(box, ["publish", changed]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('raise "version" in capsule.json and publish again');
    expect(await treeHash(stored)).toBe(before);
  });

  test("a new version is a separate immutable entry", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    const next = await variant(box, DESIGN, "next", "1.1.0");
    const result = await kc(box, ["publish", next]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("surfaces/design-guidelines@1.1.0");
    const status = await kc(box, ["status"]);
    expect(status.out).toContain("capsules: 1, versions: 2");
  });
});

describe("publish from a minimal capsule.json", () => {
  test("digest, publishedAt, schemaVersion and status may be absent", async () => {
    const box = await fresh();
    const dir = await variant(box, DESIGN, "minimal", "1.2.0");
    const path = join(dir, "capsule.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    for (const key of ["digest", "publishedAt", "schemaVersion", "status"]) delete manifest[key];
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await kc(box, ["publish", dir]);
    expect(result.err).toBe("");
    expect(result.out).toBe("published surfaces/design-guidelines@1.2.0");
  });
});

describe("add, remove, update", () => {
  test("add pins a published folder, update moves the pin, remove drops it", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    const added = await kc(box, ["add", "surfaces/design-guidelines@1.0.1"]);
    expect(added.code).toBe(0);
    const manifest = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: { id: string; version: string; digest: string }[] };
    expect(manifest.capsules).toEqual([{ id: "surfaces/design-guidelines", version: "1.0.1", digest: await publishedDigest(box, "surfaces/design-guidelines", "1.0.1") }]);

    await kc(box, ["publish", await variant(box, DESIGN, "next", "1.1.0")]);
    expect((await kc(box, ["status"])).out).toContain("1.1.0 is available; run kc update");
    const updated = await kc(box, ["update"]);
    expect(updated.out).toContain("surfaces/design-guidelines: 1.0.1 -> 1.1.0");
    const after = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: { version: string }[] };
    expect(after.capsules[0]?.version).toBe("1.1.0");

    const removed = await kc(box, ["remove", "surfaces/design-guidelines"]);
    expect(removed.code).toBe(0);
    const empty = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: unknown[] };
    expect(empty.capsules).toEqual([]);
    expect((await kc(box, ["remove", "surfaces/design-guidelines"])).code).toBe(1);
  });

  test("add takes id@version from the vault and says what to do when it is missing", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    const added = await kc(box, ["add", "surfaces/design-guidelines@1.0.1"]);
    expect(added.code).toBe(0);
    expect(added.out).toBe("this repository now uses surfaces/design-guidelines@1.0.1");
    const manifest = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: unknown[] };
    expect(manifest.capsules).toEqual([{ id: "surfaces/design-guidelines", version: "1.0.1", digest: await publishedDigest(box, "surfaces/design-guidelines", "1.0.1") }]);
    expect((await kc(box, ["add", "surfaces/design-guidelines"])).code).toBe(0);

    const wrongVersion = await kc(box, ["add", "surfaces/design-guidelines@9.9.9"]);
    expect(wrongVersion.code).toBe(1);
    expect(wrongVersion.err).toBe("error: surfaces/design-guidelines@9.9.9 is not in the vault; it has 1.0.1");
    expect(wrongVersion.err).not.toContain("Did you mean");
    const typo = await kc(box, ["add", "surfaces/design-guideline"]);
    expect(typo.err).toContain("Did you mean surfaces/design-guidelines?");
    const sameSpace = await kc(box, ["add", "surfaces/nothing"]);
    expect(sameSpace.err).not.toContain("Did you mean");
    expect(sameSpace.err).toContain("To add a new capsule, run kc publish <folder> first.");
    const far = await kc(box, ["add", "other/nothing"]);
    expect(far.err).not.toContain("Did you mean");
    const badId = await kc(box, ["add", "Bad"]);
    expect(badId.code).toBe(1);
    expect(badId.err).toContain('error: "Bad" is not a capsule id; use namespace/name in lowercase, for example surfaces/design-guidelines');
    expect(badId.err).not.toContain("pattern");
    const unknown = await kc(box, ["add", "surfaces/nothing@1.0.0"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("is not in the vault.");
    const after = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: unknown[] };
    expect(after.capsules).toHaveLength(1);
  });

  test("add <folder> publishes it and uses it; add <file.zip> imports it and uses it", async () => {
    const box = await fresh();
    const folder = await kc(box, ["add", DESIGN]);
    expect(folder.code).toBe(0);
    expect(folder.out).toBe("published surfaces/design-guidelines@1.0.1\nthis repository now uses surfaces/design-guidelines@1.0.1");
    const manifest = JSON.parse(await readFile(join(box.project, "kc.json"), "utf8")) as { capsules: unknown[] };
    expect(manifest.capsules).toEqual([{ id: "surfaces/design-guidelines", version: "1.0.1", digest: await publishedDigest(box, "surfaces/design-guidelines", "1.0.1") }]);
    expect((await kc(box, ["add", DESIGN])).out).toContain("is already in the vault, unchanged");

    const zip = join(box.root, "docs.zip");
    await kc(box, ["publish", DOCS]);
    await kc(box, ["export", "surfaces/documentation-guidelines", zip]);
    const other = join(box.root, "vault2");
    const imported = await kc(box, ["add", zip], { vault: other });
    expect(imported.out).toBe("imported surfaces/documentation-guidelines@1.0.1\nthis repository now uses surfaces/documentation-guidelines@1.0.1");

    const bad = join(box.root, "bad.zip");
    await writeFile(bad, "not a zip");
    expect((await kc(box, ["add", bad])).code).toBe(1);
  });
});

describe("status", () => {
  test("rebuilds a deleted index from the files", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    await kc(box, ["publish", DOCS]);
    expect((await kc(box, ["status"])).out).toContain("capsules: 2, versions: 2");
    for (const suffix of ["", "-wal", "-shm"]) await rm(join(box.vault, `database.sqlite${suffix}`), { force: true });
    const result = await kc(box, ["status"]);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("index");
    expect((await stat(join(box.vault, "database.sqlite"))).isFile()).toBe(true);
  });
});

describe("export and import", () => {
  test("round trip keeps the digest", async () => {
    const box = await fresh();
    const other = join(box.root, "vault2");
    await kc(box, ["init"]);
    await kc(box, ["publish", DESIGN]);
    const zip = join(box.root, "out", "design.zip");
    const exported = await kc(box, ["export", "surfaces/design-guidelines@1.0.1", zip]);
    expect(exported.code).toBe(0);
    expect(exported.out).toContain("exported surfaces/design-guidelines@1.0.1 to");
    await kc(box, ["init"], { vault: other });
    const imported = await kc(box, ["import", zip], { vault: other });
    expect(imported.code).toBe(0);
    expect(imported.out).toContain("imported surfaces/design-guidelines@1.0.1");
    expect((await kc(box, ["import", zip], { vault: other })).out).toContain("is already in the vault, unchanged");
  });
});

describe("connect", () => {
  test("writes each harness format, idempotently", async () => {
    const box = await fresh();
    const expectations: Record<string, { file: string; shown: string; check: (text: string) => void }> = {
      "claude-code": {
        file: join(box.project, ".mcp.json"),
        shown: "claude-code can now find your capsules (.mcp.json)",
        check: (t) => expect(JSON.parse(t)).toEqual({ mcpServers: { kc: { command: "/opt/kc/kc", args: ["mcp"], env: { KC_VAULT: box.vault } } } }),
      },
      codex: {
        file: join(box.home, ".codex", "config.toml"),
        shown: "codex can now find your capsules in every repository (~/.codex/config.toml)",
        check: (t) => expect(Bun.TOML.parse(t)).toEqual({ mcp_servers: { kc: { command: "/opt/kc/kc", args: ["mcp"], env: { KC_VAULT: box.vault } } } }),
      },
      opencode: {
        file: join(box.project, "opencode.json"),
        shown: "opencode can now find your capsules (opencode.json)",
        check: (t) => expect(JSON.parse(t)).toEqual({ $schema: "https://opencode.ai/config.json", mcp: { servers: { kc: { type: "local", command: ["/opt/kc/kc", "mcp"], environment: { KC_VAULT: box.vault } } } } }),
      },
      pi: {
        file: join(box.project, ".pi", "mcp.json"),
        shown: "pi can now find your capsules (.pi/mcp.json)",
        check: (t) => expect(JSON.parse(t)).toEqual({ mcpServers: { kc: { command: "/opt/kc/kc", args: ["mcp"], env: { KC_VAULT: box.vault } } } }),
      },
    };
    for (const [target, { file, shown, check }] of Object.entries(expectations)) {
      const first = await kc(box, ["connect", target]);
      expect(first.code).toBe(0);
      expect(first.out).toContain(shown);
      const written = await readFile(file, "utf8");
      check(written);
      await kc(box, ["connect", target]);
      expect(await readFile(file, "utf8")).toBe(written);
    }
    expect((await kc(box, ["connect", "vim"])).code).toBe(1);
    expect((await kc(box, ["connect"])).err).toBe("error: name an agent: claude-code, codex, opencode or pi");
    expect((await kc(box, ["connect", "vim"])).err).toBe("error: unknown agent \"vim\"; use claude-code, codex, opencode or pi");
  });

  test("writes the name kc when kc on PATH is this binary, else the absolute path with a note", async () => {
    const box = await fresh();
    const onPath = await kc(box, ["connect", "claude-code"], { onPath: "/opt/kc/kc" });
    expect(onPath.out).not.toContain("PATH");
    const read = async () => JSON.parse(await readFile(join(box.project, ".mcp.json"), "utf8")) as { mcpServers: { kc: unknown } };
    expect((await read()).mcpServers.kc).toEqual({ command: "kc", args: ["mcp"], env: { KC_VAULT: box.vault } });

    const elsewhere = await kc(box, ["connect", "claude-code"], { onPath: "/other/bin/kc" });
    expect(elsewhere.out).toContain("kc is not on your PATH");
    expect((await read()).mcpServers.kc).toEqual({ command: "/opt/kc/kc", args: ["mcp"], env: { KC_VAULT: box.vault } });

    const none = await kc(box, ["connect", "claude-code"]);
    expect(none.out).toContain("run kc connect again if you move it");
  });

  test("leaves env out without KC_VAULT, passes it in every format, and says so when run from source", async () => {
    const box = await fresh();
    const { run } = await import("../src/cli.ts");
    const lines: string[] = [];
    const bare = await run(["connect", "claude-code"], {
      cwd: box.project, env: {}, home: box.home, self: { command: "/opt/kc/kc", args: ["mcp"], compiled: true }, onPath: () => "/opt/kc/kc",
      out: (l) => lines.push(l), err: (l) => lines.push(l),
    });
    expect(bare).toBe(0);
    expect(JSON.parse(await readFile(join(box.project, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { kc: { command: "kc", args: ["mcp"] } } });

    for (const target of ["codex", "opencode", "pi"]) await kc(box, ["connect", target], { onPath: "/opt/kc/kc" });
    expect(Bun.TOML.parse(await readFile(join(box.home, ".codex", "config.toml"), "utf8"))).toEqual({
      mcp_servers: { kc: { command: "kc", args: ["mcp"], env: { KC_VAULT: box.vault } } },
    });
    expect(JSON.parse(await readFile(join(box.project, "opencode.json"), "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: { kc: { type: "local", command: ["kc", "mcp"], environment: { KC_VAULT: box.vault } } } },
    });
    expect(JSON.parse(await readFile(join(box.project, ".pi", "mcp.json"), "utf8"))).toEqual({
      mcpServers: { kc: { command: "kc", args: ["mcp"], env: { KC_VAULT: box.vault } } },
    });

    const source = await kc(box, ["connect", "claude-code"], { compiled: false });
    expect(source.out).toContain("running from source");
    expect(JSON.parse(await readFile(join(box.project, ".mcp.json"), "utf8")).mcpServers.kc).toEqual({
      command: "/usr/bin/bun", args: ["/src/main.ts", "mcp"], env: { KC_VAULT: box.vault },
    });
  });

  test("keeps other servers and other TOML tables", async () => {
    const box = await fresh();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(box.home, ".codex"), { recursive: true });
    await writeFile(
      join(box.home, ".codex", "config.toml"),
      'model = "x"\n\n[mcp_servers.kc]\ncommand = "old"\n\n[mcp_servers.kc.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "o"\n',
    );
    await kc(box, ["connect", "codex"]);
    const parsed = Bun.TOML.parse(await readFile(join(box.home, ".codex", "config.toml"), "utf8")) as Record<string, any>;
    expect(parsed["model"]).toBe("x");
    expect(parsed["mcp_servers"].kc).toEqual({ command: "/opt/kc/kc", args: ["mcp"], env: { KC_VAULT: box.vault } });
    expect(parsed["mcp_servers"].other).toEqual({ command: "o" });
    await writeFile(join(box.project, ".mcp.json"), JSON.stringify({ mcpServers: { keep: { command: "k" } } }));
    await kc(box, ["connect", "claude-code"]);
    const json = JSON.parse(await readFile(join(box.project, ".mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(json.mcpServers).sort()).toEqual(["kc", "keep"]);
  });

  test("leaves a marked note in CLAUDE.md or AGENTS.md, never twice, and --no-note skips it", async () => {
    const { NOTE_TEXT } = await import("../src/connect.ts");
    const block = `<!-- kc:start -->\n${NOTE_TEXT}\n<!-- kc:end -->`;
    const box = await fresh();
    const first = await kc(box, ["connect", "claude-code"]);
    expect(first.out).toContain("claude-code can now find your capsules (.mcp.json)\nand left a note for it in CLAUDE.md");
    expect(await readFile(join(box.project, "CLAUDE.md"), "utf8")).toBe(`${block}\n`);

    await writeFile(join(box.project, "AGENTS.md"), "# Mine\n\nKeep this.\n");
    for (const target of ["codex", "opencode", "pi"]) expect((await kc(box, ["connect", target])).out).toContain("and left a note for it in AGENTS.md");
    const agents = await readFile(join(box.project, "AGENTS.md"), "utf8");
    expect(agents).toBe(`# Mine\n\nKeep this.\n\n${block}\n`);

    await writeFile(join(box.project, "CLAUDE.md"), `top\n<!-- kc:start -->\nold text\n<!-- kc:end -->\nbottom\n`);
    await kc(box, ["connect", "claude-code"]);
    await kc(box, ["connect", "claude-code"]);
    expect(await readFile(join(box.project, "CLAUDE.md"), "utf8")).toBe(`top\n${block}\nbottom\n`);

    const other = await fresh();
    const skipped = await kc(other, ["connect", "claude-code", "--no-note"]);
    expect(skipped.code).toBe(0);
    expect(skipped.out).not.toContain("left a note");
    expect(await Bun.file(join(other.project, "CLAUDE.md")).exists()).toBe(false);
  });
});

describe("publish a research capsule that declares a profile", () => {
  test("is stored once and leaves the vault usable for status and later publishes", async () => {
    const box = await fresh();
    const dir = join(box.root, "research");
    await cp(join(REPO, "fixtures", "example-capsule"), dir, { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, "capsule.json"), "utf8")) as Record<string, unknown>;
    manifest["kind"] = "research";
    manifest["trigger"] = "Use when reviewing an Electron renderer boundary.";
    delete manifest["digest"];
    await writeFile(join(dir, "capsule.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await kc(box, ["init"]);

    const published = await kc(box, ["publish", dir]);
    expect(published.err).toBe("");
    expect(published.code).toBe(0);

    const status = await kc(box, ["status"]);
    expect(status.err).toBe("");
    expect(status.code).toBe(0);
    expect(status.out).toContain("capsules: 1, versions: 1");

    const other = await kc(box, ["publish", DESIGN]);
    expect(other.err).toBe("");
    expect(other.code).toBe(0);
  });
});

describe("the vault creates itself on the first write", () => {
  test("publish into a fresh vault path works without init", async () => {
    const box = await fresh();
    const result = await kc(box, ["publish", DESIGN]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect((await stat(join(box.vault, "vault.json"))).isFile()).toBe(true);
  });

  test("status and export never create a vault", async () => {
    const box = await fresh();
    expect((await kc(box, ["status"])).code).toBe(1);
    expect((await kc(box, ["export", "surfaces/design-guidelines", join(box.root, "x.zip")])).code).toBe(1);
    await expect(stat(box.vault)).rejects.toThrow();
  });
});

describe("publish --version", () => {
  test("accepts the version that capsule.json declares", async () => {
    const box = await fresh();
    const result = await kc(box, ["publish", DESIGN, "--version", "1.0.1"]);
    expect(result.err).toBe("");
    expect(result.out).toContain("surfaces/design-guidelines@1.0.1");
  });

  test("refuses a different version and publishes nothing", async () => {
    const box = await fresh();
    const result = await kc(box, ["publish", DESIGN, "--version", "2.0.0"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--version 2.0.0 does not match version 1.0.1");
    expect((await kc(box, ["status"])).out).toContain("versions: 0");
  });

  test("rejects other options", async () => {
    const box = await fresh();
    expect((await kc(box, ["publish", DESIGN, "--tag", "x"])).code).toBe(1);
  });
});

describe("version", () => {
  test("--version and version print kc and the baked-in version", async () => {
    const box = await fresh();
    for (const arg of ["--version", "version"]) {
      const result = await kc(box, [arg]);
      expect(result.code).toBe(0);
      expect(result.out).toBe("kc 0.0.0-dev");
    }
  });

  test("a missing version lists the newest three, newest first, and counts the rest", async () => {
    const box = await fresh();
    await kc(box, ["init"]);
    for (const v of ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]) await kc(box, ["publish", await variant(box, DESIGN, `v${v}`, v)]);
    const result = await kc(box, ["add", "surfaces/design-guidelines@9.9.9"]);
    expect(result.err).toBe("error: surfaces/design-guidelines@9.9.9 is not in the vault; it has 1.4.0, 1.3.0, 1.2.0 and 2 more");
  });
});
