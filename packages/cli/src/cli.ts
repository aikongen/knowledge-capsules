import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { MANIFEST_PATH, parseManifest, readZipArchive, createCapsulePackage, writeDeterministicZip } from "@kc/capsule-format";
import { KcError } from "@kc/contracts";

import { adviceCount, checkCapsule, checkSet, formatReport, type CheckInput, type Finding } from "./check.ts";
import { CONNECT_TARGETS, connect, leaveNote, startEntry, type ConnectTarget } from "./connect.ts";
import { serveMcp } from "./mcp.ts";
import { VERSION } from "./version.ts";
import { readRepoManifest, withPin, writeRepoManifest } from "./repo-manifest.ts";
import { Vault, defaultVaultPath, type LoadedVersion, type VersionRecord } from "./vault.ts";

export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** How the running binary starts `kc mcp`; `compiled` is false when run from source with bun. */
  readonly self: { command: string; args: string[]; compiled: boolean };
  /** Absolute path the name `kc` resolves to on PATH, if any. */
  readonly onPath?: (name: string) => string | undefined;
  out(line: string): void;
  err(line: string): void;
}

const COMMANDS: readonly (readonly [string, string])[] = [
  ["publish <folder>", "save a capsule folder as a new version"],
  ["add <id[@version]>", "use a capsule in this repository"],
  ["connect <agent>", "let that coding agent find your capsules (--no-note: skip the note)"],
  ["check [folder]", "advice on a capsule folder, or on this repository's capsules"],
  ["status", "show the vault and this repository's capsules"],
  ["", ""],
  ["update [id]", "use the newest versions from the vault"],
  ["remove <id>", "stop using a capsule in this repository"],
  ["export <id>[@version] <file.zip>", "save a capsule as a zip file to share"],
  ["import <file.zip>", "add a shared zip file to the vault"],
  ["init", "create the vault (other commands do it too)"],
];
const WIDTH = Math.max(...COMMANDS.map(([left]) => left.length)) + 2;
const row = ([left, right]: readonly [string, string]): string => `  ${left.padEnd(WIDTH)}${right}`;

export const USAGE = `kc <command>

${COMMANDS.slice(0, 5).map(row).join("\n")}

More:
${COMMANDS.slice(6).map(row).join("\n")}

add also takes a folder or a zip file and saves it to the vault first.
connect takes ${CONNECT_TARGETS.slice(0, -1).join(", ")} or ${CONNECT_TARGETS.at(-1)}.
Vault: $KC_VAULT, else $XDG_DATA_HOME/kc/vault, else ~/.local/share/kc/vault.`;

function splitRef(ref: string): { id: string; version?: string } {
  const at = ref.lastIndexOf("@");
  return at > 0 ? { id: ref.slice(0, at), version: ref.slice(at + 1) } : { id: ref };
}

async function packageFrom(path: string, shown?: string) {
  if (path.endsWith(".zip")) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") throw new KcError("not_found", `${shown ?? path} does not exist`);
      throw error;
    }
    return createCapsulePackage(readZipArchive(bytes));
  }
  return (await import("./vault.ts")).readFolder(path);
}

