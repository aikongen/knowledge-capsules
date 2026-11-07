import type { CapsuleEntry } from "../../src/digest.ts";
import { createCapsulePackage, type CapsulePackage } from "../../src/package.ts";

/**
 * Shared fixture builder for `validation.test.ts` and friends.
 *
 * Deliberately hand-rolled rather than reused from `fixtures/example-capsule/`:
 * the hostile-fixture tests need to flip exactly one field at a time, and a
 * minimal capsule with one knowledge item, one source, and one evidence record
 * makes it obvious which mutation caused which rule to fire.
 */

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function jsonLine(value: unknown): Uint8Array {
  return utf8(`${JSON.stringify(value)}\n`);
}

export const FIXTURE_TIMESTAMP = "2026-08-31T16:00:00.000Z";

export function baseScope(): Record<string, unknown> {
  return {
    includes: ["fixture scope"],
    excludes: [],
    assumptions: ["test fixture only"],
  };
}

export function baseKnowledgeItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "ki-001",
    kind: "guidance",
    status: "accepted",
    title: "Fixture guidance",
    statement: "Fixture guidance statement.",
    applicability: { includes: ["fixture"], excludes: [] },
    confidence: { level: "high", value: 0.9, rationale: "fixture" },
    evidence: {
      supports: ["ev-001"],
      contradicts: [],
      qualifies: [],
      contextualizes: [],
    },
    freshness: { assessedAt: FIXTURE_TIMESTAMP, state: "current" },
    tags: ["fixture"],
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    ...overrides,
  };
}

export function baseSource(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "src-001",
    kind: "web",
    title: "Fixture source",
    origin: { uri: "https://example.test/fixture" },
    acquisition: {
      discoveredAt: FIXTURE_TIMESTAMP,
      method: "fixture",
      originalRetrieved: true,
    },
    verification: { status: "verified", method: "fixture" },
    rights: { redistribution: "reference_only" },
    classification: "public",
    ...overrides,
  };
}

export function baseEvidence(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "ev-001",
    sourceId: "src-001",
    relation: "supports",
    locator: { section: "fixture" },
    summary: "Fixture evidence summary.",
    verification: { status: "verified", method: "fixture" },
    ...overrides,
  };
}

/** A schema-valid, rule-valid manifest in draft status (no digest required). */
export function baseManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "0.1",
    kind: "research",
    trigger: "Use when writing a fixture.",
    id: "test/fixture-capsule",
    version: "0.1.0",
    status: "draft",
    title: "Fixture Capsule",
    summary: "Minimal capsule fixture for capsule-format tests.",
    profile: { id: "software-engineering", version: "0.1.0" },
    classification: "public",
    maintainers: [{ id: "tester", displayName: "Tester" }],
    scope: baseScope(),
    freshness: { assessedAt: FIXTURE_TIMESTAMP, policy: "manual" },
    contents: {
      canonical: "canonical.md",
      scope: "scope.json",
      knowledgeItems: "knowledge/items.jsonl",
      sources: "sources/index.jsonl",
      evidence: "evidence/index.jsonl",
      evaluations: "evaluations/manifest.json",
      provenance: "provenance/build.json",
      provenanceLedger: "provenance/ledger.jsonl",
      changelog: "changelog.md",
      patterns: [],
      examples: [],
      checks: [],
      attachments: [],
    },
    inventory: {
      knowledgeItems: 1,
      sources: 1,
      evidence: 1,
      checks: 0,
      evaluations: 0,
    },
    dependencies: [],
    provenance: {
      createdAt: FIXTURE_TIMESTAMP,
      createdBy: ["tester"],
      buildRunId: "run-fixture-0001",
    },
    minimumResolverVersion: "0.1.0",
    ...overrides,
  };
}

/** Files declared by {@link baseManifest}, keyed by package-relative path. */
export function baseFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set(
    "canonical.md",
    utf8("# Fixture Capsule\n\nFixture canonical content.\n"),
  );
  files.set("scope.json", utf8(`${JSON.stringify(baseScope())}\n`));
  files.set("knowledge/items.jsonl", jsonLine(baseKnowledgeItem()));
  files.set("sources/index.jsonl", jsonLine(baseSource()));
  files.set("evidence/index.jsonl", jsonLine(baseEvidence()));
  files.set(
    "evaluations/manifest.json",
    utf8(
      `${JSON.stringify({ schemaVersion: "0.1", status: "not_run", checks: [], results: [] })}\n`,
    ),
  );
  files.set(
    "provenance/build.json",
    utf8(
      `${JSON.stringify({ schemaVersion: "0.1", runId: "run-fixture-0001", createdAt: FIXTURE_TIMESTAMP })}\n`,
    ),
  );
  files.set(
    "provenance/ledger.jsonl",
    jsonLine({
      sequence: 1,
      timestamp: FIXTURE_TIMESTAMP,
      type: "research_run_started",
      actor: "tester",
    }),
  );
  files.set("changelog.md", utf8("# Changelog\n\nInitial fixture.\n"));
  return files;
}

/** Deep-clones a JSON-safe fixture object so tests never share mutable state. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function buildPackage(
  manifest: Record<string, unknown>,
  files: Map<string, Uint8Array>,
): CapsulePackage {
  const entries: CapsuleEntry[] = [
    { path: "capsule.json", bytes: utf8(`${JSON.stringify(manifest, null, 2)}\n`) },
  ];
  for (const [path, bytes] of files) entries.push({ path, bytes });
  return createCapsulePackage(entries);
}
