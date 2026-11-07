import { realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { KcError } from "@kc/contracts";
import { writeFileAtomic } from "@kc/storage";

export const CONNECT_TARGETS = ["claude-code", "codex", "opencode", "pi"] as const;
export type ConnectTarget = (typeof CONNECT_TARGETS)[number];

const SERVER_NAME = "kc";

export interface StartEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** The running binary: itself when compiled, or `bun <entry> mcp` when run from source. */
export function selfCommand(execPath: string, mainPath: string): { command: string; args: string[]; compiled: boolean } {
  const compiled = !/^bun(\.exe)?$/i.test(basename(execPath));
  return compiled ? { command: execPath, args: ["mcp"], compiled } : { command: execPath, args: [mainPath, "mcp"], compiled };
}

/**
 * What a harness config should hold. Harnesses resolve a command name on PATH, so a binary that
 * `kc` resolves to is written as `kc`; any other binary is written by absolute path with a note.
 * A set KC_VAULT is written into the entry's env so the harness uses the same vault.
 */
export function startEntry(
  self: { command: string; args: string[]; compiled: boolean },
  onPath: string | undefined,
  vault: string | undefined,
): { start: StartEntry; note?: string } {
  const env = vault !== undefined && vault !== "" ? { env: { KC_VAULT: vault } } : {};
  if (!self.compiled) {
    return {
      start: { command: self.command, args: self.args, ...env },
      note: `running from source, so the entry is \`${self.command} ${self.args.join(" ")}\` (absolute paths); it breaks if they move`,
    };
  }
  if (onPath !== undefined && sameFile(onPath, self.command)) {
    return { start: { command: "kc", args: self.args, ...env } };
  }
  return {
    start: { command: self.command, args: self.args, ...env },
    note: "kc is not on your PATH; run kc connect again if you move it",
  };
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const result = await writeFileAtomic(path, text);
  if (!result.ok) throw result.error;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const text = await readText(path);
  if (text === undefined || text.trim() === "") return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new KcError("validation_failed", `${path} is not a plain JSON object; edit it by hand`);
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const tomlString = (s: string): string => JSON.stringify(s);

export function codexBlock(command: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): string {
  const table = `[mcp_servers.${SERVER_NAME}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(", ")}]\ndefault_tools_approval_mode = "approve"\n`;
  const entries = Object.entries(env);
  return entries.length === 0
    ? table
    : `${table}\n[mcp_servers.${SERVER_NAME}.env]\n${entries.map(([k, v]) => `${k} = ${tomlString(v)}\n`).join("")}`;
}

/** Replace the `[mcp_servers.kc]` table (and its sub-tables) or append it; other content is kept byte for byte. */
export function upsertCodexToml(existing: string, command: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): string {
  const block = codexBlock(command, args, env);
  const lines = existing.split("\n");
  const own = (line: string): boolean => {
    const t = line.trim();
    return t === `[mcp_servers.${SERVER_NAME}]` || t.startsWith(`[mcp_servers.${SERVER_NAME}.`);
  };
  const start = lines.findIndex((l) => l.trim() === `[mcp_servers.${SERVER_NAME}]`);
  if (start === -1) {
    const base = existing === "" || existing.endsWith("\n\n") ? existing : existing.endsWith("\n") ? `${existing}\n` : `${existing}\n\n`;
    return base + block;
  }
  let end = start + 1;
  while (end < lines.length && !(lines[end]!.trim().startsWith("[") && !own(lines[end]!))) end++;
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const tail = after.length > 0 && after.join("\n").trim() !== "" ? `\n${after.join("\n")}` : "";
  return `${before.join("\n")}${before.length > 0 ? "\n" : ""}${block}${tail}`;
}

/** Register `kc mcp` in the harness config. Returns the file changed. Idempotent. */
export async function connect(
  target: ConnectTarget,
  where: { project: string; home: string; codexHome?: string },
  start: StartEntry,
): Promise<string> {
  const env = start.env === undefined ? {} : { env: { ...start.env } };
  switch (target) {
    case "claude-code": {
      const path = join(where.project, ".mcp.json");
      const json = await readJson(path);
      json["mcpServers"] = { ...asObject(json["mcpServers"]), [SERVER_NAME]: { command: start.command, args: [...start.args], ...env } };
      await write(path, `${JSON.stringify(json, null, 2)}\n`);
      return path;
    }
    case "pi": {
      const path = join(where.project, ".pi", "mcp.json");
      const json = await readJson(path);
      json["mcpServers"] = { ...asObject(json["mcpServers"]), [SERVER_NAME]: { command: start.command, args: [...start.args], ...env } };
      await write(path, `${JSON.stringify(json, null, 2)}\n`);
      return path;
    }
    case "opencode": {
      // codemode:false exposes kc_list_capsules etc. as direct tools; with the default (true) OpenCode 2.x hides them behind a code interface the model failed to use.
      const path = join(where.project, "opencode.json");
      const json = await readJson(path);
      if (json["$schema"] === undefined) json["$schema"] = "https://opencode.ai/config.json";
      const mcp = asObject(json["mcp"]);
      mcp["servers"] = { ...asObject(mcp["servers"]), [SERVER_NAME]: { type: "local", command: [start.command, ...start.args], codemode: false, ...(start.env === undefined ? {} : { environment: { ...start.env } }) } };
      json["mcp"] = mcp;
      await write(path, `${JSON.stringify(json, null, 2)}\n`);
      return path;
    }
    case "codex": {
      // Codex reads $CODEX_HOME/config.toml when CODEX_HOME is set (default ~/.codex).
      const path = join(where.codexHome !== undefined && where.codexHome !== "" ? where.codexHome : join(where.home, ".codex"), "config.toml");
      await write(path, upsertCodexToml((await readText(path)) ?? "", start.command, start.args, start.env));
      return path;
    }
  }
}

/** The one place the agent note's text lives. docs/cli.md quotes it. */
export const NOTE_TEXT =
  'This repository uses Knowledge Capsules. Before any task, call list_capsules and read every capsule whose "use when" line matches the task. Those capsules outrank anything else you find here. After a capsule shaped your work, call report_usage once.';
const NOTE_START = "<!-- kc:start -->";
const NOTE_END = "<!-- kc:end -->";
const NOTE_BLOCK = `${NOTE_START}\n${NOTE_TEXT}\n${NOTE_END}`;

/** The instruction file each agent reads in a repository. */
export function noteFile(target: ConnectTarget): "CLAUDE.md" | "AGENTS.md" {
  return target === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
}

/** Put the note block into an instruction file's text: replace it in place, else append after one blank line. */
export function upsertNote(existing: string): string {
  const start = existing.indexOf(NOTE_START);
  const end = start === -1 ? -1 : existing.indexOf(NOTE_END, start);
  if (start !== -1 && end !== -1) return existing.slice(0, start) + NOTE_BLOCK + existing.slice(end + NOTE_END.length);
  if (existing.trim() === "") return `${NOTE_BLOCK}\n`;
  const base = existing.endsWith("\n\n") ? existing : existing.endsWith("\n") ? `${existing}\n` : `${existing}\n\n`;
  return `${base}${NOTE_BLOCK}\n`;
}

/** Write the note into the repository's instruction file for this agent. Returns the file name. */
export async function leaveNote(target: ConnectTarget, project: string): Promise<string> {
  const name = noteFile(target);
  const path = join(project, name);
  await write(path, upsertNote((await readText(path)) ?? ""));
  return name;
}
