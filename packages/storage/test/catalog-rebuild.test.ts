import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createCapsulePackage, validateCapsulePackage, type CapsulePackage } from "@kc/capsule-format";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { rebuildCatalogFromCanonicalVault } from "../src/catalog-rebuild.ts";
import { openSqliteStorage } from "../src/sqlite.ts";

let workDir: string;

const fixtureDir = fileURLToPath(new URL("../../../fixtures/example-capsule/", import.meta.url));

async function packageFromDirectory(directory: string): Promise<CapsulePackage> {
  const entries: { readonly path: string; readonly bytes: Uint8Array }[] = [];
  async function visit(current: string): Promise<void> {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const path = join(current, child.name);
      if (child.isDirectory()) {
        await visit(path);
      } else if (child.isFile()) {
        entries.push({
          path: relative(directory, path).split(sep).join("/"),
          bytes: await readFile(path),
        });
      }
    }
  }
  await visit(directory);
  return createCapsulePackage(entries);
}

async function writePublishedFixture(directory: string, version: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  await cp(fixtureDir, directory, { recursive: true });
  const manifestPath = join(directory, "capsule.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest["version"] = version;
  manifest["status"] = "published";
  manifest["publishedAt"] = "2026-09-01T12:00:00Z";
  manifest["digest"] = `sha256:${"0".repeat(64)}`;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const digest = validateCapsulePackage(await packageFromDirectory(directory), {
    minimumVerifiedEvidencePerMaterialItem: 1,
  }).digest;
  manifest["digest"] = digest;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return digest;
}

function options() {
  return {
    validationPolicyFor: ({ profileId, profileVersion }: { profileId: string; profileVersion: string }) =>
      profileId === "software-engineering" && profileVersion === "0.1.0"
        ? { profileId, profileVersion, minimumVerifiedEvidencePerMaterialItem: 1 }
        : undefined,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kc-catalog-rebuild-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const examplesDir = fileURLToPath(new URL("../../../examples/", import.meta.url));

describe("rebuildCatalogFromCanonicalVault", () => {
  it("indexes a core-only guidelines capsule without a profile, items or freshness", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftRoot = join(vaultRoot, "capsules", "aikongen", "design-guidelines", "drafts", "d1");
    await mkdir(draftRoot, { recursive: true });
    await cp(join(examplesDir, "design-guidelines"), draftRoot, { recursive: true });
    const manifestPath = join(draftRoot, "capsule.json");
    const draft = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    draft["status"] = "draft";
    delete draft["digest"];
    delete draft["publishedAt"];
    await writeFile(manifestPath, `${JSON.stringify(draft)}\n`);
    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, {
          validationPolicyFor: () => undefined,
        }),
      ).resolves.toMatchObject({ entries: 1, items: 0 });
    } finally {
      storage.close();
    }
  });

  it("treats a package entry named registry.json as content, not lifecycle authority", async () => {
    const vaultRoot = join(workDir, "vault");
    const draftRoot = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "drafts",
      "draft-with-registry-attachment",
    );
    await mkdir(draftRoot, { recursive: true });
    await cp(fixtureDir, draftRoot, { recursive: true });
    const manifestPath = join(draftRoot, "capsule.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const contents = manifest["contents"] as Record<string, unknown>;
    contents["attachments"] = ["attachments/registry.json"];
    await mkdir(join(draftRoot, "attachments"));
    await writeFile(
      join(draftRoot, "attachments", "registry.json"),
      `${JSON.stringify({ kind: "example-content" })}\n`,
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));

    try {
      await expect(
        rebuildCatalogFromCanonicalVault(storage, vaultRoot, options()),
      ).resolves.toMatchObject({ entries: 1, orphanedVersionPaths: [] });
    } finally {
      storage.close();
    }
  });

  it("projects registered lifecycle status without rewriting immutable manifests and reports orphaned versions", async () => {
    const vaultRoot = join(workDir, "vault");
    const capsuleRoot = join(vaultRoot, "capsules", "engineering", "electron-local-baseline-fixture");
    const firstPath = join(capsuleRoot, "versions", "1.0.0", "placeholder");
    const firstDigest = await writePublishedFixture(firstPath, "1.0.0");
    const firstDirectory = join(capsuleRoot, "versions", "1.0.0", firstDigest.slice("sha256:".length));
    await mkdir(join(capsuleRoot, "versions", "1.0.0"), { recursive: true });
    await cp(firstPath, firstDirectory, { recursive: true });
    await rm(firstPath, { recursive: true });

    const secondPath = join(capsuleRoot, "versions", "1.1.0", "placeholder");
    const secondDigest = await writePublishedFixture(secondPath, "1.1.0");
    const secondDirectory = join(capsuleRoot, "versions", "1.1.0", secondDigest.slice("sha256:".length));
    await mkdir(join(capsuleRoot, "versions", "1.1.0"), { recursive: true });
    await cp(secondPath, secondDirectory, { recursive: true });
    await rm(secondPath, { recursive: true });

    await writeFile(
      join(capsuleRoot, "registry.json"),
      `${JSON.stringify({
        schemaVersion: "0.1",
        capsuleId: "engineering/electron-local-baseline-fixture",
        revision: 1,
        versions: [
          {
            version: "1.0.0",
            digest: firstDigest,
            status: "superseded",
            publishedAt: "2026-09-01T12:00:00Z",
          },
        ],
      })}\n`,
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      const rebuilt = await rebuildCatalogFromCanonicalVault(storage, vaultRoot, options());

      expect(rebuilt).toMatchObject({
        entries: 1,
        orphanedVersionPaths: [
          `capsules/engineering/electron-local-baseline-fixture/versions/1.1.0/${secondDigest.slice("sha256:".length)}`,
        ],
      });
      expect(await readFile(join(firstDirectory, "capsule.json"), "utf8")).toContain('"status":"published"');
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

  it("fails closed when a registry entry lacks matching immutable version bytes", async () => {
    const vaultRoot = join(workDir, "vault");
    const capsuleRoot = join(vaultRoot, "capsules", "engineering", "missing-version");
    await mkdir(capsuleRoot, { recursive: true });
    await writeFile(
      join(capsuleRoot, "registry.json"),
      `${JSON.stringify({
        schemaVersion: "0.1",
        capsuleId: "engineering/missing-version",
        revision: 1,
        versions: [
          {
            version: "1.0.0",
            digest: `sha256:${"a".repeat(64)}`,
            status: "published",
            publishedAt: "2026-09-01T12:00:00Z",
          },
        ],
      })}\n`,
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(rebuildCatalogFromCanonicalVault(storage, vaultRoot, options())).rejects.toMatchObject({
        code: "conflict",
      });
    } finally {
      storage.close();
    }
  });

  it("fails closed when registry publication metadata drifts from immutable package bytes", async () => {
    const vaultRoot = join(workDir, "vault");
    const capsuleRoot = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
    );
    const provisional = join(capsuleRoot, "versions", "1.0.0", "placeholder");
    const digest = await writePublishedFixture(provisional, "1.0.0");
    const publishedDirectory = join(
      capsuleRoot,
      "versions",
      "1.0.0",
      digest.slice("sha256:".length),
    );
    await mkdir(join(capsuleRoot, "versions", "1.0.0"), { recursive: true });
    await cp(provisional, publishedDirectory, { recursive: true });
    await rm(provisional, { recursive: true });
    await writeFile(
      join(capsuleRoot, "registry.json"),
      `${JSON.stringify({
        schemaVersion: "0.1",
        capsuleId: "engineering/electron-local-baseline-fixture",
        revision: 1,
        versions: [
          {
            version: "1.0.0",
            digest,
            status: "published",
            publishedAt: "2026-09-01T12:00:01Z",
          },
        ],
      })}\n`,
    );

    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(rebuildCatalogFromCanonicalVault(storage, vaultRoot, options())).rejects.toMatchObject({
        code: "conflict",
        details: [expect.objectContaining({ message: expect.stringContaining("publishedAt") })],
      });
    } finally {
      storage.close();
    }
  });

  it("fails closed and preserves a complete version staging residue for explicit recovery", async () => {
    const vaultRoot = join(workDir, "vault");
    const stage = join(
      vaultRoot,
      "capsules",
      "engineering",
      "electron-local-baseline-fixture",
      "versions",
      "1.0.0",
      ".kc-tmp-complete",
    );
    await writePublishedFixture(stage, "1.0.0");
    const storage = openSqliteStorage(join(vaultRoot, "database.sqlite"));
    try {
      await expect(rebuildCatalogFromCanonicalVault(storage, vaultRoot, options())).rejects.toMatchObject({
        code: "validation_failed",
      });
      await expect(readFile(join(stage, "capsule.json"), "utf8")).resolves.toContain('"status":"published"');
    } finally {
      storage.close();
    }
  });
});
