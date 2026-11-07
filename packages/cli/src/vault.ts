import { mkdir, readdir, readFile, lstat, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import {
  assertCapsulePackage,
  createCapsulePackage,
  MANIFEST_PATH,
  parseManifest,
  type CapsuleManifest,
  type CapsulePackage,
} from "@kc/capsule-format";
import { KcError } from "@kc/contracts";
import { compareSemver, parseCapsuleId, capsuleIdParts } from "@kc/domain";
import {
  openSqliteStorage,
  parseCapsuleRegistry,
  publishDirectoryAtomic,
  rebuildCatalogFromCanonicalVault,
  registerPublishedVersion,
  resolveCapsuleVersionDir,
  vaultLayout,
  withWriteGuard,
  writeFileAtomic,
  writeFileCreateOnlyAtomic,
  writeJsonAtomic,
  type CapsuleRegistry,
  type VaultLayout,
} from "@kc/storage";

export interface VersionRecord {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly status: string;
  readonly publishedAt: string;
}

export interface LoadedVersion {
  readonly record: VersionRecord;
  readonly manifest: CapsuleManifest;
  readonly pkg: CapsulePackage;
}

/** Vault location: KC_VAULT, else the XDG data directory (see docs/cli.md). */
export function defaultVaultPath(env: Readonly<Record<string, string | undefined>>): string {
  if (env["KC_VAULT"] !== undefined && env["KC_VAULT"] !== "") return env["KC_VAULT"];
  const data = env["XDG_DATA_HOME"] !== undefined && env["XDG_DATA_HOME"] !== ""
    ? env["XDG_DATA_HOME"]
    : join(env["HOME"] ?? env["USERPROFILE"] ?? homedir(), ".local", "share");
  return join(data, "kc", "vault");
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: KcError }): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class Vault {
  readonly layout: VaultLayout;
  constructor(root: string) {
    this.layout = vaultLayout(root);
  }

  /** Create the vault tree. Idempotent. */
  async init(): Promise<boolean> {
    const fresh = !(await exists(this.layout.vaultManifestPath));
    await mkdir(this.layout.capsulesDir, { recursive: true });
    await mkdir(join(this.layout.root, "usage"), { recursive: true });
    if (fresh) must(await writeJsonAtomic(this.layout.vaultManifestPath, { schemaVersion: "0.1" }));
    return fresh;
  }

  async assertExists(): Promise<void> {
    if (!(await exists(this.layout.vaultManifestPath))) {
      throw new KcError("vault_not_found", `no vault at ${this.layout.root}; run kc init`);
    }
  }

  /** One writer at a time: an exclusive SQLite guard held for the duration of a write command. */
  async withWriteLease<T>(work: () => Promise<T>): Promise<T> {
    await this.assertExists();
    return withWriteGuard(this.layout.root, work);
  }

  private registryPath(id: string): string {
    const parts = capsuleIdParts(must(parseCapsuleId(id, "/id")));
    return join(this.layout.capsulesDir, parts.namespace, parts.slug, "registry.json");
  }

  async readRegistry(id: string): Promise<CapsuleRegistry> {
    const path = this.registryPath(id);
    if (!(await exists(path))) {
      return parseCapsuleRegistry({ schemaVersion: "0.1", capsuleId: id, revision: 0, versions: [] });
    }
    return parseCapsuleRegistry(JSON.parse(await readFile(path, "utf8")));
  }

  async capsuleIds(): Promise<string[]> {
    const ids: string[] = [];
    if (!(await exists(this.layout.capsulesDir))) return ids;
    for (const ns of await readdir(this.layout.capsulesDir, { withFileTypes: true })) {
      if (!ns.isDirectory()) continue;
      for (const slug of await readdir(join(this.layout.capsulesDir, ns.name), { withFileTypes: true })) {
        if (slug.isDirectory() && (await exists(join(this.layout.capsulesDir, ns.name, slug.name, "registry.json")))) {
          ids.push(`${ns.name}/${slug.name}`);
        }
      }
    }
    return ids.sort();
  }

  async versions(id: string): Promise<VersionRecord[]> {
    const registry = await this.readRegistry(id);
    return registry.versions
      .map((v) => ({ id, version: v.version, digest: v.digest, status: v.status, publishedAt: v.publishedAt }))
      .sort((a, b) => compareSemver(a.version, b.version));
  }

  async allVersions(): Promise<VersionRecord[]> {
    const all: VersionRecord[] = [];
    for (const id of await this.capsuleIds()) all.push(...(await this.versions(id)));
    return all;
  }

  /** Highest semantic version of a capsule (any lifecycle status is still readable). */
  async latest(id: string): Promise<VersionRecord | undefined> {
    return (await this.versions(id)).at(-1);
  }

  async load(record: VersionRecord): Promise<LoadedVersion> {
    const dir = must(
      resolveCapsuleVersionDir(
        this.layout,
        capsuleIdParts(must(parseCapsuleId(record.id, "/id"))).namespace,
        capsuleIdParts(must(parseCapsuleId(record.id, "/id"))).slug,
        record.version,
        record.digest,
      ),
    );
    const pkg = await readFolder(dir);
    const validation = assertCapsulePackage(pkg, { minimumVerifiedEvidencePerMaterialItem: 0, mode: "import" });
    if (validation.digest !== record.digest) {
      throw new KcError("digest_mismatch", `${record.id}@${record.version} in the vault was changed on disk; publish or import it again`);
    }
    return { record, manifest: validation.manifest, pkg };
  }

  /** Find the exact version with this digest in any capsule. */
  async byDigest(digest: string): Promise<VersionRecord | undefined> {
    return (await this.allVersions()).find((v) => v.digest === digest);
  }

  /** " Did you mean Y?" when exactly one vault id is within edit distance 2. */
  private async didYouMean(id: string): Promise<string> {
    const near = (await this.capsuleIds()).filter((other) => other !== id && editDistance(id, other) <= 2);
    return near.length === 1 ? ` Did you mean ${near[0]}?` : "";
  }

  async resolve(id: string, version?: string): Promise<VersionRecord> {
    const versions = await this.versions(id);
    const found = version === undefined ? versions.at(-1) : versions.find((v) => v.version === version);
    if (found === undefined) {
      if (versions.length > 0) {
        const newest = versions.map((v) => v.version).reverse();
        const shown = newest.slice(0, 3).join(", ");
        const more = newest.length > 3 ? ` and ${newest.length - 3} more` : "";
        throw new KcError("not_found", `${id}@${version} is not in the vault; it has ${shown}${more}`);
      }
      const hint = await this.didYouMean(id);
      throw new KcError("not_found", `${version === undefined ? id : `${id}@${version}`} is not in the vault. To add a new capsule, run kc publish <folder> first.${hint}`);
    }
    return found;
  }

  /**
   * Take a published capsule package into the vault. The same id+version with a
   * different digest is refused (immutable_version); the same digest is a no-op.
   * Files of a stored version are never rewritten.
   */
  async store(pkg: CapsulePackage): Promise<{ record: VersionRecord; created: boolean }> {
    const validation = assertCapsulePackage(pkg, { minimumVerifiedEvidencePerMaterialItem: 0, mode: "import" });
    const manifest = validation.manifest;
    if (manifest.status !== "published" || manifest.digest === undefined || manifest.publishedAt === undefined) {
      throw new KcError("validation_failed", "publish this folder first: kc publish <folder>");
    }
    const record: VersionRecord = {
      id: manifest.id,
      version: manifest.version,
      digest: manifest.digest,
      status: "published",
      publishedAt: String(manifest.publishedAt),
    };
    return this.withWriteLease(async () => {
      const registry = await this.readRegistry(record.id);
      const next = registerPublishedVersion(registry, {
        version: record.version,
        digest: record.digest,
        status: "published",
        publishedAt: record.publishedAt,
      });
      if (next === registry) return { record, created: false };
      const parts = capsuleIdParts(must(parseCapsuleId(record.id, "/id")));
      const dir = must(
        resolveCapsuleVersionDir(this.layout, parts.namespace, parts.slug, record.version, record.digest),
      );
      if (!(await exists(dir))) {
        await mkdir(dirname(dir), { recursive: true });
        must(
          await publishDirectoryAtomic(dir, async (staging) => {
            for (const [path, bytes] of pkg.entries) {
              const target = join(staging, ...path.split("/"));
              await mkdir(dirname(target), { recursive: true });
              must(await writeFileAtomic(target, bytes));
            }
          }),
        );
      }
      must(await writeJsonAtomic(this.registryPath(record.id), next));
      await this.rebuildIndex();
      return { record, created: true };
    });
  }

  /**
   * Make an immutable published version out of a capsule folder. The folder is
   * not modified. Re-publishing identical content keeps the earlier publishedAt,
   * so it is a no-op; the same id+version with different content is refused.
   */
  async publish(folder: string, expectVersion?: string): Promise<{ record: VersionRecord; created: boolean }> {
    const source = await readFolder(folder);
    const bytes = source.entries.get(MANIFEST_PATH);
    if (bytes === undefined) throw new KcError("validation_failed", `${folder} has no capsule.json; see docs/capsule-format.md`);
    const draft = parseManifest(bytes);
    if (expectVersion !== undefined && expectVersion !== draft.version) {
      throw new KcError(
        "validation_failed",
        `--version ${expectVersion} does not match version ${draft.version} in ${folder}/capsule.json; change capsule.json or the option`,
      );
    }
    const prior = (await this.versions(draft.id)).find((v) => v.version === draft.version);
    const publishedAt = prior?.publishedAt ?? draft.publishedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const { digest: _d, ...rest } = draft;
    const withStatus = (status: string, digest?: string) => ({
      ...rest,
      status,
      publishedAt,
      ...(digest === undefined ? {} : { digest }),
    });
    const pack = (manifest: object): CapsulePackage => {
      const entries = new Map(source.entries);
      entries.set(MANIFEST_PATH, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
      return { entries };
    };
    const first = assertCapsulePackage(pack(withStatus("draft")), {
      minimumVerifiedEvidencePerMaterialItem: 0,
      mode: "publication",
      requireDigest: false,
    });
    if (draft.digest !== undefined) {
      const own = draft.publishedAt === undefined || draft.publishedAt === publishedAt
        ? first.digest
        : assertCapsulePackage(pack({ ...withStatus("draft"), publishedAt: draft.publishedAt }), {
            minimumVerifiedEvidencePerMaterialItem: 0,
            mode: "publication",
            requireDigest: false,
          }).digest;
      if (draft.digest !== own) {
        throw new KcError("digest_mismatch", "capsule.json digest does not match the files; remove it and publish again");
      }
    }
    const published = pack(withStatus("published", first.digest));
    assertCapsulePackage(published, { minimumVerifiedEvidencePerMaterialItem: 0, mode: "publication" });
    return this.store(published);
  }

  /** Portable zip of one stored version. */
  async exportVersion(record: VersionRecord, writeZip: (entries: { path: string; bytes: Uint8Array }[]) => Uint8Array): Promise<Uint8Array> {
    const loaded = await this.load(record);
    return writeZip([...loaded.pkg.entries].map(([path, bytes]) => ({ path, bytes })));
  }

  /** Recreate database.sqlite from the plain files. */
  async rebuildIndex(): Promise<{ entries: number }> {
    for (const suffix of ["", "-wal", "-shm"]) await rm(this.layout.databasePath + suffix, { force: true });
    const storage = openSqliteStorage(this.layout.databasePath);
    try {
      const result = await rebuildCatalogFromCanonicalVault(storage, this.layout.root, {
        // The CLI has no profile registry. A capsule's own pinned profile is accepted
        // under the same minimum publish() validated it with (0), so a stored
        // capsule never fails the rebuild that follows the registry write.
        validationPolicyFor: ({ profileId, profileVersion }) => ({
          profileId,
          profileVersion,
          minimumVerifiedEvidencePerMaterialItem: 0,
        }),
      });
      return { entries: result.entries };
    } finally {
      storage.close();
    }
  }

  /** Number of rows in the index, or undefined when it is missing or unreadable. */
  async indexEntries(): Promise<number | undefined> {
    if (!(await exists(this.layout.databasePath))) return undefined;
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(this.layout.databasePath, { readonly: true });
      try {
        return (db.query("SELECT count(*) AS n FROM catalog_entries").get() as { n: number }).n;
      } finally {
        db.close();
      }
    } catch {
      return undefined;
    }
  }

  /** Rebuild when the index is missing, unreadable or its row count differs from the files. */
  async ensureIndex(): Promise<{ state: "ok" | "rebuilt"; entries: number }> {
    const files = (await this.allVersions()).length;
    const rows = await this.indexEntries();
    if (rows === files) return { state: "ok", entries: rows };
    const { entries } = await this.withWriteLease(() => this.rebuildIndex());
    return { state: "rebuilt", entries };
  }

  /** report_usage: one plain JSON file per record under usage/. */
  async recordUsage(input: { capsule: string; digest?: string; note?: string }): Promise<string> {
    await this.assertExists();
    const record = {
      reportedAt: new Date().toISOString(),
      capsule: input.capsule,
      ...(input.digest === undefined ? {} : { digest: input.digest }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    const dir = join(this.layout.root, "usage");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${record.reportedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.json`);
    must(await writeFileCreateOnlyAtomic(path, `${JSON.stringify(record, null, 2)}\n`));
    return path;
  }
}

/** Read every file of a folder (symlinks refused) as a capsule package; undeclared files are kept so validation flags them. */
export async function readFolder(dir: string): Promise<CapsulePackage> {
  const entries: { path: string; bytes: Uint8Array }[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new KcError("policy_denied", `capsules cannot contain links: ${full}`);
      if (info.isDirectory()) await visit(full);
      else if (info.isFile()) {
        entries.push({ path: relative(dir, full).split(sep).join("/"), bytes: new Uint8Array(await readFile(full)) });
      }
    }
  }
  if (!(await exists(dir))) throw new KcError("not_found", `${dir} does not exist`);
  await visit(dir);
  return createCapsulePackage(entries);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
