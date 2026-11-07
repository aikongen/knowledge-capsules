import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonicalizeJson } from "@kc/capsule-format";
import { KcError, sharedValidator } from "@kc/contracts";
import {
  RESOLVER_TRUST_LEVELS,
  type ResolverCapsuleLexicalMatch,
  type ResolverCapsuleRef,
  type ResolverCorpusCapsule,
  type ResolverCorpusItem,
  type ResolverCorpusPort,
  type ResolverCorpusRequest,
  type ResolverCorpusSnapshot,
  type ResolverItemLexicalMatch,
  type ResolverTrust,
} from "./resolver-corpus.ts";
import {
  CLASSIFICATIONS,
  CAPSULE_STATUSES,
  KNOWLEDGE_ITEM_STATUSES,
  assertCapsuleId,
  assertDigest,
  assertLocalId,
  assertPackagePath,
  assertProfileId,
  assertSemver,
  assertTimestamp,
  compareSemver,
  isPublishedStatus,
  type CapsuleStatus,
  type Classification,
} from "@kc/domain";
import type {
  AppendTraceEventResult,
  ItemUsageCounts,
  TraceCounts,
  TraceEvent,
  TraceRepository,
} from "./trace-types.ts";
import { Database } from "./sqlite-driver.ts";

export const CATALOG_TRUST_LEVELS = RESOLVER_TRUST_LEVELS;

export type CatalogTrust = ResolverTrust;

export interface CatalogScopeProjection {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly assumptions: readonly string[];
  readonly platforms?: readonly string[];
  readonly technologies?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface CatalogFacetProjection {
  readonly tags: readonly string[];
  readonly taskTypes: readonly string[];
  readonly audiences: readonly string[];
}

export interface CatalogItemProjection {
  readonly id: string;
  readonly status: string;
  readonly freshness: string;
  readonly priority: number | null;
  readonly title: string;
  readonly statement: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly item: unknown;
}

export interface CatalogEntryProjection {
  readonly recordId: string;
  readonly capsuleId: string;
  readonly version: string;
  readonly digest: string | null;
  readonly status: CapsuleStatus;
  /** Manifest title; a capsule without one is indexed under its id. */
  readonly title: string;
  /** Manifest summary; a capsule without one is indexed under its trigger. */
  readonly summary: string;
  /** Profile, classification and freshness exist only on research capsules. */
  readonly profileId: string | null;
  readonly profileVersion: string | null;
  readonly classification: Classification | null;
  readonly trust: CatalogTrust;
  readonly assessedAt: string | null;
  readonly updatedAt: string | null;
  readonly sourcePath: string;
  readonly scope: CatalogScopeProjection;
  readonly facets: CatalogFacetProjection;
  readonly manifest: unknown;
  readonly items: readonly CatalogItemProjection[];
}

export interface CatalogFtsMatch {
  readonly recordId: string;
  readonly capsuleId: string;
  readonly version: string;
  readonly digest: string | null;
  readonly bm25: number;
}

export interface CatalogItemFtsMatch {
  readonly recordId: string;
  readonly itemId: string;
  readonly bm25: number;
}

export interface SqliteRuntimeInfo {
  readonly sqliteVersion: string;
  readonly journalMode: string;
  readonly foreignKeys: boolean;
  readonly synchronous: number;
  readonly fts5: boolean;
}

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial-catalog-and-events",
    up: `
      CREATE TABLE catalog_entries (
        record_id TEXT PRIMARY KEY,
        capsule_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        profile_id TEXT,
        profile_version TEXT,
        classification TEXT,
        trust TEXT NOT NULL,
        resolver_visible INTEGER NOT NULL CHECK (resolver_visible IN (0, 1)),
        freshness_json TEXT NOT NULL,
        assessed_at TEXT,
        updated_at TEXT,
        source_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        scope_json TEXT NOT NULL,
        facets_json TEXT NOT NULL,
        UNIQUE (capsule_id, version, record_id)
      ) STRICT;

      CREATE UNIQUE INDEX catalog_one_materialized_version
        ON catalog_entries (capsule_id, version)
        WHERE digest IS NOT NULL;

      CREATE INDEX catalog_entries_capsule
        ON catalog_entries (capsule_id, version, status);

      CREATE INDEX catalog_resolver_visible
        ON catalog_entries (resolver_visible, capsule_id, version);

      CREATE VIRTUAL TABLE catalog_fts USING fts5(
        record_id UNINDEXED,
        title,
        summary,
        scope_text,
        facet_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE catalog_items (
        record_id TEXT NOT NULL REFERENCES catalog_entries(record_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL,
        freshness TEXT NOT NULL,
        priority INTEGER,
        item_json TEXT NOT NULL,
        PRIMARY KEY (record_id, item_id)
      ) STRICT;

      CREATE VIRTUAL TABLE item_fts USING fts5(
        record_id UNINDEXED,
        item_id UNINDEXED,
        title,
        statement,
        body,
        tags,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE trace_events (
        event_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        span_id TEXT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        capsule_id TEXT,
        capsule_version TEXT,
        knowledge_item_id TEXT,
        raw_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX trace_events_trace_order
        ON trace_events (trace_id, timestamp, event_id);

      CREATE INDEX trace_events_capsule
        ON trace_events (capsule_id, capsule_version, timestamp, event_id);

      CREATE INDEX trace_events_item
        ON trace_events (capsule_id, capsule_version, knowledge_item_id, timestamp, event_id);
    `,
    down: `
      DROP INDEX IF EXISTS trace_events_item;
      DROP INDEX IF EXISTS trace_events_capsule;
      DROP INDEX IF EXISTS trace_events_trace_order;
      DROP TABLE IF EXISTS trace_events;
      DROP TABLE IF EXISTS item_fts;
      DROP TABLE IF EXISTS catalog_items;
      DROP TABLE IF EXISTS catalog_fts;
      DROP INDEX IF EXISTS catalog_resolver_visible;
      DROP INDEX IF EXISTS catalog_entries_capsule;
      DROP INDEX IF EXISTS catalog_one_materialized_version;
      DROP TABLE IF EXISTS catalog_entries;
    `,
  },
];

