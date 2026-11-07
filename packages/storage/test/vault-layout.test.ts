import { describe, expect, it } from "bun:test";

import {
  isSafePathSegment,
  resolveArtifactRunDir,
  resolveCapsuleDraftDir,
  resolveCapsuleVersionDir,
  resolveSourceDir,
  vaultLayout,
} from "../src/vault-layout.ts";

const ROOT = "/tmp/example-vault";

describe("vaultLayout", () => {
  it("derives the canonical tree from ARCHITECTURE.md", () => {
    const layout = vaultLayout(ROOT);
    expect(layout.capsulesDir).toBe("/tmp/example-vault/capsules");
    expect(layout.sourcesDir).toBe("/tmp/example-vault/sources");
    expect(layout.artifactsDir).toBe("/tmp/example-vault/artifacts");
    expect(layout.exportsDir).toBe("/tmp/example-vault/exports");
    expect(layout.databasePath).toBe("/tmp/example-vault/database.sqlite");
    expect(layout.vaultManifestPath).toBe("/tmp/example-vault/vault.json");
    expect(layout.runtimeDir).toBe("/tmp/example-vault/runtime");
    expect(layout.runtimeLeaseDatabasePath).toBe("/tmp/example-vault/runtime/lease.sqlite");
  });
});

const TRAVERSAL_CASES: ReadonlyArray<[string, string]> = [
  ["..", ".."],
  ["a/../..", "a/../.."],
  ["/etc/passwd", "/etc/passwd"],
  ["a/b", "a/b"],
  ["", ""],
  ["%2e%2e", "%2e%2e"],
  ["..%2f..", "..%2f.."],
];

describe("resolveCapsuleDraftDir: identifier validation", () => {
  it("accepts a legitimate namespace/slug/draftId", () => {
    const layout = vaultLayout(ROOT);
    const result = resolveCapsuleDraftDir(layout, "acme", "checkout-flow", "draft-01");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(
        "/tmp/example-vault/capsules/acme/checkout-flow/drafts/draft-01",
      );
    }
  });

  it.each(TRAVERSAL_CASES)("rejects a slug of %j", (_label, malicious) => {
    const layout = vaultLayout(ROOT);
    const result = resolveCapsuleDraftDir(layout, "acme", malicious, "draft-01");
    expect(result.ok).toBe(false);
  });

  it.each(TRAVERSAL_CASES)("rejects a namespace of %j", (_label, malicious) => {
    const layout = vaultLayout(ROOT);
    const result = resolveCapsuleDraftDir(layout, malicious, "checkout-flow", "draft-01");
    expect(result.ok).toBe(false);
  });

  it.each(TRAVERSAL_CASES)("rejects a draftId of %j", (_label, malicious) => {
    const layout = vaultLayout(ROOT);
    const result = resolveCapsuleDraftDir(layout, "acme", "checkout-flow", malicious);
    expect(result.ok).toBe(false);
  });
});

describe("resolveSourceDir / resolveArtifactRunDir: identifier validation", () => {
  it("accepts legitimate opaque ids", () => {
    const layout = vaultLayout(ROOT);
    expect(resolveSourceDir(layout, "src-01").ok).toBe(true);
    expect(resolveArtifactRunDir(layout, "run-01").ok).toBe(true);
  });

  it.each(TRAVERSAL_CASES)("rejects a sourceId of %j", (_label, malicious) => {
    const layout = vaultLayout(ROOT);
    expect(resolveSourceDir(layout, malicious).ok).toBe(false);
  });

  it.each(TRAVERSAL_CASES)("rejects a runId of %j", (_label, malicious) => {
    const layout = vaultLayout(ROOT);
    expect(resolveArtifactRunDir(layout, malicious).ok).toBe(false);
  });
});

describe("resolveCapsuleVersionDir", () => {
  it("uses the digest hex payload, never the sha256: prefixed form, as the folder name", () => {
    const layout = vaultLayout(ROOT);
    const digest = `sha256:${"a".repeat(64)}`;
    const result = resolveCapsuleVersionDir(layout, "acme", "checkout-flow", "1.2.3", digest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(
        `/tmp/example-vault/capsules/acme/checkout-flow/versions/1.2.3/${"a".repeat(64)}`,
      );
      expect(result.value.includes(":")).toBe(false);
    }
  });

  it("rejects a malformed semver", () => {
    const layout = vaultLayout(ROOT);
    const digest = `sha256:${"a".repeat(64)}`;
    const result = resolveCapsuleVersionDir(layout, "acme", "checkout-flow", "not-a-version", digest);
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed digest", () => {
    const layout = vaultLayout(ROOT);
    const result = resolveCapsuleVersionDir(layout, "acme", "checkout-flow", "1.2.3", "not-a-digest");
    expect(result.ok).toBe(false);
  });
});

describe("isSafePathSegment", () => {
  it("accepts an ordinary identifier", () => {
    expect(isSafePathSegment("draft-01")).toBe(true);
  });

  it.each(TRAVERSAL_CASES)("rejects %j", (_label, malicious) => {
    expect(isSafePathSegment(malicious)).toBe(false);
  });
});
