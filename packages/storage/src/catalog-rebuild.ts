import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  assertCapsulePackage,
  createCapsulePackage,
  MANIFEST_PATH,
  parseJsonBytes,
  parseJsonl,
  parseManifest,
  type CapsuleManifest,
  type CapsulePackage,
} from "@kc/capsule-format";
import {
  parseCapsuleRegistry,
  type CapsuleRegistry,
  type CapsuleRegistryVersion,
} from "./capsule-registry.ts";
import { KcError } from "@kc/contracts";
import {
  assertCapsuleId,
  assertDigest,
  assertLocalId,
  assertSemver,
  isPublishedStatus,
} from "@kc/domain";

import {
  catalogSummary,
  catalogTitle,
  catalogUpdatedAt,
  CATALOG_TRUST_LEVELS,
  type CatalogEntryProjection,
  type CatalogItemProjection,
  type CatalogScopeProjection,
  type CatalogTrust,
  type SqliteStorage,
} from "./sqlite.ts";

/** Title through provenance exist on research capsules; a guidelines capsule indexes what it has. */
interface ManifestProjection extends CapsuleManifest {
  readonly title?: string;
  readonly summary?: string;
  readonly classification?: NonNullable<CatalogEntryProjection["classification"]>;
  readonly freshness?: { readonly assessedAt: string };
  readonly publishedAt?: string;
  readonly provenance?: { readonly createdAt: string };
}

interface ItemProjection {
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly statement: string;
  readonly body?: string;
  readonly bodyPath?: string;
  readonly freshness: { readonly state: string };
  readonly tags: readonly string[];
  readonly retrievalHints?: { readonly taskTypes?: readonly string[]; readonly priority?: number };
}

export interface CatalogRebuildOptions {
  readonly validationPolicyFor: (input: {
    readonly profileId: string;
    readonly profileVersion: string;
  }) =>
    | {
        readonly profileId: string;
        readonly profileVersion: string;
        readonly minimumVerifiedEvidencePerMaterialItem: number;
      }
    | undefined;
  readonly trustFor?: (input: {
    readonly sourcePath: string;
    readonly manifest: CapsuleManifest;
  }) => CatalogTrust;
}

export interface CatalogRebuildResult {
  readonly entries: number;
  readonly items: number;
  readonly recordIds: readonly string[];
  readonly orphanedVersionPaths: readonly string[];
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function findCapsuleDirectories(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareBytes(left.name, right.name));
    if (entries.some((entry) => entry.isFile() && entry.name === "capsule.json")) {
      found.push(directory);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new KcError("policy_denied", "canonical capsule scan rejects symbolic links", {
          details: [{ at: join(directory, entry.name), message: "symbolic link is not allowed" }],
        });
      }
      if (entry.isDirectory()) await visit(join(directory, entry.name));
    }
  }
  await visit(root);
  return found.sort(compareBytes);
}

interface CanonicalLocation {
  readonly capsuleId: string;
  readonly kind: "draft" | "version";
  readonly version?: string;
  readonly digest?: string;
}

interface RegistryLocation {
  readonly capsuleId: string;
  readonly sourcePath: string;
}

function invalidCanonicalLocation(sourcePath: string, message: string): never {
  throw new KcError("validation_failed", `invalid canonical capsule location: ${message}`, {
    details: [{ at: sourcePath, message }],
  });
}

function canonicalLocation(sourcePath: string): CanonicalLocation {
  const segments = sourcePath.split("/");
  const [capsules, namespace, slug, collection, identity, digestHex] = segments;
  if (
    capsules !== "capsules" ||
    namespace === undefined ||
    slug === undefined ||
    collection === undefined ||
    identity === undefined
  ) {
    return invalidCanonicalLocation(sourcePath, "expected capsules/<namespace>/<slug>/...");
  }
  const capsuleId = `${namespace}/${slug}`;
  assertCapsuleId(capsuleId, sourcePath);
  if (collection === "drafts" && segments.length === 5) {
    assertLocalId(identity, sourcePath);
    return { capsuleId, kind: "draft" };
  }
  if (collection === "versions" && segments.length === 6 && digestHex !== undefined) {
    assertSemver(identity, sourcePath);
    assertDigest(`sha256:${digestHex}`, sourcePath);
    return {
      capsuleId,
      kind: "version",
      version: identity,
      digest: `sha256:${digestHex}`,
    };
  }
  return invalidCanonicalLocation(
    sourcePath,
    "expected drafts/<draft-id> or versions/<semver>/<digest>",
  );
}