export const CURRENT_STORAGE_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
}

interface PreparedCatalogEntry {
  readonly projection: CatalogEntryProjection;
  readonly manifestJson: string;
  readonly scopeJson: string;
  readonly facetsJson: string;
  readonly scopeText: string;
  readonly facetText: string;
  readonly items: readonly PreparedCatalogItem[];
}

interface PreparedCatalogItem {
  readonly projection: CatalogItemProjection;
  readonly raw: StoredItem;
  readonly itemJson: string;
  readonly tagsText: string;
}

function assertNonEmptyString(value: unknown, at: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new KcError("validation_failed", `${at} must be a non-empty string`, {
      details: [{ at, message: "expected a non-empty string" }],
    });
  }
}

function assertStringArray(value: unknown, at: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new KcError("validation_failed", `${at} must be an array of strings`, {
      details: [{ at, message: "expected an array containing only strings" }],
    });
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function json(value: unknown, at: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("value is not JSON-serializable");
    return serialized;
  } catch (error) {
    throw new KcError("validation_failed", `${at} must be JSON-serializable`, {
      details: [{ at, message: "value cannot be represented as JSON" }],
      cause: error,
    });
  }
}

function uniqueByteSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right))
  );
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function projectionMismatch(at: string, message: string): never {
  throw new KcError("validation_failed", `catalog projection mismatch at ${at}`, {
    details: [{ at, message }],
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function prepareCatalogEntry(entry: CatalogEntryProjection): PreparedCatalogEntry {
  assertLocalId(entry.recordId, "/recordId");
  if (!CATALOG_TRUST_LEVELS.includes(entry.trust)) {
    throw new KcError("validation_failed", "catalog trust level is not supported");
  }
  assertPackagePath(entry.sourcePath, "/sourcePath");
  const manifest = sharedValidator().assert<StoredManifest>(
    "capsuleManifest",
    entry.manifest,
    `catalog manifest ${entry.recordId}`,
  );
  const manifestStatus = manifest.status as CapsuleStatus;
  if (!CAPSULE_STATUSES.includes(manifestStatus)) {
    throw new KcError("validation_failed", "catalog manifest status is not supported");
  }
  const digest = manifest.digest ?? null;
  if (isPublishedStatus(manifestStatus) && digest === null) {
    throw new KcError("validation_failed", "published-side catalog records require a digest");
  }
  const effectiveStatus = entry.status;
  if (isPublishedStatus(manifestStatus)) {
    if (manifestStatus !== "published") {
      projectionMismatch("/manifest/status", "immutable version manifests must remain published");
    }
    if (!isPublishedStatus(effectiveStatus)) {
      projectionMismatch("/status", "immutable versions require a published lifecycle status");
    }
  } else if (effectiveStatus !== manifestStatus) {
    projectionMismatch("/status", "draft-side status must equal capsule.json status");
  }
  assertCapsuleId(manifest.id, "/manifest/id");
  assertSemver(manifest.version, "/manifest/version");
  if (digest !== null) assertDigest(digest, "/manifest/digest");
  const title = catalogTitle(manifest);
  assertNonEmptyString(title, "/manifest/title");
  const profile = manifest.profile ?? null;
  if (profile !== null) {
    assertProfileId(profile.id, "/manifest/profile/id");
    assertSemver(profile.version, "/manifest/profile/version");
  }
  const classification = manifest.classification ?? null;
  if (classification !== null && !CLASSIFICATIONS.includes(classification)) {
    throw new KcError("validation_failed", "catalog classification is not supported");
  }
  const assessedAt = manifest.freshness?.assessedAt ?? null;
  if (assessedAt !== null) assertTimestamp(assessedAt, "/manifest/freshness/assessedAt");
  const updatedAt = catalogUpdatedAt(manifest);
  if (updatedAt !== null) assertTimestamp(updatedAt, "/manifest/updatedAt");

  const scalarChecks: readonly [boolean, string, string][] = [
    [entry.capsuleId === manifest.id, "/capsuleId", "must equal capsule.json id"],
    [entry.version === manifest.version, "/version", "must equal capsule.json version"],
    [entry.digest === digest, "/digest", "must equal capsule.json digest"],
    [entry.title === title, "/title", "must equal capsule.json title"],
    [entry.summary === catalogSummary(manifest), "/summary", "must equal capsule.json summary"],
    [entry.profileId === (profile?.id ?? null), "/profileId", "must equal capsule.json profile id"],
    [
      entry.profileVersion === (profile?.version ?? null),
      "/profileVersion",
      "must equal capsule.json profile version",
    ],
    [
      entry.classification === classification,
      "/classification",
      "must equal capsule.json classification",
    ],
    [
      entry.assessedAt === assessedAt,
      "/assessedAt",
      "must equal capsule.json freshness assessment",
    ],
    [entry.updatedAt === updatedAt, "/updatedAt", "must equal canonical manifest timestamp"],
  ];
  for (const [matches, at, message] of scalarChecks) {
    if (!matches) projectionMismatch(at, message);
  }

  const scope = manifest.scope as CatalogScopeProjection;
  if (!sameJson(entry.scope, scope)) {
    projectionMismatch("/scope", "must equal capsule.json scope");
  }
  assertStringArray(scope.includes, "/scope/includes");
  assertStringArray(scope.excludes, "/scope/excludes");
  if (scope.assumptions !== undefined) assertStringArray(scope.assumptions, "/scope/assumptions");
  const platforms = scope.platforms ?? [];
  assertStringArray(platforms, "/scope/platforms");
  assertStringArray(entry.facets.tags, "/facets/tags");
  assertStringArray(entry.facets.taskTypes, "/facets/taskTypes");
  assertStringArray(entry.facets.audiences, "/facets/audiences");
  const technologyKeys = Object.keys(scope.technologies ?? {});
  const items = entry.items.map((item, index) => {
    const prefix = `/items/${index}`;
    const raw = sharedValidator().assert<StoredItem>(
      "knowledgeItem",
      item.item,
      `catalog item ${entry.recordId}/${String(index)}`,
    );
    assertLocalId(raw.id, `${prefix}/item/id`);
    if (!KNOWLEDGE_ITEM_STATUSES.includes(raw.status as (typeof KNOWLEDGE_ITEM_STATUSES)[number])) {
      throw new KcError("validation_failed", `${prefix}/status is not supported`);
    }
    if (!["current", "aging", "stale", "unknown"].includes(raw.freshness.state)) {
      throw new KcError("validation_failed", `${prefix}/freshness is not supported`);
    }
    if (typeof item.body !== "string") {
      throw new KcError("validation_failed", `${prefix}/body must be a string`);
    }
    assertStringArray(item.tags, `${prefix}/tags`);
    const priority = raw.retrievalHints?.priority ?? null;
    const itemChecks: readonly [boolean, string, string][] = [
      [item.id === raw.id, `${prefix}/id`, "must equal canonical item id"],
      [item.status === raw.status, `${prefix}/status`, "must equal canonical item status"],
      [
        item.freshness === raw.freshness.state,
        `${prefix}/freshness`,
        "must equal canonical item freshness",
      ],
      [item.priority === priority, `${prefix}/priority`, "must equal canonical item priority"],
      [item.title === raw.title, `${prefix}/title`, "must equal canonical item title"],
      [
        item.statement === raw.statement,
        `${prefix}/statement`,
        "must equal canonical item statement",
      ],
      [
        sameJson(uniqueByteSorted(item.tags), uniqueByteSorted(raw.tags)),
        `${prefix}/tags`,
        "must equal canonical item tags",
      ],
    ];
    for (const [matches, at, message] of itemChecks) {
      if (!matches) projectionMismatch(at, message);
    }
    if (raw.bodyPath !== undefined || raw.body === undefined) {
      projectionMismatch(
        `${prefix}/item/body`,
        "catalog items must contain the canonical mapper's resolved inline body",
      );
    }
    if (item.body !== raw.body) {
      projectionMismatch(`${prefix}/body`, "must equal the resolved canonical item body");
    }
    const projection: CatalogItemProjection = {
      id: raw.id,
      status: raw.status,
      freshness: raw.freshness.state,
      priority,
      title: raw.title,
      statement: raw.statement,
      body: raw.body,
      tags: raw.tags,
      item: raw,
    };
    return {
      projection,
      raw,
      itemJson: json(raw, `${prefix}/item`),
      tagsText: uniqueByteSorted(raw.tags).join("\n"),
    };
  });

  const accepted = items.filter((item) => item.projection.status === "accepted");
  const facets: CatalogFacetProjection = {
    tags: uniqueByteSorted(accepted.flatMap((item) => item.raw.tags)),
    taskTypes: uniqueByteSorted(
      accepted.flatMap((item) => item.raw.retrievalHints?.taskTypes ?? []),
    ),
    audiences: uniqueByteSorted(
      Array.isArray(scope.audiences)
        ? scope.audiences.filter((value): value is string => typeof value === "string")
        : [],
    ),
  };
  if (
    !sameJson(uniqueByteSorted(entry.facets.tags), facets.tags) ||
    !sameJson(uniqueByteSorted(entry.facets.taskTypes), facets.taskTypes) ||
    !sameJson(uniqueByteSorted(entry.facets.audiences), facets.audiences)
  ) {
    projectionMismatch("/facets", "must be derived from accepted canonical items and scope");
  }
  const facetText = uniqueByteSorted([
    ...facets.tags,
    ...facets.taskTypes,
    ...platforms,
    ...technologyKeys,
  ]).join("\n");
  const projection: CatalogEntryProjection = {
    ...entry,
    capsuleId: manifest.id,
    version: manifest.version,
    digest,
    status: effectiveStatus,
    title,
    summary: catalogSummary(manifest),
    profileId: profile?.id ?? null,
    profileVersion: profile?.version ?? null,
    classification,
    assessedAt,
    updatedAt,
    scope,
    facets,
    manifest,
    items: items.map((item) => item.projection),
  };

  return {
    projection,
    manifestJson: json(manifest, "/manifest"),
    scopeJson: json(scope, "/scope"),
    facetsJson: json(facets, "/facets"),
    scopeText: scope.includes.join("\n"),
    facetText,
    items,
  };
}

function resolverRecordIds(entries: readonly PreparedCatalogEntry[]): ReadonlySet<string> {
  const highest = new Map<string, PreparedCatalogEntry>();
  for (const entry of entries) {
    if (entry.projection.status !== "published") continue;
    // The resolver corpus is research-shaped (profile, freshness, items); capsules without a profile are listed by the catalog only.
    if (entry.projection.profileId === null) continue;
    const current = highest.get(entry.projection.capsuleId);
    if (current === undefined) {
      highest.set(entry.projection.capsuleId, entry);
      continue;
    }
    const precedence = compareSemver(
      assertSemver(entry.projection.version),
      assertSemver(current.projection.version),
    );
    if (
      precedence > 0 ||
      (precedence === 0 &&
        compareBytes(entry.projection.version, current.projection.version) < 0)
    ) {
      highest.set(entry.projection.capsuleId, entry);
    }
  }
  return new Set([...highest.values()].map((entry) => entry.projection.recordId));
}

function ftsQuery(input: unknown): string | null {
  assertStringArray(input, "/tokens");
  if (input.length > 1_024) {
    throw new KcError("validation_failed", "/tokens may contain at most 1024 entries", {
      details: [{ at: "/tokens", message: "too many search tokens" }],
    });
  }
  const retained: string[] = [];
  const seen = new Set<string>();
  for (const [index, token] of input.entries()) {
    if (hasUnpairedSurrogate(token)) {
      throw new KcError("validation_failed", `/tokens/${String(index)} is not valid Unicode`, {
        details: [{ at: `/tokens/${String(index)}`, message: "lone surrogate is not allowed" }],
      });
    }
    if (Buffer.byteLength(token) > 4_096) {
      throw new KcError("validation_failed", `/tokens/${String(index)} is too large`, {
        details: [{ at: `/tokens/${String(index)}`, message: "token exceeds 4096 UTF-8 bytes" }],
      });
    }
    const normalized = token.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    retained.push(`"${normalized.replaceAll('"', '""')}"`);
    if (retained.length === 32) break;
  }
  return retained.length === 0 ? null : retained.join(" OR ");
}

/** What the catalog indexes as a capsule's title: the manifest title, else its id. */
export function catalogTitle(manifest: { readonly id: string; readonly title?: string }): string {
  return manifest.title ?? manifest.id;
}

/** What the catalog indexes as a capsule's summary: the manifest summary, else its trigger. */
export function catalogSummary(manifest: {
  readonly summary?: string;
  readonly trigger?: string;
}): string {
  return manifest.summary ?? manifest.trigger ?? "";
}

/** Publication time, else the build's creation time, else unknown. */
export function catalogUpdatedAt(manifest: {
  readonly publishedAt?: string;
  readonly provenance?: { readonly createdAt: string };
}): string | null {
  return manifest.publishedAt ?? manifest.provenance?.createdAt ?? null;
}

interface StoredManifest {
  readonly id: string;
  readonly version: string;
  readonly status: string;
  readonly digest?: string;
  readonly trigger?: string;
  /** Title through minimumResolverVersion are required by kind `research` only. */
  readonly title?: string;
  readonly summary?: string;
  readonly profile?: { readonly id: string; readonly version: string };
  readonly classification?: ResolverCorpusCapsule["classification"];
  readonly scope: ResolverCorpusCapsule["scope"] & { readonly assumptions?: readonly string[] };
  readonly freshness?: Omit<ResolverCorpusCapsule["freshness"], "updateTriggers"> & {
    readonly updateTriggers?: readonly string[];
  };
  readonly publishedAt?: string;
  readonly provenance?: { readonly createdAt: string };
  readonly minimumResolverVersion?: string;
  readonly dependencies?: readonly {
    readonly id: string;
    readonly versionRange: string;
    readonly policy: "required" | "optional" | "development";
    readonly digest?: string;
    readonly reason?: string;
  }[];
}

interface StoredItem {
  readonly id: string;
  readonly kind: ResolverCorpusItem["kind"];
  readonly status: string;
  readonly title: string;
  readonly statement: string;
  readonly body?: string;
  readonly bodyPath?: string;
  readonly applicability: ResolverCorpusItem["applicability"];
  readonly confidence: ResolverCorpusItem["confidence"];
  readonly evidence: ResolverCorpusItem["evidence"];
  readonly relationships?: Partial<ResolverCorpusItem["relationships"]>;
  readonly freshness: Omit<ResolverCorpusItem["freshness"], "updateTriggers"> & {
    readonly updateTriggers?: readonly string[];
  };
  readonly tags: readonly string[];
  readonly retrievalHints?: Partial<ResolverCorpusItem["retrievalHints"]>;
}

function parseStoredJson<T>(raw: string, at: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new KcError("conflict", `stored catalog JSON is malformed at ${at}`, {
      details: [{ at, message: "stored JSON could not be parsed" }],
      cause: error,
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function assertSearchLimit(value: unknown, at: string, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 1_000) {
    throw new KcError("validation_failed", `${at} must be between 1 and 1000`);
  }
  return limit as number;
}

function configure(database: Database): void {
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("trusted_schema = OFF");
}

interface SchemaObject {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string | null;
}

function schemaObjects(database: Database): readonly SchemaObject[] {
  return database.prepare(`
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY name COLLATE BINARY, type COLLATE BINARY
  `).all() as SchemaObject[];
}

const expectedSchemaCache = new Map<number, readonly SchemaObject[]>();

function expectedSchemaObjects(version: number): readonly SchemaObject[] {
  const cached = expectedSchemaCache.get(version);
  if (cached !== undefined) return cached;
  const reference = new Database(":memory:");
  try {
    reference.exec(MIGRATION_TABLE_SQL);
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) reference.exec(migration.up);
    }
    const expected = schemaObjects(reference);
    expectedSchemaCache.set(version, expected);
    return expected;
  } finally {
    reference.close();
  }
}

function assertSchemaState(database: Database, version: number): void {
  const actual = schemaObjects(database);
  const expected = expectedSchemaObjects(version);
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  throw new KcError(
    "unsupported_schema_version",
    `storage schema objects do not match recorded migration version ${String(version)}`,
    {
      details: [
        {
          at: "/schema",
          message: "recorded migration history and SQLite schema objects disagree",
          expected: expected.map((entry) => `${entry.type}:${entry.name}`),
          actual: actual.map((entry) => `${entry.type}:${entry.name}`),
        },
      ],
    },
  );
}

function readAppliedMigrations(database: Database): readonly AppliedMigration[] {
  try {
    return database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as AppliedMigration[];
  } catch (error) {
    throw new KcError(
      "unsupported_schema_version",
      "storage migration history table is malformed",
      { cause: error },
    );
  }
}

function assertMigrationHistory(applied: readonly AppliedMigration[]): void {
  for (const [index, row] of applied.entries()) {
    const known = MIGRATIONS[index];
    if (known === undefined || known.version !== row.version || known.name !== row.name) {
      throw new KcError(
        "unsupported_schema_version",
        `database migration ${row.version}:${row.name} is not supported`,
      );
    }
  }
}

function migrateDatabase(database: Database, targetVersion: number): void {
  if (
    !Number.isSafeInteger(targetVersion) ||
    targetVersion < 0 ||
    targetVersion > CURRENT_STORAGE_SCHEMA_VERSION
  ) {
    throw new KcError(
      "unsupported_schema_version",
      `storage schema target ${String(targetVersion)} is not supported`,
    );
  }
  const migrationTable = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  let applied: readonly AppliedMigration[] = [];
  if (migrationTable === undefined) {
    if (schemaObjects(database).length > 0) {
      throw new KcError(
        "unsupported_schema_version",
        "storage database has schema objects but no migration history",
      );
    }
  } else {
    applied = readAppliedMigrations(database);
    assertMigrationHistory(applied);
    assertSchemaState(database, applied.at(-1)?.version ?? 0);
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  const migrate = database.transaction(() => {
    if (migrationTable === undefined) database.exec(MIGRATION_TABLE_SQL);
    const remove = database.prepare("DELETE FROM schema_migrations WHERE version = ?");
    for (const migration of [...MIGRATIONS].reverse()) {
      if (migration.version <= targetVersion || !appliedVersions.has(migration.version)) continue;
      database.exec(migration.down);
      remove.run(migration.version);
      appliedVersions.delete(migration.version);
    }

    const insert = database.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const migration of MIGRATIONS) {
      if (migration.version > targetVersion || appliedVersions.has(migration.version)) continue;
      database.exec(migration.up);
      insert.run(migration.version, migration.name, new Date().toISOString());
    }
  });
  migrate.immediate();
  const completed = readAppliedMigrations(database);
  assertMigrationHistory(completed);
  assertSchemaState(database, targetVersion);
}

export interface SqliteStorage extends TraceRepository, ResolverCorpusPort {
  schemaVersion(): number;
  appliedMigrations(): readonly AppliedMigration[];
  runtimeInfo(): SqliteRuntimeInfo;
  migrateTo(targetVersion: number): void;
  replaceCatalog(entries: readonly CatalogEntryProjection[]): void;
  searchCatalogCapsules(tokens: readonly string[], limit?: number): readonly CatalogFtsMatch[];
  searchCatalogItems(
    recordId: string,
    tokens: readonly string[],
    limit?: number,
  ): readonly CatalogItemFtsMatch[];
  backupTo(destinationPath: string): Promise<void>;
  close(): void;
}

class BetterSqliteStorage implements SqliteStorage {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  schemaVersion(): number {
    const row = this.#database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { readonly version: number };
    return row.version;
  }

  appliedMigrations(): readonly AppliedMigration[] {
    return this.#database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as AppliedMigration[];
  }

  runtimeInfo(): SqliteRuntimeInfo {
    const version = this.#database
      .prepare("SELECT sqlite_version() AS sqliteVersion")
      .get() as { readonly sqliteVersion: string };
    const fts = this.#database
      .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled")
      .get() as { readonly enabled: number };
    return {
      sqliteVersion: version.sqliteVersion,
      journalMode: this.#database.pragma("journal_mode", { simple: true }) as string,
      foreignKeys: this.#database.pragma("foreign_keys", { simple: true }) === 1,
      synchronous: this.#database.pragma("synchronous", { simple: true }) as number,
      fts5: fts.enabled === 1,
    };
  }

  migrateTo(targetVersion: number): void {
    migrateDatabase(this.#database, targetVersion);
  }

  replaceCatalog(entries: readonly CatalogEntryProjection[]): void {
    const prepared = entries.map(prepareCatalogEntry);
    const visibleRecordIds = resolverRecordIds(prepared);
    const replace = this.#database.transaction(() => {
      this.#database.exec(`
        DELETE FROM item_fts;
        DELETE FROM catalog_fts;
        DELETE FROM catalog_items;
        DELETE FROM catalog_entries;
      `);
      const insertEntry = this.#database.prepare(`
        INSERT INTO catalog_entries (
          record_id, capsule_id, version, digest, status, title, summary,
          profile_id, profile_version, classification, trust, resolver_visible, freshness_json,
          assessed_at, updated_at, source_path, manifest_json, scope_json, facets_json
        ) VALUES (
          @recordId, @capsuleId, @version, @digest, @status, @title, @summary,
          @profileId, @profileVersion, @classification, @trust, @resolverVisible, @freshnessJson,
          @assessedAt, @updatedAt, @sourcePath, @manifestJson, @scopeJson, @facetsJson
        )
      `);
      const insertFts = this.#database.prepare(`
        INSERT INTO catalog_fts (record_id, title, summary, scope_text, facet_text)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertItem = this.#database.prepare(`
        INSERT INTO catalog_items (
          record_id, item_id, status, freshness, priority, item_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertItemFts = this.#database.prepare(`
        INSERT INTO item_fts (record_id, item_id, title, statement, body, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const row of prepared) {
        const entry = row.projection;
        insertEntry.run({
          recordId: entry.recordId,
          capsuleId: entry.capsuleId,
          version: entry.version,
          digest: entry.digest,
          status: entry.status,
          title: entry.title,
          summary: entry.summary,
          profileId: entry.profileId,
          profileVersion: entry.profileVersion,
          classification: entry.classification,
          trust: entry.trust,
          resolverVisible: visibleRecordIds.has(entry.recordId) ? 1 : 0,
          freshnessJson: json({ assessedAt: entry.assessedAt }, "/freshness"),
          assessedAt: entry.assessedAt,
          updatedAt: entry.updatedAt,
          sourcePath: entry.sourcePath,
          manifestJson: row.manifestJson,
          scopeJson: row.scopeJson,
          facetsJson: row.facetsJson,
        });
        insertFts.run(
          entry.recordId,
          entry.title,
          entry.summary,
          row.scopeText,
          row.facetText,
        );
        for (const preparedItem of row.items) {
          const item = preparedItem.projection;
          insertItem.run(
            entry.recordId,
            item.id,
            item.status,
            item.freshness,
            item.priority,
            preparedItem.itemJson,
          );
          insertItemFts.run(
            entry.recordId,
            item.id,
            item.title,
            item.statement,
            item.body,
            preparedItem.tagsText,
          );
        }
      }
    });
    replace.immediate();
  }

  searchCatalogCapsules(tokens: readonly string[], limit = 50): readonly CatalogFtsMatch[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new KcError("validation_failed", "catalog search limit must be between 1 and 1000");
    }
    const query = ftsQuery(tokens);
    if (query === null) return [];
    return this.#database.prepare(`
      SELECT
        entry.record_id AS recordId,
        entry.capsule_id AS capsuleId,
        entry.version AS version,
        entry.digest AS digest,
        bm25(catalog_fts, 4.0, 2.0, 1.5, 1.0) AS bm25
      FROM catalog_fts
      JOIN catalog_entries AS entry ON entry.record_id = catalog_fts.record_id
      WHERE catalog_fts MATCH ?
      ORDER BY bm25 ASC, entry.capsule_id ASC, entry.version ASC, entry.record_id ASC
      LIMIT ?
    `).all(query, limit) as CatalogFtsMatch[];
  }

  searchCatalogItems(
    recordId: string,
    tokens: readonly string[],
    limit = 50,
  ): readonly CatalogItemFtsMatch[] {
    assertLocalId(recordId, "/recordId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new KcError("validation_failed", "item search limit must be between 1 and 1000");
    }
    const query = ftsQuery(tokens);
    if (query === null) return [];
    return this.#database.prepare(`
      SELECT
        item_fts.record_id AS recordId,
        item_fts.item_id AS itemId,
        bm25(item_fts, 3.0, 2.0, 1.0, 1.5) AS bm25
      FROM item_fts
      JOIN catalog_items AS item
        ON item.record_id = item_fts.record_id AND item.item_id = item_fts.item_id
      WHERE item_fts MATCH ? AND item_fts.record_id = ? AND item.status = 'accepted'
      ORDER BY bm25 ASC, item_fts.item_id ASC
      LIMIT ?
    `).all(query, recordId, limit) as CatalogItemFtsMatch[];
  }

  readResolverCorpus(request: ResolverCorpusRequest): ResolverCorpusSnapshot {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      throw new KcError("validation_failed", "resolver corpus request must be an object");
    }
    const query = ftsQuery((request as { readonly tokens?: unknown }).tokens);
    const capsuleLimit = assertSearchLimit(
      (request as { readonly capsuleMatchLimit?: unknown }).capsuleMatchLimit,
      "/capsuleMatchLimit",
      50,
    );
    const itemLimit = assertSearchLimit(
      (request as { readonly itemMatchLimitPerCapsule?: unknown }).itemMatchLimitPerCapsule,
      "/itemMatchLimitPerCapsule",
      50,
    );

    const read = this.#database.transaction((): ResolverCorpusSnapshot => {
      const rows = this.#database.prepare(`
        SELECT
          entry.record_id AS recordId,
          entry.capsule_id AS capsuleId,
          entry.version AS version,
          entry.digest AS digest,
          entry.status AS status,
          entry.trust AS trust,
          entry.title AS entryTitle,
          entry.summary AS entrySummary,
          entry.profile_id AS profileId,
          entry.profile_version AS profileVersion,
          entry.classification AS classification,
          entry.assessed_at AS assessedAt,
          entry.updated_at AS updatedAt,
          entry.manifest_json AS manifestJson,
          entry.scope_json AS scopeJson,
          entry.facets_json AS facetsJson,
          catalog_fts.title AS ftsTitle,
          catalog_fts.summary AS ftsSummary,
          catalog_fts.scope_text AS ftsScopeText,
          catalog_fts.facet_text AS ftsFacetText,
          item.item_id AS itemId,
          item.status AS itemStatus,
          item.freshness AS itemFreshness,
          item.priority AS itemPriority,
          item.item_json AS itemJson,
          item_fts.title AS itemTitle,
          item_fts.statement AS itemStatement,
          item_fts.body AS itemBody,
          item_fts.tags AS itemTags
        FROM catalog_entries AS entry
        JOIN catalog_fts ON catalog_fts.record_id = entry.record_id
        LEFT JOIN catalog_items AS item
          ON item.record_id = entry.record_id AND item.status = 'accepted'
        LEFT JOIN item_fts
          ON item_fts.record_id = item.record_id AND item_fts.item_id = item.item_id
        WHERE entry.resolver_visible = 1
        ORDER BY
          entry.capsule_id COLLATE BINARY,
          entry.version COLLATE BINARY,
          item.item_id COLLATE BINARY
      `).all() as {
        readonly recordId: string;
        readonly capsuleId: string;
        readonly version: string;
        readonly digest: string;
        readonly status: string;
        readonly trust: ResolverTrust;
        readonly entryTitle: string;
        readonly entrySummary: string;
        readonly profileId: string | null;
        readonly profileVersion: string | null;
        readonly classification: string | null;
        readonly assessedAt: string | null;
        readonly updatedAt: string | null;
        readonly manifestJson: string;
        readonly scopeJson: string;
        readonly facetsJson: string;
        readonly ftsTitle: string;
        readonly ftsSummary: string;
        readonly ftsScopeText: string;
        readonly ftsFacetText: string;
        readonly itemId: string | null;
        readonly itemStatus: string | null;
        readonly itemFreshness: string | null;
        readonly itemPriority: number | null;
        readonly itemJson: string | null;
        readonly itemTitle: string | null;
        readonly itemStatement: string | null;
        readonly itemBody: string | null;
        readonly itemTags: string | null;
      }[];

      const capsulesByRecord = new Map<
        string,
        { capsule: Omit<ResolverCorpusCapsule, "items">; items: ResolverCorpusItem[] }
      >();
      const refsByRecord = new Map<string, ResolverCapsuleRef>();

      for (const row of rows) {
        let collected = capsulesByRecord.get(row.recordId);
        if (collected === undefined) {
          const manifest = sharedValidator().assert<StoredManifest>(
            "capsuleManifest",
            parseStoredJson(row.manifestJson, `/catalog/${row.recordId}/manifest`),
            `catalog manifest ${row.recordId}`,
          );
          if (
            manifest.title === undefined ||
            manifest.summary === undefined ||
            manifest.profile === undefined ||
            manifest.classification === undefined ||
            manifest.freshness === undefined ||
            manifest.provenance === undefined ||
            manifest.minimumResolverVersion === undefined
          ) {
            throw new KcError(
              "conflict",
              `resolver catalog row ${row.recordId} is not a research capsule`,
            );
          }
          if (
            row.status !== "published" ||
            manifest.status !== "published" ||
            manifest.id !== row.capsuleId ||
            manifest.version !== row.version ||
            manifest.digest !== row.digest ||
            manifest.title !== row.entryTitle ||
            manifest.summary !== row.entrySummary ||
            manifest.profile.id !== row.profileId ||
            manifest.profile.version !== row.profileVersion ||
            manifest.classification !== row.classification ||
            manifest.freshness.assessedAt !== row.assessedAt ||
            (manifest.publishedAt ?? manifest.provenance.createdAt) !== row.updatedAt ||
            !sameJson(
              manifest.scope,
              parseStoredJson(row.scopeJson, `/catalog/${row.recordId}/scope`),
            )
          ) {
            throw new KcError(
              "conflict",
              `resolver catalog row ${row.recordId} disagrees with its canonical manifest`,
            );
          }
          if (!RESOLVER_TRUST_LEVELS.includes(row.trust)) {
            throw new KcError("conflict", `resolver catalog row ${row.recordId} has invalid trust`);
          }
          const facets = parseStoredJson<{
            readonly tags: unknown;
            readonly taskTypes: unknown;
            readonly audiences: unknown;
          }>(row.facetsJson, `/catalog/${row.recordId}/facets`);
          assertStringArray(facets.tags, `/catalog/${row.recordId}/facets/tags`);
          assertStringArray(facets.taskTypes, `/catalog/${row.recordId}/facets/taskTypes`);
          assertStringArray(facets.audiences, `/catalog/${row.recordId}/facets/audiences`);
          const scope = manifest.scope;
          const platforms = scope.platforms ?? [];
          const expectedFacetText = uniqueByteSorted([
            ...facets.tags,
            ...facets.taskTypes,
            ...platforms,
            ...Object.keys(scope.technologies ?? {}),
          ]).join("\n");
          if (
            row.ftsTitle !== manifest.title ||
            row.ftsSummary !== manifest.summary ||
            row.ftsScopeText !== scope.includes.join("\n") ||
            row.ftsFacetText !== expectedFacetText
          ) {
            throw new KcError(
              "conflict",
              `resolver FTS row ${row.recordId} disagrees with its canonical projection`,
            );
          }
          const ref: ResolverCapsuleRef = {
            capsuleId: row.capsuleId,
            version: row.version,
            digest: row.digest,
          };
          const freshness = manifest.freshness;
          const normalizedFreshness = {
            assessedAt: freshness.assessedAt,
            policy: freshness.policy,
            updateTriggers: freshness.updateTriggers ?? [],
            ...(freshness.maxAgeDays === undefined
              ? {}
              : { maxAgeDays: freshness.maxAgeDays }),
            ...(freshness.notes === undefined ? {} : { notes: freshness.notes }),
          };
          collected = {
            capsule: {
              ref,
              profile: manifest.profile,
              classification: manifest.classification,
              trust: row.trust,
              title: manifest.title,
              summary: manifest.summary,
              scope: manifest.scope,
              facets: {
                tags: uniqueByteSorted(facets.tags),
                taskTypes: uniqueByteSorted(facets.taskTypes),
                audiences: uniqueByteSorted(facets.audiences),
              },
              freshness: normalizedFreshness,
              minimumResolverVersion: manifest.minimumResolverVersion,
              dependencies: (manifest.dependencies ?? []).map((dependency) => ({
                capsuleId: dependency.id,
                versionRange: dependency.versionRange,
                policy: dependency.policy,
                ...(dependency.digest === undefined ? {} : { digest: dependency.digest }),
                ...(dependency.reason === undefined ? {} : { reason: dependency.reason }),
              })),
            },
            items: [],
          };
          capsulesByRecord.set(row.recordId, collected);
          refsByRecord.set(row.recordId, ref);
        }

        if (
          row.itemId === null ||
          row.itemJson === null ||
          row.itemTitle === null ||
          row.itemStatement === null ||
          row.itemBody === null ||
          row.itemTags === null
        ) continue;
        const item = sharedValidator().assert<StoredItem>(
          "knowledgeItem",
          parseStoredJson(row.itemJson, `/catalog/${row.recordId}/items/${row.itemId}`),
          `catalog item ${row.recordId}/${row.itemId}`,
        );
        if (
          item.id !== row.itemId ||
          item.status !== "accepted" ||
          row.itemStatus !== item.status ||
          row.itemFreshness !== item.freshness.state ||
          row.itemPriority !== (item.retrievalHints?.priority ?? null) ||
          row.itemTitle !== item.title ||
          row.itemStatement !== item.statement ||
          row.itemTags !== uniqueByteSorted(item.tags).join("\n") ||
          (item.body !== undefined && row.itemBody !== item.body)
        ) {
          throw new KcError(
            "conflict",
            `resolver catalog item ${row.recordId}/${row.itemId} disagrees with its projection`,
          );
        }
        const relationships = item.relationships ?? {};
        const retrievalHints = item.retrievalHints ?? {};
        collected.items.push({
          id: item.id,
          kind: item.kind,
          title: item.title,
          statement: item.statement,
          body: row.itemBody,
          applicability: item.applicability,
          confidence: item.confidence,
          evidence: item.evidence,
          relationships: {
            dependsOn: relationships.dependsOn ?? [],
            relatedTo: relationships.relatedTo ?? [],
            conflictsWith: relationships.conflictsWith ?? [],
            supersedes: relationships.supersedes ?? [],
          },
          freshness: {
            assessedAt: item.freshness.assessedAt,
            state: item.freshness.state,
            updateTriggers: item.freshness.updateTriggers ?? [],
            ...(item.freshness.validUntil === undefined
              ? {}
              : { validUntil: item.freshness.validUntil }),
          },
          tags: item.tags,
          retrievalHints: {
            queries: retrievalHints.queries ?? [],
            taskTypes: retrievalHints.taskTypes ?? [],
            ...(retrievalHints.priority === undefined
              ? {}
              : { priority: retrievalHints.priority }),
          },
        });
      }

      const capsules: ResolverCorpusCapsule[] = [...capsulesByRecord.values()].map(
        ({ capsule, items }) => ({ ...capsule, items }),
      );
      const capsuleMatches: ResolverCapsuleLexicalMatch[] = [];
      const itemMatches: ResolverItemLexicalMatch[] = [];
      if (query !== null) {
        const capsuleRows = this.#database.prepare(`
          SELECT
            entry.record_id AS recordId,
            bm25(catalog_fts, 4.0, 2.0, 1.5, 1.0) AS bm25
          FROM catalog_fts
          JOIN catalog_entries AS entry ON entry.record_id = catalog_fts.record_id
          WHERE catalog_fts MATCH ? AND entry.resolver_visible = 1
          ORDER BY bm25 ASC, entry.capsule_id ASC, entry.version ASC, entry.record_id ASC
          LIMIT ?
        `).all(query, capsuleLimit) as { readonly recordId: string; readonly bm25: number }[];
        for (const match of capsuleRows) {
          const ref = refsByRecord.get(match.recordId);
          if (ref === undefined) {
            throw new KcError("conflict", "resolver FTS match is absent from its corpus snapshot");
          }
          capsuleMatches.push({ ref, bm25: match.bm25 });
        }

        const itemSearch = this.#database.prepare(`
          SELECT
            item_fts.item_id AS itemId,
            bm25(item_fts, 3.0, 2.0, 1.0, 1.5) AS bm25
          FROM item_fts
          JOIN catalog_items AS item
            ON item.record_id = item_fts.record_id AND item.item_id = item_fts.item_id
          JOIN catalog_entries AS entry ON entry.record_id = item_fts.record_id
          WHERE
            item_fts MATCH ? AND
            item_fts.record_id = ? AND
            item.status = 'accepted' AND
            entry.resolver_visible = 1
          ORDER BY bm25 ASC, item_fts.item_id ASC
          LIMIT ?
        `);
        for (const [recordId, ref] of refsByRecord) {
          const matches = itemSearch.all(query, recordId, itemLimit) as {
            readonly itemId: string;
            readonly bm25: number;
          }[];
          for (const match of matches) {
            itemMatches.push({ ref, itemId: match.itemId, bm25: match.bm25 });
          }
        }
      }

      return deepFreeze({ capsules, capsuleMatches, itemMatches });
    });
    return read.deferred();
  }

  appendTraceEvent(input: unknown): AppendTraceEventResult {
    const event = sharedValidator().assert<TraceEvent>(
      "traceEvent",
      input,
      "trace event",
    );
    const rawJson = canonicalizeJson(event);
    const inserted = this.#database.prepare(`
      INSERT INTO trace_events (
        event_id, trace_id, span_id, timestamp, event_type, outcome,
        capsule_id, capsule_version, knowledge_item_id, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(
      event.eventId,
      event.traceId,
      event.spanId ?? null,
      event.timestamp,
      event.eventType,
      event.outcome,
      event.references.capsuleId ?? null,
      event.references.capsuleVersion ?? null,
      event.references.knowledgeItemId ?? null,
      rawJson,
    );
    if (inserted.changes === 1) return "appended";

    const existing = this.#database
      .prepare("SELECT raw_json AS rawJson FROM trace_events WHERE event_id = ?")
      .get(event.eventId) as { readonly rawJson: string } | undefined;
    if (existing?.rawJson === rawJson) return "duplicate";
    throw new KcError(
      "conflict",
      `trace event ${event.eventId} was already stored with a different payload`,
    );
  }

  listTraceEvents(traceId: string, limit = 1_000, offset = 0): readonly TraceEvent[] {
    assertLocalId(traceId, "/traceId");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new KcError("validation_failed", "trace event limit must be between 1 and 10000");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new KcError("validation_failed", "trace event offset must be a non-negative integer");
    }
    const rows = this.#database.prepare(`
      SELECT raw_json AS rawJson
      FROM trace_events
      WHERE trace_id = ?
      ORDER BY timestamp ASC, event_id ASC
      LIMIT ? OFFSET ?
    `).all(traceId, limit, offset) as { readonly rawJson: string }[];
    return rows.map((row) => JSON.parse(row.rawJson) as TraceEvent);
  }

  traceCounts(traceId: string): TraceCounts {
    assertLocalId(traceId, "/traceId");
    return this.#database.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'capsule_matched') AS matched,
        COUNT(*) FILTER (WHERE event_type = 'item_delivered') AS delivered,
        COUNT(*) FILTER (WHERE event_type = 'item_fetched') AS fetched,
        COUNT(*) FILTER (WHERE event_type = 'item_cited') AS cited,
        COUNT(*) FILTER (WHERE event_type = 'feedback_recorded') AS feedbackRecorded,
        COUNT(*) FILTER (WHERE outcome = 'failed') AS errors
      FROM trace_events
      WHERE trace_id = ?
    `).get(traceId) as TraceCounts;
  }

  itemUsage(capsuleId: string, version: string, itemId: string): ItemUsageCounts {
    assertCapsuleId(capsuleId, "/capsuleId");
    assertSemver(version, "/version");
    assertLocalId(itemId, "/itemId");
    return this.#database.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'item_delivered') AS delivered,
        COUNT(*) FILTER (WHERE event_type = 'item_fetched') AS fetched,
        COUNT(*) FILTER (WHERE event_type = 'item_cited') AS cited
      FROM trace_events
      WHERE capsule_id = ? AND capsule_version = ? AND knowledge_item_id = ?
    `).get(capsuleId, version, itemId) as ItemUsageCounts;
  }

  async backupTo(destinationPath: string): Promise<void> {
    const destination = resolve(destinationPath);
    if (this.#database.name !== ":memory:" && destination === resolve(this.#database.name)) {
      throw new KcError("conflict", "SQLite backup destination must differ from the live database");
    }
    if (existsSync(destination)) {
      throw new KcError("conflict", "SQLite backup destination already exists");
    }
    mkdirSync(dirname(destination), { recursive: true });
    try {
      await this.#database.backup(destination);
    } catch (error) {
      throw new KcError("internal", "failed to create the SQLite backup", { cause: error });
    }
  }

  close(): void {
    this.#database.close();
  }
}

export function openSqliteStorage(databasePath: string): SqliteStorage {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    configure(database);
    migrateDatabase(database, CURRENT_STORAGE_SCHEMA_VERSION);
    return new BetterSqliteStorage(database);
  } catch (error) {
    database.close();
    if (error instanceof KcError) throw error;
    throw new KcError("internal", "failed to open the SQLite storage adapter", {
      cause: error,
    });
  }
}