/** A path when it ends in .zip, looks like one (starts with . / ~ or has a drive), or exists on disk; otherwise an id[@version]. */
async function isPath(absolute: string, raw: string): Promise<boolean> {
  if (raw.endsWith(".zip") || /^(\.|\/|~|[A-Za-z]:[\\/])/.test(raw)) return true;
  try {
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

function need(args: readonly string[], count: number, usage: string): void {
  if (args.length !== count) throw new KcError("validation_failed", `usage: kc ${usage}`);
}

async function publishFolder(io: Io, vault: Vault, args: string[]) {
  const usage = "publish <folder> [--version X.Y.Z]";
  const rest = args.filter((a) => !a.startsWith("--"));
  const flags = args.filter((a) => a.startsWith("--"));
  const at = args.indexOf("--version");
  const eq = flags.find((f) => f.startsWith("--version="));
  let wanted: string | undefined;
  if (at >= 0) {
    wanted = args[at + 1];
    if (wanted === undefined || wanted.startsWith("--")) throw new KcError("validation_failed", `usage: kc ${usage}`);
    rest.splice(rest.indexOf(wanted), 1);
  } else if (eq !== undefined) {
    wanted = eq.slice("--version=".length);
  }
  if (rest.length !== 1 || flags.some((f) => f !== "--version" && !f.startsWith("--version="))) {
    throw new KcError("validation_failed", `usage: kc ${usage}`);
  }
  await vault.init();
  return { ...(await vault.publish(resolve(io.cwd, rest[0]!), wanted)), folder: rest[0]! };
}

/** What kc check reads from a capsule folder: the same files kc publish reads. */
async function checkInputFromFolder(folder: string): Promise<CheckInput> {
  const pkg = await packageFrom(folder);
  const bytes = pkg.entries.get(MANIFEST_PATH);
  if (bytes === undefined) throw new KcError("validation_failed", `${folder} has no capsule.json; see docs/capsule-format.md`);
  const manifest = parseManifest(bytes);
  const canonical = pkg.entries.get(manifest.contents.canonical);
  if (canonical === undefined) throw new KcError("validation_failed", `${folder} has no ${manifest.contents.canonical}; see docs/capsule-format.md`);
  return { id: manifest.id, version: manifest.version, trigger: manifest.trigger, canonical: new TextDecoder().decode(canonical) };
}

function checkInputFromVault(loaded: LoadedVersion): CheckInput {
  const canonical = loaded.pkg.entries.get(loaded.manifest.contents.canonical);
  return {
    id: loaded.record.id,
    version: loaded.record.version,
    trigger: loaded.manifest.trigger,
    canonical: canonical === undefined ? "" : new TextDecoder().decode(canonical),
  };
}

const piecesOfAdvice = (findings: readonly Finding[]): string => {
  const n = adviceCount(findings);
  return `${n} ${n === 1 ? "piece" : "pieces"} of advice`;
};

async function exec(io: Io, command: string, args: string[]): Promise<void> {
  const vault = new Vault(defaultVaultPath(io.env));
  const abs = (p: string) => resolve(io.cwd, p);
  switch (command) {
    case "init": {
      need(args, 0, "init");
      const fresh = await vault.init();
      io.out(`${fresh ? "created the vault at" : "the vault already exists at"} ${vault.layout.root}`);
      return;
    }
    case "publish": {
      const { record, created, folder } = await publishFolder(io, vault, args);
      io.out(created ? `published ${record.id}@${record.version}` : `${record.id}@${record.version} is already in the vault, unchanged`);
      try {
        const findings = checkCapsule(await checkInputFromFolder(abs(folder)));
        if (adviceCount(findings) > 0) io.out(`${piecesOfAdvice(findings)}; run kc check ${folder}`);
      } catch {
        // the capsule is published; advice is a courtesy and never turns a success into a failure
      }
      return;
    }
    case "check": {
      if (args.length > 1) throw new KcError("validation_failed", "usage: kc check [folder]");
      if (args.length === 1) {
        const input = await checkInputFromFolder(abs(args[0]!));
        for (const line of formatReport(input, checkCapsule(input))) io.out(line);
        return;
      }
      const pins = (await readRepoManifest(io.cwd))?.capsules;
      if (pins === undefined) {
        io.out("this repository has no kc.json; nothing to check");
        return;
      }
      await vault.assertExists();
      const inputs: CheckInput[] = [];
      for (const pin of pins) {
        let record: VersionRecord;
        try {
          record = await vault.resolve(pin.id, pin.version);
        } catch (error) {
          if (!(error instanceof KcError) || error.code !== "not_found") throw error;
          io.out(`skipped: ${pin.id}@${pin.version} is not in the vault`);
          continue;
        }
        const input = checkInputFromVault(await vault.load(record));
        inputs.push(input);
        for (const line of formatReport(input, checkCapsule(input))) io.out(line);
      }
      for (const line of checkSet(inputs)) io.out(line);
      return;
    }
    case "add": {
      need(args, 1, "add <id@version|folder|file.zip>");
      const arg = args[0]!;
      let record: VersionRecord;
      if (await isPath(abs(arg), arg)) {
        await vault.init();
        let created: boolean;
        if (arg.endsWith(".zip")) {
          ({ record, created } = await vault.store(await packageFrom(abs(arg), arg)));
          io.out(created ? `imported ${record.id}@${record.version}` : `${record.id}@${record.version} is already in the vault, unchanged`);
        } else {
          ({ record, created } = await publishFolder(io, vault, [arg]));
          io.out(created ? `published ${record.id}@${record.version}` : `${record.id}@${record.version} is already in the vault, unchanged`);
        }
      } else {
        const ref = splitRef(arg);
        record = await vault.resolve(ref.id, ref.version);
        await vault.load(record);
      }
      const pins = (await readRepoManifest(io.cwd))?.capsules ?? [];
      await writeRepoManifest(io.cwd, withPin(pins, { id: record.id, version: record.version, digest: record.digest }));
      io.out(`this repository now uses ${record.id}@${record.version}`);
      return;
    }
    case "import": {
      need(args, 1, "import <file.zip>");
      await vault.init();
      const { record, created } = await vault.store(await packageFrom(abs(args[0]!), args[0]!));
      io.out(created ? `imported ${record.id}@${record.version}` : `${record.id}@${record.version} is already in the vault, unchanged`);
      return;
    }
    case "remove": {
      need(args, 1, "remove <id>");
      const pins = (await readRepoManifest(io.cwd))?.capsules ?? [];
      if (!pins.some((p) => p.id === args[0])) throw new KcError("not_found", `${args[0]} is not used in this repository`);
      await writeRepoManifest(io.cwd, pins.filter((p) => p.id !== args[0]));
      io.out(`${args[0]} removed from this repository; the vault keeps it`);
      return;
    }
    case "update": {
      if (args.length > 1) throw new KcError("validation_failed", "usage: kc update [id]");
      await vault.assertExists();
      let pins = (await readRepoManifest(io.cwd))?.capsules ?? [];
      const targets = pins.filter((p) => args[0] === undefined || p.id === args[0]);
      if (targets.length === 0) throw new KcError("not_found", args[0] ? `${args[0]} is not used in this repository` : "this repository uses no capsules");
      for (const pin of targets) {
        const latest = await vault.resolve(pin.id);
        if (latest.digest === pin.digest) {
          io.out(`${pin.id}@${pin.version} is the latest`);
          continue;
        }
        pins = withPin(pins, { id: latest.id, version: latest.version, digest: latest.digest });
        io.out(latest.version === pin.version ? `${pin.id}@${pin.version} refreshed from the vault` : `${pin.id}: ${pin.version} -> ${latest.version}`);
      }
      await writeRepoManifest(io.cwd, pins);
      return;
    }
    case "status": {
      need(args, 0, "status");
      await vault.assertExists();
      const versions = await vault.allVersions();
      const ids = await vault.capsuleIds();
      await vault.ensureIndex();
      io.out(`vault: ${vault.layout.root}`);
      io.out(`capsules: ${ids.length}, versions: ${versions.length}`);
      for (const pin of (await readRepoManifest(io.cwd))?.capsules ?? []) {
        const latest = await vault.latest(pin.id);
        const ref = `${pin.id}@${pin.version}`;
        io.out(
          latest === undefined
            ? `${ref} is not in the vault`
            : latest.digest === pin.digest
              ? `${ref} is up to date`
              : latest.version !== pin.version
                ? `${ref}: ${latest.version} is available; run kc update`
                : `${ref} changed in the vault; run kc update`,
        );
      }
      return;
    }
    case "export": {
      need(args, 2, "export <id>[@version] <file.zip>");
      await vault.assertExists();
      const ref = splitRef(args[0]!);
      const record: VersionRecord = await vault.resolve(ref.id, ref.version);
      const bytes = await vault.exportVersion(record, writeDeterministicZip);
      const target = abs(args[1]!);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      io.out(`exported ${record.id}@${record.version} to ${target}`);
      return;
    }
    case "connect": {
      const names = `${CONNECT_TARGETS.slice(0, -1).join(", ")} or ${CONNECT_TARGETS.at(-1)}`;
      if (args.length === 0) throw new KcError("validation_failed", `name an agent: ${names}`);
      const noNote = args.includes("--no-note");
      const rest = args.filter((a) => a !== "--no-note");
      need(rest, 1, `connect ${CONNECT_TARGETS.join("|")} [--no-note]`);
      args = rest;
      if (!CONNECT_TARGETS.includes(args[0] as ConnectTarget)) {
        throw new KcError("validation_failed", `unknown agent "${args[0]}"; use ${names}`);
      }
      const entry = startEntry(io.self, io.onPath?.("kc"), io.env["KC_VAULT"]);
      const file = await connect(args[0] as ConnectTarget, { project: io.cwd, home: io.home, ...(io.env["CODEX_HOME"] ? { codexHome: io.env["CODEX_HOME"] } : {}) }, entry.start);
      io.out(
        args[0] === "codex"
          ? `codex can now find your capsules in every repository (${shownPath(file, io)})`
          : `${args[0]} can now find your capsules (${shownPath(file, io)})`,
      );
      if (!noNote) io.out(`and left a note for it in ${await leaveNote(args[0] as ConnectTarget, io.cwd)}`);
      if (entry.note !== undefined) io.out(entry.note);
      return;
    }
    case "mcp": {
      need(args, 0, "mcp");
      await serveMcp(vault, io.cwd);
      return;
    }
    default:
      throw new KcError("validation_failed", `unknown command "${command}"; see kc --help`);
  }
}

/** The path relative to the current directory when inside it; `~` for the home folder; else absolute. */
function shownPath(file: string, io: Io): string {
  const rel = relative(io.cwd, file);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  const home = relative(io.home, file);
  return home !== "" && !home.startsWith("..") && !isAbsolute(home) ? `~/${home.split(sep).join("/")}` : file;
}

/** Extra lines of a failure: one plain sentence each, without JSON paths or rule codes. */
function detailLines(error: KcError): string[] {
  const lines: string[] = [];
  for (const d of error.details) {
    const at = d.at ?? "";
    const showAt = at !== "" && !at.startsWith("/") && !at.includes("#") && !d.message.includes(at);
    const line = showAt ? `${at}: ${d.message}` : d.message;
    if (line !== error.message && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

/** Runs one command. Returns the exit code. `mcp` resolves only when its stream ends. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [command = "", ...args] = argv;
  if (command === "--version" || command === "version") {
    io.out(`kc ${VERSION}`);
    return 0;
  }
  if (command === "" || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return command === "" ? 1 : 0;
  }
  try {
    await exec(io, command, args);
    return 0;
  } catch (error) {
    if (error instanceof KcError) {
      io.err(/^(usage:|unknown command)/.test(error.message) ? error.message : `error: ${error.message}`);
      for (const line of detailLines(error)) io.err(`  ${line}`);
    } else {
      io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 1;
  }
}