function assertManifestLocation(
  manifest: CapsuleManifest,
  sourcePath: string,
  location: CanonicalLocation,
): void {
  if (manifest.id !== location.capsuleId) {
    invalidCanonicalLocation(sourcePath, "directory capsule ID does not match capsule.json");
  }
  if (location.kind === "draft") {
    if (isPublishedStatus(manifest.status as never)) {
      invalidCanonicalLocation(sourcePath, "published-side status cannot be stored under drafts");
    }
    return;
  }
  if (manifest.status !== "published") {
    invalidCanonicalLocation(sourcePath, "immutable version manifests must remain published");
  }
  if (manifest.version !== location.version || manifest.digest !== location.digest) {
    invalidCanonicalLocation(
      sourcePath,
      "version or digest directory does not match capsule.json",
    );
  }
}

function assertRegisteredVersionManifest(
  registryVersion: CapsuleRegistryVersion,
  manifest: CapsuleManifest,
  sourcePath: string,
): void {
  // Published package status is intentionally immutable. The registry status
  // is the post-publication lifecycle overlay, while the version, digest, and
  // publication timestamp are bound to the immutable package bytes.
  if (
    registryVersion.version !== manifest.version ||
    registryVersion.digest !== manifest.digest ||
    registryVersion.publishedAt !== manifest.publishedAt
  ) {
    throw new KcError("conflict", "registry version does not match immutable package metadata", {
      details: [
        {
          at: sourcePath,
          message: "registry version, digest, and publishedAt must match capsule.json",
        },
      ],
    });
  }
}

function registryLocation(sourcePath: string): RegistryLocation {
  const segments = sourcePath.split("/");
  const [capsules, namespace, slug, name] = segments;
  if (
    capsules !== "capsules" ||
    namespace === undefined ||
    slug === undefined ||
    name !== "registry.json" ||
    segments.length !== 4
  ) {
    throw new KcError("validation_failed", "invalid canonical capsule registry location", {
      details: [{ at: sourcePath, message: "expected capsules/<namespace>/<slug>/registry.json" }],
    });
  }
  const capsuleId = `${namespace}/${slug}`;
  assertCapsuleId(capsuleId, sourcePath);
  return { capsuleId, sourcePath };
}

async function findRegistryPaths(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const namespaces = await readdir(root, { withFileTypes: true });
  namespaces.sort((left, right) => compareBytes(left.name, right.name));
  for (const namespace of namespaces) {
    const namespacePath = join(root, namespace.name);
    if (namespace.isSymbolicLink()) {
      throw new KcError("policy_denied", "canonical capsule scan rejects symbolic links", {
        details: [{ at: namespacePath, message: "symbolic link is not allowed" }],
      });
    }
    if (!namespace.isDirectory()) continue;
    const capsules = await readdir(namespacePath, { withFileTypes: true });
    capsules.sort((left, right) => compareBytes(left.name, right.name));
    for (const capsule of capsules) {
      const capsulePath = join(namespacePath, capsule.name);
      if (capsule.isSymbolicLink()) {
        throw new KcError("policy_denied", "canonical capsule scan rejects symbolic links", {
          details: [{ at: capsulePath, message: "symbolic link is not allowed" }],
        });
      }
      if (!capsule.isDirectory()) continue;
      const entries = await readdir(capsulePath, { withFileTypes: true });
      if (entries.some((entry) => entry.name === "registry.json")) {
        found.push(join(capsulePath, "registry.json"));
      }
    }
  }
  return found.sort(compareBytes);
}

async function readRegistry(path: string, location: RegistryLocation): Promise<CapsuleRegistry> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new KcError("policy_denied", "canonical capsule registry must be a regular file", {
      details: [{ at: path, message: "symbolic links and non-files are not allowed" }],
    });
  }
  const registry = parseCapsuleRegistry(parseJsonBytes(await readFile(path), path));
  if (registry.capsuleId !== location.capsuleId) {
    throw new KcError("validation_failed", "registry capsule identity does not match its path", {
      details: [{ at: path, message: "registry capsuleId must match its canonical path" }],
    });
  }
  return registry;
}

async function assertCanonicalRoot(vaultRoot: string, capsulesRoot: string): Promise<void> {
  for (const path of [vaultRoot, capsulesRoot]) {
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new KcError("vault_not_found", `canonical vault path is missing: ${path}`, {
          details: [{ at: path, message: "required canonical directory does not exist" }],
          cause: error,
        });
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new KcError("policy_denied", `canonical vault path is not a regular directory: ${path}`, {
        details: [{ at: path, message: "symbolic links and non-directories are not allowed" }],
      });
    }
  }
}

