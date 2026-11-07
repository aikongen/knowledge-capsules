import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { KcError } from "@kc/contracts";

import { readRepoManifest } from "./repo-manifest.ts";
import { VERSION } from "./version.ts";
import type { LoadedVersion, Vault } from "./vault.ts";

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (value: string): Reply => ({ content: [{ type: "text", text: value }] });
const json = (value: unknown): Reply => text(JSON.stringify(value, null, 2));

function core(loaded: LoadedVersion) {
  const m = loaded.manifest;
  return { id: m.id, version: m.version, digest: loaded.record.digest, kind: m.kind, trigger: m.trigger, scope: m.scope };
}

function content(loaded: LoadedVersion): string {
  const path = loaded.manifest.contents.canonical;
  const bytes = loaded.pkg.entries.get(path);
  return bytes === undefined ? "" : new TextDecoder().decode(bytes);
}

/** A capsule reply: first block the core as JSON, second block the markdown content. */
function capsuleReply(loaded: LoadedVersion): Reply {
  return { content: [{ type: "text", text: JSON.stringify(core(loaded), null, 2) }, { type: "text", text: content(loaded) }] };
}

async function guard(work: () => Promise<Reply>): Promise<Reply> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof KcError ? `${error.code}: ${error.message}` : String(error);
    return { ...text(message), isError: true };
  }
}

export function buildServer(vault: Vault, cwd: string): McpServer {
  const server = new McpServer({ name: "KnowledgeCapsules", title: "KnowledgeCapsules", version: VERSION });

  server.registerTool(
    "list_capsules",
    { description: 'Call at the start of a task. Lists the knowledge capsules for this repository, each with a "use when" line.' },
    () =>
      guard(async () => {
        const pins = (await readRepoManifest(cwd))?.capsules;
        const records = pins !== undefined
          ? await Promise.all(pins.map((p) => vault.resolve(p.id, p.version)))
          : (await Promise.all((await vault.capsuleIds()).map((id) => vault.latest(id)))).filter((r) => r !== undefined);
        const listed = [];
        for (const record of records) {
          const loaded = await vault.load(record);
          listed.push({ id: record.id, version: record.version, trigger: loaded.manifest.trigger });
        }
        return json(listed);
      }),
  );

  server.registerTool(
    "get_capsule",
    {
      description: 'Read a capsule whose "use when" line matches your task. Returns its details as JSON, then its text.',
      inputSchema: {
        id: z.string().describe("capsule id, for example surfaces/design-guidelines"),
        version: z.string().optional().describe("optional; X.Y.Z; if left out, the version this repository uses, else the newest"),
      },
    },
    ({ id, version }: { id: string; version?: string | undefined }) =>
      guard(async () => {
        const pinned = version ?? (await readRepoManifest(cwd))?.capsules.find((p) => p.id === id)?.version;
        return capsuleReply(await vault.load(await vault.resolve(id, pinned)));
      }),
  );

  server.registerTool(
    "get_version",
    {
      description: "Read the exact version a fingerprint (sha256:...) names, for example one quoted earlier. Rarely needed.",
      inputSchema: { digest: z.string().describe("fingerprint sha256:... as returned by get_capsule") },
    },
    ({ digest }: { digest: string }) =>
      guard(async () => {
        const record = await vault.byDigest(digest);
        if (record === undefined) throw new KcError("not_found", `no version with fingerprint ${digest}`);
        return capsuleReply(await vault.load(record));
      }),
  );

  server.registerTool(
    "report_usage",
    {
      description: "Call once after a capsule shaped your work. kc records it in the vault's usage log.",
      inputSchema: {
        capsule: z.string().describe("capsule id, for example surfaces/design-guidelines"),
        digest: z.string().optional().describe("fingerprint sha256:... as returned by get_capsule"),
        note: z.string().optional().describe("one line on how it helped"),
      },
    },
    (input: { capsule: string; digest?: string | undefined; note?: string | undefined }) =>
      guard(async () => {
        await vault.recordUsage({
          capsule: input.capsule,
          ...(input.digest === undefined ? {} : { digest: input.digest }),
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        return json({ recorded: true });
      }),
  );

  return server;
}

export async function serveMcp(vault: Vault, cwd: string): Promise<void> {
  await buildServer(vault, cwd).connect(new StdioServerTransport());
}
