import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "../src/sqlite-driver.ts";

import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  openSqliteStorage,
  rebuildCatalogFromCanonicalVault,
  type CatalogEntryProjection,
  type CatalogRebuildOptions,
  type TraceEvent,
} from "../src/index.ts";

let workDir: string;

function catalogEntry(
  overrides: Partial<CatalogEntryProjection> = {},
): CatalogEntryProjection {
  const entry: CatalogEntryProjection = {
    recordId: "record-electron-1",
    capsuleId: "engineering/electron",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    status: "published",
    title: "Electron renderer isolation",
    summary: "A secure local renderer baseline",
    profileId: "software-engineering",
    profileVersion: "0.1.0",
    classification: "public",
    trust: "local-authored",
    assessedAt: "2026-08-31T16:00:00Z",
    updatedAt: "2026-08-31T16:00:00Z",
    sourcePath: "capsules/engineering/electron/versions/1.0.0/aaaaaaaa",
    scope: {
      includes: ["renderer isolation"],
      excludes: [],
      assumptions: [],
      platforms: ["macos"],
      technologies: { electron: ">=44 <45" },
    },
    facets: { tags: [], taskTypes: [], audiences: [] },
    manifest: {},
    items: [],
    ...overrides,
  };
  const publishedSide = ["published", "superseded", "archived"].includes(entry.status);
  return {
    ...entry,
    manifest: overrides.manifest ?? {
      schemaVersion: "0.1",
      kind: "research",
      trigger: "Use when testing the catalog.",
      id: entry.capsuleId,
      version: entry.version,
      status: entry.status,
      ...(publishedSide ? { digest: entry.digest, publishedAt: entry.updatedAt } : {}),
      title: entry.title,
      summary: entry.summary,
      profile: { id: entry.profileId, version: entry.profileVersion },
      classification: entry.classification,
      maintainers: [{ id: "owner:test", displayName: "Test owner" }],
      scope: entry.scope,
      freshness: {
        assessedAt: entry.assessedAt,
        policy: "source_version",
        maxAgeDays: 90,
      },
      contents: {
        canonical: "canonical.md",
        scope: "scope.json",
        knowledgeItems: "knowledge/items.jsonl",
        sources: "sources/index.jsonl",
        evidence: "evidence/index.jsonl",
        provenance: "provenance/build.json",
        provenanceLedger: "provenance/ledger.jsonl",
        changelog: "changelog.md",
      },
      inventory: { knowledgeItems: entry.items.length, sources: 0, evidence: 0 },
      dependencies: [],
      provenance: {
        createdAt: entry.updatedAt ?? entry.assessedAt,
        createdBy: ["test-author"],
        buildRunId: "run-test-catalog",
      },
      minimumResolverVersion: "0.1.0",
    },
  };
}

function catalogItem(
  overrides: Partial<CatalogEntryProjection["items"][number]> = {},
): CatalogEntryProjection["items"][number] {
  const projection = {
    id: "ki-validate-ipc",
    status: "accepted",
    freshness: "current",
    priority: 90,
    title: "Validate privileged IPC",
    statement: "Validate payload and sender before privileged work.",
    body: "Expose a narrow preload bridge.",
    tags: ["electron", "ipc", "security"],
    item: {},
    ...overrides,
  };
  return {
    ...projection,
    item: overrides.item ?? {
      id: projection.id,
      kind: "decision_rule",
      status: projection.status,
      title: projection.title,
      statement: projection.statement,
      body: projection.body,
      applicability: { includes: ["privileged IPC"], excludes: [] },
      confidence: { level: "high", value: 0.9, rationale: "Verified test fixture." },
      evidence: { supports: [], contradicts: [], qualifies: [], contextualizes: [] },
      relationships: { dependsOn: [], relatedTo: [], conflictsWith: [], supersedes: [] },
      freshness: {
        assessedAt: "2026-08-31T16:00:00Z",
        state: projection.freshness,
      },
      tags: projection.tags,
      retrievalHints: { queries: ["privileged IPC"], taskTypes: ["implementation"], priority: projection.priority },
      createdAt: "2026-08-31T16:00:00Z",
      updatedAt: "2026-08-31T16:00:00Z",
      createdBy: ["test-author"],
    },
  };
}

function traceEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schemaVersion: "0.1",
    eventId: "event-1",
    traceId: "trace-1",
    timestamp: "2026-09-01T06:00:00Z",
    eventType: "item_delivered",
    actor: { type: "system", id: "core" },
    outcome: "succeeded",
    references: {
      capsuleId: "engineering/electron",
      capsuleVersion: "1.0.0",
      knowledgeItemId: "ki-validate-ipc",
      contextPackId: "context-1",
    },
    attributes: { channel: "context-pack" },
    ...overrides,
  };
}

function catalogRebuildOptions(
  minimumVerifiedEvidencePerMaterialItem = 1,
): CatalogRebuildOptions {
  return {
    validationPolicyFor: ({ profileId, profileVersion }) =>
      profileId === "software-engineering" && profileVersion === "0.1.0"
        ? {
            profileId,
            profileVersion,
            minimumVerifiedEvidencePerMaterialItem,
          }
        : undefined,
  };
}

async function resolverCatalogEntry(
  overrides: Partial<CatalogEntryProjection> = {},
): Promise<CatalogEntryProjection> {
  const fixtureDir = fileURLToPath(
    new URL("../../../fixtures/example-capsule/", import.meta.url),
  );
  const base = catalogEntry(overrides);
  const manifest = JSON.parse(
    await readFile(join(fixtureDir, "capsule.json"), "utf8"),
  ) as Record<string, unknown>;
  manifest["id"] = base.capsuleId;
  manifest["version"] = base.version;
  manifest["status"] = base.status;
  manifest["title"] = base.title;
  manifest["summary"] = base.summary;
  manifest["profile"] = { id: base.profileId, version: base.profileVersion };
  manifest["classification"] = base.classification;
  manifest["scope"] = base.scope;
  manifest["freshness"] = {
    assessedAt: base.assessedAt,
    policy: "source_version",
    maxAgeDays: 90,
  };
  if (base.status === "published" || base.status === "superseded" || base.status === "archived") {
    manifest["digest"] = base.digest;
    manifest["publishedAt"] = base.updatedAt ?? base.assessedAt;
  } else {
    delete manifest["digest"];
    delete manifest["publishedAt"];
  }

  const rawItems = (await readFile(join(fixtureDir, "knowledge", "items.jsonl"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const first = rawItems[0];
  if (first === undefined) throw new Error("fixture item is missing");
  const freshness = first["freshness"] as { readonly state: string };
  const retrievalHints = first["retrievalHints"] as { readonly priority?: number };

  return {
    ...base,
    manifest,
    facets: {
      tags: first["tags"] as readonly string[],
      taskTypes: (first["retrievalHints"] as { readonly taskTypes?: readonly string[] })
        .taskTypes ?? [],
      audiences: [],
    },
    items: [
      {
        id: first["id"] as string,
        status: first["status"] as string,
        freshness: freshness.state,
        priority: retrievalHints.priority ?? null,
        title: first["title"] as string,
        statement: first["statement"] as string,
        body: first["body"] as string,
        tags: first["tags"] as readonly string[],
        item: first,
      },
    ],
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kc-storage-sqlite-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("openSqliteStorage", () => {
  it("migrates a new database to the current storage schema", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      expect(storage.schemaVersion()).toBe(CURRENT_STORAGE_SCHEMA_VERSION);
    } finally {
      storage.close();
    }
  });

  it("reports the admitted SQLite durability and FTS5 capabilities", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      expect(storage.runtimeInfo()).toMatchObject({
        journalMode: "wal",
        foreignKeys: true,
        fts5: true,
      });
      expect(storage.runtimeInfo().sqliteVersion).toMatch(/^3\./);
    } finally {
      storage.close();
    }
  });

  it("reopens an already migrated database without changing its schema history", () => {
    const databasePath = join(workDir, "database.sqlite");
    openSqliteStorage(databasePath).close();

    const reopened = openSqliteStorage(databasePath);
    try {
      expect(reopened.appliedMigrations()).toEqual([
        { version: 1, name: "initial-catalog-and-events" },
      ]);
    } finally {
      reopened.close();
    }
  });

  it("can migrate down and back up through the declared schema history", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.migrateTo(0);
      expect(storage.schemaVersion()).toBe(0);
      expect(storage.appliedMigrations()).toEqual([]);

      storage.migrateTo(CURRENT_STORAGE_SCHEMA_VERSION);
      expect(storage.appliedMigrations()).toEqual([
        { version: 1, name: "initial-catalog-and-events" },
      ]);
    } finally {
      storage.close();
    }
  });

  it("fails closed on an unknown migration without creating current-schema tables", () => {
    const databasePath = join(workDir, "database.sqlite");
    const future = new Database(databasePath);
    future.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (999, 'future-schema', '2026-09-01T06:00:00Z');
    `);
    future.close();

    expect(() => openSqliteStorage(databasePath)).toThrow(
      expect.objectContaining({ code: "unsupported_schema_version" }),
    );

    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(
        inspected
          .prepare("SELECT name FROM sqlite_master WHERE name = 'catalog_entries'")
          .get(),
      ).toBeUndefined();
    } finally {
      inspected.close();
    }
  });

  it("fails closed when a known migration row is missing its declared schema", () => {
    const databasePath = join(workDir, "database.sqlite");
    const malformed = new Database(databasePath);
    malformed.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (
        1,
        'initial-catalog-and-events',
        '2026-09-01T06:00:00Z'
      );
    `);
    malformed.close();

    expect(() => openSqliteStorage(databasePath)).toThrow(
      expect.objectContaining({ code: "unsupported_schema_version" }),
    );
  });

  it("rolls back migration bootstrap when an induced migration fails", () => {
    const databasePath = join(workDir, "database.sqlite");
    const incompatible = new Database(databasePath);
    incompatible.exec("CREATE TABLE catalog_entries (wrong_column TEXT)");
    incompatible.close();

    expect(() => openSqliteStorage(databasePath)).toThrow();

    const inspected = new Database(databasePath, { readonly: true });
    try {
      expect(
        inspected
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations'")
          .get(),
      ).toBeUndefined();
    } finally {
      inspected.close();
    }
  });

  it("reopens committed catalog and events after a process exits without closing SQLite", async () => {
    const databasePath = join(workDir, "database.sqlite");
    const moduleUrl = new URL("../src/index.ts", import.meta.url).href;
    const script = `
      import { openSqliteStorage } from ${JSON.stringify(moduleUrl)};
      const storage = openSqliteStorage(${JSON.stringify(databasePath)});
      storage.replaceCatalog(${JSON.stringify([catalogEntry()])});
      storage.appendTraceEvent(${JSON.stringify(traceEvent())});
      process.exit(0);
    `;
    const child = spawn(process.execPath, ["--eval", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(Buffer.concat(stderr).toString("utf8")).toBe("");
    expect(exitCode).toBe(0);

    const reopened = openSqliteStorage(databasePath);
    try {
      expect(reopened.searchCatalogCapsules(["renderer"])).toHaveLength(1);
      expect(reopened.listTraceEvents("trace-1")).toEqual([traceEvent()]);
    } finally {
      reopened.close();
    }
  });
});