async function readCapsuleDirectory(directory: string): Promise<CapsulePackage> {
  const entries: { readonly path: string; readonly bytes: Uint8Array }[] = [];
  async function visit(current: string): Promise<void> {
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => compareBytes(left.name, right.name));
    for (const child of children) {
      const path = join(current, child.name);
      if (child.isSymbolicLink()) {
        throw new KcError("policy_denied", "canonical capsule scan rejects symbolic links", {
          details: [{ at: path, message: "symbolic link is not allowed" }],
        });
      }
      if (child.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!child.isFile()) {
        throw new KcError("policy_denied", "canonical capsule scan found a non-file entry", {
          details: [{ at: path, message: "only regular files are allowed" }],
        });
      }
      entries.push({
        path: relative(directory, path).split(sep).join("/"),
        bytes: await readFile(path),
      });
    }
  }
  await visit(directory);
  return createCapsulePackage(entries);
}

function decodeText(bytes: Uint8Array, at: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new KcError("validation_failed", `${at} is not valid UTF-8`, {
      details: [{ at, message: "expected valid UTF-8 text" }],
      cause: error,
    });
  }
}

function recordId(manifest: CapsuleManifest, sourcePath: string): string {
  if (manifest.digest !== undefined) return `cap:${manifest.digest.slice("sha256:".length)}`;
  return `draft:${createHash("sha256").update(sourcePath).digest("hex")}`;
}

function itemProjection(item: ItemProjection, pkg: CapsulePackage): CatalogItemProjection {
  let body = item.body ?? "";
  if (item.bodyPath !== undefined) {
    const bytes = pkg.entries.get(item.bodyPath);
    if (bytes === undefined) {
      throw new KcError("validation_failed", `knowledge item body is missing: ${item.bodyPath}`);
    }
    body = decodeText(bytes, item.bodyPath);
  }
  const { bodyPath: _bodyPath, ...withoutBodyPath } = item;
  const normalizedItem = { ...withoutBodyPath, body };
  return {
    id: item.id,
    status: item.status,
    freshness: item.freshness.state,
    priority: item.retrievalHints?.priority ?? null,
    title: item.title,
    statement: item.statement,
    body,
    tags: item.tags,
    item: normalizedItem,
  };
}

function projectionFromPackage(
  pkg: CapsulePackage,
  sourcePath: string,
  options: CatalogRebuildOptions,
  effectiveStatus?: CatalogEntryProjection["status"],
): CatalogEntryProjection {
  const manifestBytes = pkg.entries.get(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    throw new KcError("validation_failed", "capsule.json is missing from the capsule package");
  }
  const rawManifest = parseManifest(manifestBytes) as ManifestProjection;
  // A capsule that pins a profile is checked under that profile's policy. One
  // without a profile (kind guidelines) has no evidence minimum to apply.
  let minimumVerifiedEvidencePerMaterialItem = 0;
  if (rawManifest.profile !== undefined) {
    const pinned = rawManifest.profile;
    const profile = options.validationPolicyFor({
      profileId: pinned.id,
      profileVersion: pinned.version,
    });
    if (profile === undefined) {
      throw new KcError(
        "policy_denied",
        `pinned profile policy is unavailable: ${pinned.id}@${pinned.version}`,
      );
    }
    if (
      profile.profileId !== pinned.id ||
      profile.profileVersion !== pinned.version ||
      !Number.isSafeInteger(profile.minimumVerifiedEvidencePerMaterialItem) ||
      profile.minimumVerifiedEvidencePerMaterialItem < 0
    ) {
      throw new KcError("validation_failed", "profile validation policy does not match its pin");
    }
    minimumVerifiedEvidencePerMaterialItem = profile.minimumVerifiedEvidencePerMaterialItem;
  }
  const validation = assertCapsulePackage(pkg, {
    minimumVerifiedEvidencePerMaterialItem,
    mode: "import",
  });
  const manifest = validation.manifest as ManifestProjection;
  const itemsPath = manifest.contents.knowledgeItems;
  let items: CatalogItemProjection[] = [];
  if (itemsPath !== undefined) {
    const itemBytes = pkg.entries.get(itemsPath);
    if (itemBytes === undefined) {
      throw new KcError("validation_failed", "capsule knowledge-item index is missing");
    }
    items = parseJsonl(itemBytes, itemsPath).map((record) =>
      itemProjection(record.value as ItemProjection, pkg)
    );
  }
  const accepted = items.filter((item) => item.status === "accepted");
  const scope = manifest.scope as CatalogScopeProjection;
  const trust = options.trustFor?.({ sourcePath, manifest }) ?? "unverified";
  if (!CATALOG_TRUST_LEVELS.includes(trust)) {
    throw new KcError("validation_failed", `trust resolver returned unsupported value ${trust}`);
  }

  return {
    recordId: recordId(manifest, sourcePath),
    capsuleId: manifest.id,
    version: manifest.version,
    digest: manifest.digest ?? null,
    status: effectiveStatus ?? (manifest.status as CatalogEntryProjection["status"]),
    title: catalogTitle(manifest),
    summary: catalogSummary(manifest),
    profileId: manifest.profile?.id ?? null,
    profileVersion: manifest.profile?.version ?? null,
    classification: manifest.classification ?? null,
    trust,
    assessedAt: manifest.freshness?.assessedAt ?? null,
    updatedAt: catalogUpdatedAt(manifest),
    sourcePath,
    scope,
    facets: {
      tags: accepted.flatMap((item) => item.tags),
      taskTypes: accepted.flatMap((item) => {
        const raw = item.item as ItemProjection;
        return raw.retrievalHints?.taskTypes ?? [];
      }),
      audiences: Array.isArray(scope.audiences)
        ? scope.audiences.filter((value): value is string => typeof value === "string")
        : [],
    },
    manifest,
    items,
  };
}

