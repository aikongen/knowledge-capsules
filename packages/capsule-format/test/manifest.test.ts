import { describe, expect, it } from "bun:test";

import {
  UNHASHED_MANIFEST_KEYS,
  canonicalEntrySet,
  declaredContentPaths,
  hashedManifestValue,
  manifestEntryBytes,
  type CapsuleManifest,
} from "../src/manifest.ts";
import { computeContentDigest } from "../src/digest.ts";
import { baseManifest, clone } from "./support/fixtures.ts";

function asManifest(value: Record<string, unknown>): CapsuleManifest {
  return value as unknown as CapsuleManifest;
}

describe("hashedManifestValue: omitted keys", () => {
  it("omits status, digest, and signatures as absent keys, not null or empty", () => {
    const manifest = asManifest({
      ...baseManifest({ status: "published" }),
      digest: `sha256:${"a".repeat(64)}`,
      signatures: [{ algorithm: "ed25519", keyId: "k1", signature: "s1" }],
    });
    const hashed = hashedManifestValue(manifest);

    for (const key of UNHASHED_MANIFEST_KEYS) {
      expect(Object.hasOwn(hashed, key)).toBe(false);
    }
  });

  it("the omission is a real key deletion, not a null/undefined value (JCS distinguishes the two)", () => {
    const manifest = asManifest(baseManifest());
    const hashed = hashedManifestValue(manifest);
    const bytes = manifestEntryBytes(manifest);
    const text = new TextDecoder().decode(bytes);
    // If `status` were hashed as null/undefined instead of omitted, the
    // canonical text would contain the substring "status" somewhere.
    expect(text.includes('"status"')).toBe(false);
    expect(Object.hasOwn(hashed, "status")).toBe(false);
  });
});

describe("manifestEntryBytes: the digest does not change when status changes", () => {
  it("produces the same content digest for draft, published, and superseded status", () => {
    const draft = asManifest(baseManifest({ status: "draft" }));
    const published = asManifest(baseManifest({ status: "published" }));
    const superseded = asManifest(baseManifest({ status: "superseded" }));

    const digestFor = (manifest: CapsuleManifest): string =>
      computeContentDigest([
        { path: "capsule.json", bytes: manifestEntryBytes(manifest) },
      ]);

    const draftDigest = digestFor(draft);
    expect(digestFor(published)).toBe(draftDigest);
    expect(digestFor(superseded)).toBe(draftDigest);
  });

  it("changing only status on an otherwise-identical manifest object is a byte-identical hashed value", () => {
    const manifest = clone(baseManifest({ status: "published" })) as Record<
      string,
      unknown
    >;
    const before = manifestEntryBytes(asManifest(manifest));
    manifest.status = "superseded";
    const after = manifestEntryBytes(asManifest(manifest));
    expect(after).toEqual(before);
  });
});

describe("manifestEntryBytes: canonical fields still change the digest", () => {
  it("changes when the title changes", () => {
    const a = manifestEntryBytes(asManifest(baseManifest({ title: "Original Title" })));
    const b = manifestEntryBytes(asManifest(baseManifest({ title: "Different Title" })));
    expect(a).not.toEqual(b);
  });

  it("changes when scope changes", () => {
    const a = manifestEntryBytes(asManifest(baseManifest()));
    const b = manifestEntryBytes(
      asManifest(
        baseManifest({
          scope: { includes: ["different"], excludes: [], assumptions: [] },
        }),
      ),
    );
    expect(a).not.toEqual(b);
  });

  it("changes when an item in contents changes", () => {
    const base = baseManifest();
    const a = manifestEntryBytes(asManifest(base));
    const withDifferentContents = clone(base) as Record<string, unknown>;
    (withDifferentContents.contents as Record<string, unknown>).changelog =
      "changelog-v2.md";
    const b = manifestEntryBytes(asManifest(withDifferentContents));
    expect(a).not.toEqual(b);
  });
});

describe("declaredContentPaths / canonicalEntrySet", () => {
  it("includes every single-value content path plus every list entry", () => {
    const manifest = asManifest(
      baseManifest({
        contents: {
          canonical: "canonical.md",
          scope: "scope.json",
          knowledgeItems: "knowledge/items.jsonl",
          sources: "sources/index.jsonl",
          evidence: "evidence/index.jsonl",
          provenance: "provenance/build.json",
          changelog: "changelog.md",
          patterns: ["patterns/a.md", "patterns/b.md"],
          examples: [],
          checks: ["checks/c.md"],
          attachments: [],
        },
      }),
    );
    const paths = declaredContentPaths(manifest);
    expect(paths).toEqual([
      "canonical.md",
      "scope.json",
      "knowledge/items.jsonl",
      "sources/index.jsonl",
      "evidence/index.jsonl",
      "provenance/build.json",
      "changelog.md",
      "patterns/a.md",
      "patterns/b.md",
      "checks/c.md",
    ]);
  });

  it("canonicalEntrySet always includes capsule.json plus declared paths", () => {
    const manifest = asManifest(baseManifest());
    const set = canonicalEntrySet(manifest);
    expect(set.has("capsule.json")).toBe(true);
    for (const path of declaredContentPaths(manifest)) {
      expect(set.has(path)).toBe(true);
    }
  });

  it("NFC-normalizes declared paths", () => {
    const contents = baseManifest().contents as Record<string, unknown>;
    const manifest = asManifest(
      baseManifest({
        contents: { ...contents, changelog: "cafe\u{301}.md" },
      }),
    );
    const paths = declaredContentPaths(manifest);
    expect(paths).toContain("caf\u{e9}.md");
  });
});
