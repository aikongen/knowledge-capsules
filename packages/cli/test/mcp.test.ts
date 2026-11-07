import { afterAll, expect, test } from "bun:test";
import { rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { DESIGN, DOCS, ENTRY, kc, publishedDigest, sandbox } from "./helpers.ts";


type Block = { type: string; text: string };
const blocks = (result: unknown): Block[] => (result as { content: Block[] }).content;

test("mcp over stdio exposes exactly the four tools and answers all of them", async () => {
  const box = await sandbox();
  afterAll(() => rm(box.root, { recursive: true, force: true }));
  await kc(box, ["init"]);
  await kc(box, ["publish", DESIGN]);
  await kc(box, ["publish", DOCS]);
  const DESIGN_DIGEST = await publishedDigest(box, "surfaces/design-guidelines", "1.0.1");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", ENTRY, "mcp"],
    cwd: box.project,
    env: { ...(process.env as Record<string, string>), KC_VAULT: box.vault },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["get_capsule", "get_version", "list_capsules", "report_usage"]);

    const listed = JSON.parse(blocks(await client.callTool({ name: "list_capsules", arguments: {} }))[0]!.text) as { id: string; trigger: string }[];
    expect(listed.map((c) => c.id)).toEqual(["surfaces/design-guidelines", "surfaces/documentation-guidelines"]);
    expect(listed.every((c) => c.trigger.length > 0)).toBe(true);
    expect(listed.every((c) => Object.keys(c).sort().join() === "id,trigger,version")).toBe(true);

    const capsule = blocks(await client.callTool({ name: "get_capsule", arguments: { id: "surfaces/design-guidelines" } }));
    expect(JSON.parse(capsule[0]!.text)).toMatchObject({ id: "surfaces/design-guidelines", version: "1.0.1", digest: DESIGN_DIGEST, kind: "guidelines" });
    expect(capsule[1]!.text).toBe(await readFile(join(DESIGN, "canonical.md"), "utf8"));

    const exact = blocks(await client.callTool({ name: "get_version", arguments: { digest: DESIGN_DIGEST } }));
    expect(JSON.parse(exact[0]!.text).digest).toBe(DESIGN_DIGEST);
    expect(exact[1]!.text).toBe(capsule[1]!.text);

    const missing = await client.callTool({ name: "get_version", arguments: { digest: "sha256:" + "0".repeat(64) } });
    expect((missing as { isError?: boolean }).isError).toBe(true);

    const usage = await client.callTool({
      name: "report_usage",
      arguments: { capsule: "surfaces/design-guidelines", digest: DESIGN_DIGEST, note: "layout rules" },
    });
    expect((usage as { isError?: boolean }).isError).toBeUndefined();
    expect(JSON.parse(blocks(usage)[0]!.text)).toEqual({ recorded: true });
    const files = await readdir(join(box.vault, "usage"));
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(join(box.vault, "usage", files[0]!), "utf8"))).toMatchObject({
      capsule: "surfaces/design-guidelines",
      digest: DESIGN_DIGEST,
      note: "layout rules",
    });
  } finally {
    await client.close();
  }
}, 30_000);

test("inside a repository with kc.json, list_capsules shows only the pinned capsules", async () => {
  const box = await sandbox();
  afterAll(() => rm(box.root, { recursive: true, force: true }));
  await kc(box, ["init"]);
  await kc(box, ["publish", DOCS]);
  await kc(box, ["publish", DESIGN]);
  await kc(box, ["add", "surfaces/design-guidelines@1.0.1"]);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["run", ENTRY, "mcp"],
      cwd: box.project,
      env: { ...(process.env as Record<string, string>), KC_VAULT: box.vault },
    }),
  );
  try {
    const listed = JSON.parse(blocks(await client.callTool({ name: "list_capsules", arguments: {} }))[0]!.text) as { id: string }[];
    expect(listed.map((c) => c.id)).toEqual(["surfaces/design-guidelines"]);
  } finally {
    await client.close();
  }
}, 30_000);

test("mcp against a missing vault does not create one", async () => {
  const box = await sandbox();
  afterAll(() => rm(box.root, { recursive: true, force: true }));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(box.project, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", ENTRY, "mcp"],
    cwd: box.project,
    env: { ...(process.env as Record<string, string>), KC_VAULT: box.vault },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    await client.callTool({ name: "list_capsules", arguments: {} });
  } finally {
    await client.close();
  }
  const { stat } = await import("node:fs/promises");
  await expect(stat(box.vault)).rejects.toThrow();
});