describe("catalog projection", () => {
  it("indexes capsule metadata in FTS5 and returns BM25 matches", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);

      const matches = storage.searchCatalogCapsules(["renderer"]);
      expect(matches).toEqual([
        {
          recordId: "record-electron-1",
          capsuleId: "engineering/electron",
          version: "1.0.0",
          digest: `sha256:${"a".repeat(64)}`,
          bm25: expect.any(Number),
        },
      ]);
      expect(matches[0]?.bm25).toBeLessThan(0);
    } finally {
      storage.close();
    }
  });

  it("indexes accepted knowledge-item text separately within a capsule version", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([
        catalogEntry({
          facets: {
            tags: ["electron", "ipc", "security"],
            taskTypes: ["implementation"],
            audiences: [],
          },
          items: [catalogItem()],
        }),
      ]);

      const matches = storage.searchCatalogItems("record-electron-1", ["privileged"]);
      expect(matches).toEqual([
        {
          recordId: "record-electron-1",
          itemId: "ki-validate-ipc",
          bm25: expect.any(Number),
        },
      ]);
      expect(matches[0]?.bm25).toBeLessThan(0);
    } finally {
      storage.close();
    }
  });

  it("keeps the previous catalog intact when a replacement fails mid-transaction", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);

      expect(() =>
        storage.replaceCatalog([
          catalogEntry({ recordId: "conflict-a" }),
          catalogEntry({
            recordId: "conflict-b",
            digest: `sha256:${"b".repeat(64)}`,
          }),
        ])
      ).toThrow();

      expect(storage.searchCatalogCapsules(["renderer"]).map((match) => match.recordId)).toEqual([
        "record-electron-1",
      ]);
    } finally {
      storage.close();
    }
  });

  it("treats FTS query syntax as text rather than executable query operators", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);
      expect(() => storage.searchCatalogCapsules(['renderer" OR * NOT security'])).not.toThrow();
      expect(storage.searchCatalogCapsules(['renderer" OR * NOT security'])).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("rejects non-string-array FTS input at both public search boundaries", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);
      const invalidInputs: readonly unknown[] = [null, "renderer", [null], [7], [{}]];
      for (const input of invalidInputs) {
        expect(() => storage.searchCatalogCapsules(input as never)).toThrow(
          expect.objectContaining({ code: "validation_failed" }),
        );
        expect(() => storage.searchCatalogItems("record-electron-1", input as never)).toThrow(
          expect.objectContaining({ code: "validation_failed" }),
        );
        expect(() => storage.readResolverCorpus({ tokens: input as never })).toThrow(
          expect.objectContaining({ code: "validation_failed" }),
        );
      }
    } finally {
      storage.close();
    }
  });

  it("normalizes, deduplicates, and bounds resolver FTS tokens deterministically", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([
        catalogEntry({ title: "Renderer A", summary: "Renderer isolation" }),
      ]);
      expect(storage.searchCatalogCapsules([" A "])).toEqual([]);
      expect(storage.searchCatalogCapsules([" RENDERER "])).toEqual(
        storage.searchCatalogCapsules(["renderer", "renderer"]),
      );
      expect(() => storage.searchCatalogCapsules(["\ud800"])).toThrow(
        expect.objectContaining({ code: "validation_failed" }),
      );
    } finally {
      storage.close();
    }
  });

  it("uses the declared unicode61 diacritic-removing tokenizer", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([
        catalogEntry({ title: "Résumé review", summary: "Candidate evaluation" }),
      ]);
      expect(storage.searchCatalogCapsules(["resume"])).toHaveLength(1);
    } finally {
      storage.close();
    }
  });

  it("breaks equal BM25 scores by capsule identity rather than insertion order", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([
        catalogEntry({
          recordId: "record-zeta",
          capsuleId: "engineering/zeta",
          digest: `sha256:${"c".repeat(64)}`,
          title: "Shared retrieval term",
          summary: "Equal text",
        }),
        catalogEntry({
          recordId: "record-alpha",
          capsuleId: "engineering/alpha",
          digest: `sha256:${"d".repeat(64)}`,
          title: "Shared retrieval term",
          summary: "Equal text",
        }),
      ]);

      expect(storage.searchCatalogCapsules(["retrieval"]).map((match) => match.capsuleId)).toEqual([
        "engineering/alpha",
        "engineering/zeta",
      ]);
    } finally {
      storage.close();
    }
  });

  it("returns a frozen resolver corpus containing only each capsule's highest published version", async () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([
        await resolverCatalogEntry({
          recordId: "record-electron-v2",
          version: "2.0.0",
          digest: `sha256:${"b".repeat(64)}`,
        }),
        await resolverCatalogEntry({
          recordId: "record-electron-v10",
          version: "10.0.0",
          digest: `sha256:${"c".repeat(64)}`,
          trust: "quarantined",
        }),
        await resolverCatalogEntry({
          recordId: "record-electron-draft",
          version: "11.0.0",
          digest: null,
          status: "draft",
          sourcePath: "capsules/engineering/electron/drafts/draft-11",
        }),
      ]);

      const snapshot = storage.readResolverCorpus({ tokens: ["renderer"] });
      expect(snapshot.capsules).toEqual([
        expect.objectContaining({
          ref: {
            capsuleId: "engineering/electron",
            version: "10.0.0",
            digest: `sha256:${"c".repeat(64)}`,
          },
          trust: "quarantined",
          minimumResolverVersion: "0.1.0",
          scope: expect.objectContaining({ technologies: { electron: ">=44 <45" } }),
          facets: expect.objectContaining({
            tags: expect.arrayContaining(["electron", "security"]),
          }),
          freshness: expect.objectContaining({ policy: "source_version" }),
          items: [
            expect.objectContaining({
              id: "ki-renderer-isolation",
              applicability: expect.objectContaining({ includes: ["Electron renderer windows"] }),
              confidence: expect.objectContaining({ level: "high", value: 0.95 }),
              evidence: expect.objectContaining({ supports: ["ev-context-isolation"] }),
              relationships: expect.objectContaining({ relatedTo: expect.any(Array) }),
              retrievalHints: expect.objectContaining({ priority: 80 }),
              freshness: expect.objectContaining({ state: "current" }),
            }),
          ],
        }),
      ]);
      expect(snapshot.capsuleMatches).toEqual([
        expect.objectContaining({
          ref: expect.objectContaining({ version: "10.0.0" }),
          bm25: expect.any(Number),
        }),
      ]);
      expect(snapshot.itemMatches).toEqual([
        expect.objectContaining({
          ref: expect.objectContaining({ version: "10.0.0" }),
          itemId: "ki-renderer-isolation",
          bm25: expect.any(Number),
        }),
      ]);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.capsules)).toBe(true);
      expect(Object.isFrozen(snapshot.capsules[0]?.items)).toBe(true);

      storage.replaceCatalog([]);
      expect(snapshot.capsules[0]?.ref.version).toBe("10.0.0");
      expect(storage.readResolverCorpus({ tokens: ["renderer"] })).toEqual({
        capsules: [],
        capsuleMatches: [],
        itemMatches: [],
      });
    } finally {
      storage.close();
    }
  });

  it("rejects catalog and item projection fields that disagree with canonical JSON", async () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      const entry = await resolverCatalogEntry();
      expect(() =>
        storage.replaceCatalog([
          {
            ...entry,
            title: "poison",
            facets: { tags: ["poison"], taskTypes: [], audiences: [] },
          },
        ])
      ).toThrow(expect.objectContaining({ code: "validation_failed" }));

      const item = entry.items[0];
      if (item === undefined) throw new Error("fixture item is missing");
      expect(() =>
        storage.replaceCatalog([
          {
            ...entry,
            items: [{ ...item, body: "poison" }],
          },
        ])
      ).toThrow(expect.objectContaining({ code: "validation_failed" }));

      const bodyPathItem = item.item as Record<string, unknown>;
      const { body: _inlineBody, ...withoutInlineBody } = bodyPathItem;
      expect(() =>
        storage.replaceCatalog([
          {
            ...entry,
            items: [
              {
                ...item,
                body: "poison-body-path",
                item: {
                  ...withoutInlineBody,
                  bodyPath: "patterns/secure-renderer-boundary.md",
                },
              },
            ],
          },
        ])
      ).toThrow(expect.objectContaining({ code: "validation_failed" }));
    } finally {
      storage.close();
    }
  });

  it("accepts a registry lifecycle overlay for an immutable published manifest", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      const published = catalogEntry();
      const manifest = published.manifest as Record<string, unknown>;
      storage.replaceCatalog([
        catalogEntry({
          status: "superseded",
          manifest: { ...manifest, status: "published" },
        }),
      ]);

      expect(storage.searchCatalogCapsules(["renderer"])).toHaveLength(1);
      expect(storage.readResolverCorpus({ tokens: ["renderer"] })).toEqual({
        capsules: [],
        capsuleMatches: [],
        itemMatches: [],
      });
    } finally {
      storage.close();
    }
  });

  it("rebuilds the searchable projection from canonical capsule files", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-fixture-1",
    );
    await mkdir(draftDir, { recursive: true });
    const fixtureDir = fileURLToPath(
      new URL("../../../fixtures/example-capsule/", import.meta.url),
    );
    await cp(fixtureDir, draftDir, { recursive: true });

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      const rebuilt = await rebuildCatalogFromCanonicalVault(
        storage,
        vaultRoot,
        catalogRebuildOptions(),
      );
      expect(rebuilt).toMatchObject({ entries: 1, items: 3 });
      expect(storage.searchCatalogCapsules(["renderer"])).toEqual([
        expect.objectContaining({
          capsuleId: "engineering/electron-local-baseline-fixture",
          version: "0.1.0",
          digest: null,
        }),
      ]);
      expect(storage.searchCatalogItems(rebuilt.recordIds[0] ?? "", ["unexpected"])).toEqual([
        expect.objectContaining({ itemId: "ki-validate-ipc" }),
      ]);
    } finally {
      storage.close();
    }
  });

  it("resolves canonical bodyPath bytes before storing or indexing an item", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-body-path",
    );
    await mkdir(draftDir, { recursive: true });
    await cp(
      fileURLToPath(new URL("../../../fixtures/example-capsule/", import.meta.url)),
      draftDir,
      { recursive: true },
    );
    const itemPath = join(draftDir, "knowledge", "items.jsonl");
    const records = (await readFile(itemPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const first = records[0];
    if (first === undefined) throw new Error("fixture item is missing");
    delete first["body"];
    first["bodyPath"] = "patterns/secure-renderer-boundary.md";
    await writeFile(itemPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      const rebuilt = await rebuildCatalogFromCanonicalVault(
        storage,
        vaultRoot,
        catalogRebuildOptions(),
      );
      expect(
        storage.searchCatalogItems(rebuilt.recordIds[0] ?? "", ["incomplete"]),
      ).toEqual([
        expect.objectContaining({ itemId: "ki-renderer-isolation" }),
      ]);
    } finally {
      storage.close();
    }
  });

  it("does not replace a working catalog when canonical input fails validation", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(vaultRoot, "capsules", "broken", "fixture", "drafts", "draft-1");
    await mkdir(draftDir, { recursive: true });
    const fixtureDir = fileURLToPath(
      new URL("../../../fixtures/example-capsule/", import.meta.url),
    );
    await cp(fixtureDir, draftDir, { recursive: true });
    await writeFile(join(draftDir, "knowledge", "items.jsonl"), "{not-json}\n");

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, catalogRebuildOptions()),
      ).rejects.toMatchObject({ code: "validation_failed" });
      expect(storage.searchCatalogCapsules(["renderer"]).map((match) => match.recordId)).toEqual([
        "record-electron-1",
      ]);
    } finally {
      storage.close();
    }
  });

  it("preserves a working catalog when the canonical capsules root is missing", async () => {
    const vaultRoot = join(workDir, "missing-vault");
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, catalogRebuildOptions()),
      ).rejects.toMatchObject({ code: "vault_not_found" });
      expect(storage.searchCatalogCapsules(["renderer"]).map((match) => match.recordId)).toEqual([
        "record-electron-1",
      ]);
    } finally {
      storage.close();
    }
  });

  it("rejects capsule packages outside the canonical drafts or versions layout", async () => {
    const vaultRoot = join(workDir, "vault");
    const invalidDir = join(vaultRoot, "capsules", "not-canonical");
    await mkdir(invalidDir, { recursive: true });
    await cp(
      fileURLToPath(new URL("../../../fixtures/example-capsule/", import.meta.url)),
      invalidDir,
      { recursive: true },
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      storage.replaceCatalog([catalogEntry()]);
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, catalogRebuildOptions()),
      ).rejects.toMatchObject({ code: "validation_failed" });
      expect(storage.searchCatalogCapsules(["renderer"]).map((match) => match.recordId)).toEqual([
        "record-electron-1",
      ]);
    } finally {
      storage.close();
    }
  });

  it("fails closed when the manifest's pinned profile policy is unavailable", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-fixture-1",
    );
    await mkdir(draftDir, { recursive: true });
    await cp(
      fileURLToPath(new URL("../../../fixtures/example-capsule/", import.meta.url)),
      draftDir,
      { recursive: true },
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, {
          validationPolicyFor: () => undefined,
        }),
      ).rejects.toMatchObject({ code: "policy_denied" });
    } finally {
      storage.close();
    }
  });

  it("uses the pinned profile's evidence minimum during canonical rebuild", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-fixture-1",
    );
    await mkdir(draftDir, { recursive: true });
    await cp(
      fileURLToPath(new URL("../../../fixtures/example-capsule/", import.meta.url)),
      draftDir,
      { recursive: true },
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, catalogRebuildOptions(2)),
      ).rejects.toMatchObject({ code: "validation_failed" });
    } finally {
      storage.close();
    }
  });
});

