import { KcError } from "@kc/contracts";
import {
  compareSemver,
  parseCapsuleId,
  parseDigest,
  parseSemver,
  parseTimestamp,
  type CapsuleId,
  type Digest,
  type Semver,
  type Timestamp,
} from "@kc/domain";

export const PUBLISHED_LIFECYCLE_STATUSES = [
  "published",
  "superseded",
  "archived",
] as const;

export type PublishedLifecycleStatus =
  (typeof PUBLISHED_LIFECYCLE_STATUSES)[number];

export interface CapsuleRegistryVersion {
  readonly version: Semver;
  readonly digest: Digest;
  readonly status: PublishedLifecycleStatus;
  readonly publishedAt: Timestamp;
}

export interface CapsuleRegistry {
  readonly schemaVersion: "0.1";
  readonly capsuleId: CapsuleId;
  readonly revision: number;
  readonly versions: readonly CapsuleRegistryVersion[];
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new KcError("validation_failed", `${at} must be an object`, {
      details: [{ at, message: "expected an object" }],
    });
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length === 0) return;
  throw new KcError("validation_failed", `${at} has unsupported fields`, {
    details: unexpected.map((key) => ({
      at: `${at}/${key}`,
      message: "field is not part of capsule registry schema 0.1",
    })),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseStatus(value: unknown, at: string): PublishedLifecycleStatus {
  if (
    typeof value !== "string" ||
    !PUBLISHED_LIFECYCLE_STATUSES.includes(value as PublishedLifecycleStatus)
  ) {
    throw new KcError("validation_failed", `${at} is not a published lifecycle status`, {
      details: [{ at, message: "expected published, superseded, or archived" }],
    });
  }
  return value as PublishedLifecycleStatus;
}

function parseVersion(value: unknown, index: number): CapsuleRegistryVersion {
  const at = `/versions/${String(index)}`;
  const candidate = record(value, at);
  exactKeys(candidate, ["version", "digest", "status", "publishedAt"], at);
  const version = parseSemver(candidate["version"], `${at}/version`);
  if (!version.ok) throw version.error;
  const digest = parseDigest(candidate["digest"], `${at}/digest`);
  if (!digest.ok) throw digest.error;
  const publishedAt = parseTimestamp(candidate["publishedAt"], `${at}/publishedAt`);
  if (!publishedAt.ok) throw publishedAt.error;
  return {
    version: version.value,
    digest: digest.value,
    status: parseStatus(candidate["status"], `${at}/status`),
    publishedAt: publishedAt.value,
  };
}

export function parseCapsuleRegistry(input: unknown): CapsuleRegistry {
  const value = record(input, "/");
  exactKeys(value, ["schemaVersion", "capsuleId", "revision", "versions"], "");
  if (value["schemaVersion"] !== "0.1") {
    throw new KcError("unsupported_schema_version", "unsupported capsule registry schema", {
      details: [{ at: "/schemaVersion", message: "expected schema version 0.1" }],
    });
  }
  const capsuleId = parseCapsuleId(value["capsuleId"], "/capsuleId");
  if (!capsuleId.ok) throw capsuleId.error;
  if (!Number.isSafeInteger(value["revision"]) || (value["revision"] as number) < 0) {
    throw new KcError("validation_failed", "/revision must be a non-negative integer", {
      details: [{ at: "/revision", message: "expected a non-negative safe integer" }],
    });
  }
  if (!Array.isArray(value["versions"])) {
    throw new KcError("validation_failed", "/versions must be an array", {
      details: [{ at: "/versions", message: "expected an array" }],
    });
  }
  const versions = value["versions"].map(parseVersion);
  const seen = new Set<string>();
  for (const [index, version] of versions.entries()) {
    if (seen.has(version.version)) {
      throw new KcError("conflict", `registry repeats version ${version.version}`, {
        details: [
          {
            at: `/versions/${String(index)}/version`,
            message: "one semantic version may have only one registry entry",
          },
        ],
      });
    }
    seen.add(version.version);
  }
  versions.sort((left, right) => compareBytes(left.version, right.version));
  return deepFreeze({
    schemaVersion: "0.1",
    capsuleId: capsuleId.value,
    revision: value["revision"] as number,
    versions,
  });
}

export function registerPublishedVersion(
  registry: CapsuleRegistry,
  candidateInput: unknown,
  supersedesInput?: unknown,
): CapsuleRegistry {
  const candidate = parseVersion(candidateInput, registry.versions.length);
  if (candidate.status !== "published") {
    throw new KcError("validation_failed", "a new registry version must be published", {
      details: [{ at: "/status", message: "new versions enter the registry as published" }],
    });
  }
  const existing = registry.versions.find(
    (entry) => entry.version === candidate.version,
  );
  if (existing !== undefined) {
    if (existing.digest !== candidate.digest) {
      const sentence = `${registry.capsuleId}@${candidate.version} is already in the vault with different content; raise "version" in capsule.json and publish again`;
      throw new KcError(
        "immutable_version",
        sentence,
        {
          details: [
            {
              at: "/digest",
              message: sentence,
              existingDigest: existing.digest,
              candidateDigest: candidate.digest,
            },
          ],
        },
      );
    }
    return registry;
  }

  let supersedes: Semver | undefined;
  if (supersedesInput !== undefined) {
    const parsed = parseSemver(supersedesInput, "/supersedes");
    if (!parsed.ok) throw parsed.error;
    supersedes = parsed.value;
  }

  if (supersedes !== undefined) {
    const predecessor = registry.versions.find((entry) => entry.version === supersedes);
    if (predecessor === undefined) {
      throw new KcError("not_found", `superseded version ${supersedes} is not registered`, {
        details: [{ at: "/supersedes", message: "version does not exist" }],
      });
    }
    if (compareSemver(candidate.version, predecessor.version) <= 0) {
      throw new KcError(
        "conflict",
        `version ${candidate.version} does not supersede ${predecessor.version}`,
        {
          details: [
            {
              at: "/version",
              message: "a successor must have strictly higher semantic version precedence",
              candidateVersion: candidate.version,
              supersededVersion: predecessor.version,
            },
          ],
        },
      );
    }
  }

  const versions = registry.versions.map((entry): CapsuleRegistryVersion => {
    if (entry.version !== supersedes) return entry;
    if (entry.status !== "published") {
      throw new KcError("conflict", `version ${entry.version} is not currently published`, {
        details: [{ at: "/supersedes", message: `current status is ${entry.status}` }],
      });
    }
    return { ...entry, status: "superseded" };
  });
  versions.push(candidate);
  versions.sort((left, right) => compareBytes(left.version, right.version));
  return deepFreeze({
    ...registry,
    revision: registry.revision + 1,
    versions,
  });
}
