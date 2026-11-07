import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  openSqliteStorage,
  rebuildCatalogFromCanonicalVault,
  type TraceEvent,
} from "../../src/index.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kc-storage-integration-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function deliveredEvent(): TraceEvent {
  return {
    schemaVersion: "0.1",
    eventId: "event-integration-1",
    traceId: "trace-integration-1",
    timestamp: "2026-09-01T06:00:00Z",
    eventType: "item_delivered",
    actor: { type: "system", id: "core" },
    outcome: "succeeded",
    references: {
      capsuleId: "engineering/electron-local-baseline-fixture",
      capsuleVersion: "0.1.0",
      knowledgeItemId: "ki-validate-ipc",
      contextPackId: "context-integration-1",
    },
    attributes: { source: "integration-fixture" },
  };
}

describe("canonical vault + SQLite", () => {
  it("rebuilds, persists events, backs up, and reopens through the native adapter", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftDir = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-integration-1",
    );
    await mkdir(draftDir, { recursive: true });
    await cp(
      fileURLToPath(new URL("../../../../fixtures/example-capsule/", import.meta.url)),
      draftDir,
      { recursive: true },
    );

    const databasePath = join(vaultRoot, "database.sqlite");
    const backupPath = join(workDir, "backup", "database.sqlite");
    const storage = openSqliteStorage(databasePath);
    try {
      expect(
        await rebuildCatalogFromCanonicalVault(storage, vaultRoot, {
          validationPolicyFor: ({ profileId, profileVersion }) => ({
            profileId,
            profileVersion,
            minimumVerifiedEvidencePerMaterialItem: 1,
          }),
        }),
      ).toMatchObject({ entries: 1, items: 3 });
      storage.appendTraceEvent(deliveredEvent());
      await storage.backupTo(backupPath);
    } finally {
      storage.close();
    }

    const backup = openSqliteStorage(backupPath);
    try {
      expect(backup.searchCatalogCapsules(["renderer"])).toHaveLength(1);
      expect(backup.searchCatalogItems(backup.searchCatalogCapsules(["renderer"])[0]?.recordId ?? "", [
        "unexpected",
      ])).toHaveLength(1);
      expect(backup.listTraceEvents("trace-integration-1")).toEqual([deliveredEvent()]);
      expect(backup.itemUsage(
        "engineering/electron-local-baseline-fixture",
        "0.1.0",
        "ki-validate-ipc",
      )).toEqual({ delivered: 1, fetched: 0, cited: 0 });
    } finally {
      backup.close();
    }
  });
});