export async function rebuildCatalogFromCanonicalVault(
  storage: SqliteStorage,
  vaultRoot: string,
  options: CatalogRebuildOptions,
): Promise<CatalogRebuildResult> {
  const capsulesRoot = join(vaultRoot, "capsules");
  await assertCanonicalRoot(vaultRoot, capsulesRoot);
  const directories = await findCapsuleDirectories(capsulesRoot);
  const registryPaths = await findRegistryPaths(capsulesRoot);
  const registries = new Map<string, CapsuleRegistry>();
  for (const path of registryPaths) {
    const sourcePath = relative(vaultRoot, path).split(sep).join("/");
    const location = registryLocation(sourcePath);
    registries.set(location.capsuleId, await readRegistry(path, location));
  }

  const locations = directories.map((directory) => {
    const sourcePath = relative(vaultRoot, directory).split(sep).join("/");
    return { directory, sourcePath, location: canonicalLocation(sourcePath) };
  });
  const versionDirectories = new Map<string, (typeof locations)[number]>();
  for (const candidate of locations) {
    if (candidate.location.kind !== "version") continue;
    versionDirectories.set(candidate.sourcePath, candidate);
  }
  const registeredVersionPaths = new Map<string, CapsuleRegistryVersion>();
  for (const [capsuleId, registry] of registries) {
    for (const version of registry.versions) {
      const path = `capsules/${capsuleId}/versions/${version.version}/${version.digest.slice("sha256:".length)}`;
      if (!versionDirectories.has(path)) {
        throw new KcError("conflict", "registry version is missing immutable package bytes", {
          details: [{ at: path, message: "registry entry has no matching canonical version directory" }],
        });
      }
      registeredVersionPaths.set(path, version);
    }
  }

  const projections: CatalogEntryProjection[] = [];
  const orphanedVersionPaths: string[] = [];
  for (const { directory, sourcePath, location } of locations) {
    const registeredVersion = registeredVersionPaths.get(sourcePath);
    if (location.kind === "version" && registeredVersion === undefined) {
      orphanedVersionPaths.push(sourcePath);
      continue;
    }
    const pkg = await readCapsuleDirectory(directory);
    const manifestBytes = pkg.entries.get(MANIFEST_PATH);
    if (manifestBytes === undefined) {
      throw new KcError("validation_failed", "capsule.json is missing from the capsule package");
    }
    const manifest = parseManifest(manifestBytes);
    assertManifestLocation(manifest, sourcePath, location);
    if (location.kind === "version") {
      // The undefined case was handled above; retaining this guard keeps the
      // registry overlay non-optional at the authority boundary.
      if (registeredVersion === undefined) {
        throw new KcError("conflict", "version package is not registered");
      }
      assertRegisteredVersionManifest(registeredVersion, manifest, sourcePath);
    }
    projections.push(
      projectionFromPackage(pkg, sourcePath, options, registeredVersion?.status),
    );
  }
  storage.replaceCatalog(projections);
  return {
    entries: projections.length,
    items: projections.reduce((total, projection) => total + projection.items.length, 0),
    recordIds: projections.map((projection) => projection.recordId),
    orphanedVersionPaths,
  };
}