describe("trace event store", () => {
  it("preserves a validated event and treats an exact replay as idempotent", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      const event = traceEvent();
      expect(storage.appendTraceEvent(event)).toBe("appended");
      expect(storage.appendTraceEvent(event)).toBe("duplicate");
      expect(storage.listTraceEvents("trace-1")).toEqual([event]);
    } finally {
      storage.close();
    }
  });

  it("rejects an event-ID replay with a different payload and preserves the original", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      const original = traceEvent();
      storage.appendTraceEvent(original);

      expect(() =>
        storage.appendTraceEvent(
          traceEvent({ attributes: { channel: "changed-after-retry" } }),
        )
      ).toThrow(expect.objectContaining({ code: "conflict" }));
      expect(storage.listTraceEvents("trace-1")).toEqual([original]);
    } finally {
      storage.close();
    }
  });

  it("keeps matched, delivered, fetched, cited, feedback, and error counts distinct", () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    try {
      const eventTypes: readonly [TraceEvent["eventType"], TraceEvent["outcome"]][] = [
        ["capsule_matched", "succeeded"],
        ["item_delivered", "succeeded"],
        ["item_fetched", "succeeded"],
        ["item_cited", "succeeded"],
        ["feedback_recorded", "succeeded"],
        ["worker_failed", "failed"],
      ];
      eventTypes.forEach(([eventType, outcome], index) => {
        storage.appendTraceEvent(
          traceEvent({
            eventId: `event-${String(index + 1)}`,
            timestamp: `2026-09-01T06:00:0${String(index)}Z`,
            eventType,
            outcome,
          }),
        );
      });

      expect(storage.traceCounts("trace-1")).toEqual({
        matched: 1,
        delivered: 1,
        fetched: 1,
        cited: 1,
        feedbackRecorded: 1,
        errors: 1,
      });
      expect(
        storage.itemUsage("engineering/electron", "1.0.0", "ki-validate-ipc"),
      ).toEqual({ delivered: 1, fetched: 1, cited: 1 });
    } finally {
      storage.close();
    }
  });
});

describe("SQLite backup", () => {
  it("creates a consistent backup containing catalog and event data", async () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    const backupPath = join(workDir, "backups", "database.sqlite");
    try {
      storage.replaceCatalog([catalogEntry()]);
      storage.appendTraceEvent(traceEvent());
      await storage.backupTo(backupPath);
    } finally {
      storage.close();
    }

    const backup = openSqliteStorage(backupPath);
    try {
      expect(backup.searchCatalogCapsules(["renderer"])).toHaveLength(1);
      expect(backup.listTraceEvents("trace-1")).toEqual([traceEvent()]);
    } finally {
      backup.close();
    }
  });

  it("refuses to overwrite an existing backup target", async () => {
    const storage = openSqliteStorage(join(workDir, "database.sqlite"));
    const backupPath = join(workDir, "existing.sqlite");
    await writeFile(backupPath, "preserve me");
    try {
      await expect(storage.backupTo(backupPath)).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(backupPath, "utf8")).toBe("preserve me");
    } finally {
      storage.close();
    }
  });
});
