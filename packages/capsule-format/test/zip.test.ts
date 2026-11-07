import { describe, expect, it } from "bun:test";

import { computeContentDigest, type CapsuleEntry } from "../src/digest.ts";
import { readZipArchive } from "../src/zip-reader.ts";
import {
  EXTERNAL_ATTRIBUTES,
  FIXED_DOS_DATE,
  FIXED_DOS_TIME,
  UTF8_NAME_FLAG,
  VERSION_MADE_BY,
  writeDeterministicZip,
} from "../src/zip-writer.ts";
import { KcError } from "@kc/contracts";

const encoder = new TextEncoder();

function entry(path: string, text: string): CapsuleEntry {
  return { path, bytes: encoder.encode(text) };
}

/**
 * A hand-rolled reader for exactly what the tests need to check on the
 * writer's raw bytes: local-header fields (all entries share the fixed DOS
 * timestamp and UTF-8 flag) and central-directory fields (version-made-by,
 * external attributes). Deliberately independent of `zip-reader.ts` so this
 * is checking the writer's output against `CAPSULE_FORMAT.md`, not against
 * the reader's own assumptions.
 */
function parseCentralDirectory(archive: Uint8Array): {
  versionMadeBy: number;
  utf8Flag: boolean;
  dosTime: number;
  dosDate: number;
  externalAttributes: number;
  name: string;
}[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = archive.length - 22;
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  const records = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const dosTime = view.getUint16(cursor + 12, true);
    const dosDate = view.getUint16(cursor + 14, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const nameStart = cursor + 46;
    const name = new TextDecoder().decode(
      archive.subarray(nameStart, nameStart + nameLength),
    );
    records.push({
      versionMadeBy,
      utf8Flag: (flags & 0x0800) !== 0,
      dosTime,
      dosDate,
      externalAttributes,
      name,
    });
    cursor = nameStart + nameLength;
  }
  return records;
}

describe("writeDeterministicZip: determinism", () => {
  it("packing the same entries twice produces byte-identical archives", () => {
    const entries = [entry("a.md", "content a"), entry("b/c.md", "content c")];
    const first = writeDeterministicZip(entries);
    const second = writeDeterministicZip(entries);
    expect(second).toEqual(first);
  });

  it("is independent of the order entries are given in, since the writer sorts internally", () => {
    const entries = [entry("z.md", "z"), entry("a.md", "a")];
    const forward = writeDeterministicZip(entries);
    const reversed = writeDeterministicZip([...entries].reverse());
    expect(reversed).toEqual(forward);
  });
});

describe("writeDeterministicZip: fixed archive parameters", () => {
  it("uses the 1980-01-01 DOS date/time for every entry", () => {
    const archive = writeDeterministicZip([
      entry("a.md", "a"),
      entry("b.md", "b"),
    ]);
    for (const record of parseCentralDirectory(archive)) {
      expect(record.dosTime).toBe(FIXED_DOS_TIME);
      expect(record.dosDate).toBe(FIXED_DOS_DATE);
    }
  });

  it("sets version-made-by to UNIX/ZIP 3.0 (0x031E) for every entry", () => {
    const archive = writeDeterministicZip([entry("a.md", "a")]);
    expect(parseCentralDirectory(archive)[0]?.versionMadeBy).toBe(
      VERSION_MADE_BY,
    );
  });

  it("sets external attributes to regular file, 0644 for every entry", () => {
    const archive = writeDeterministicZip([entry("a.md", "a")]);
    // EXTERNAL_ATTRIBUTES is `0o100644 << 16`, which JS's `<<` returns as a
    // signed 32-bit integer; the archive field itself is unsigned, and
    // DataView.getUint32 reads it back that way, so both sides need the same
    // unsigned interpretation to compare the same bit pattern.
    expect(parseCentralDirectory(archive)[0]?.externalAttributes).toBe(
      EXTERNAL_ATTRIBUTES >>> 0,
    );
  });

  it("sets the UTF-8 name flag (bit 11) for every entry", () => {
    const archive = writeDeterministicZip([entry("café.md", "a")]);
    expect(parseCentralDirectory(archive)[0]?.utf8Flag).toBe(true);
    expect(UTF8_NAME_FLAG & 0x0800).toBe(0x0800);
  });
});

describe("round trip: pack, read back, recompute digest", () => {
  it("readZipArchive recovers exactly the packed entries", () => {
    const entries = [entry("a.md", "content a"), entry("b/c.md", "content c")];
    const archive = writeDeterministicZip(entries);
    const readBack = readZipArchive(archive);
    const byPath = new Map(readBack.map((e) => [e.path, e.bytes]));
    expect(byPath.size).toBe(2);
    expect(new TextDecoder().decode(byPath.get("a.md"))).toBe("content a");
    expect(new TextDecoder().decode(byPath.get("b/c.md"))).toBe("content c");
  });

  it("the digest recomputed after a round trip equals the original digest", () => {
    const entries = [
      entry("a.md", "content a"),
      entry("b/c.md", "content c"),
      entry("z.md", "content z"),
    ];
    const originalDigest = computeContentDigest(entries);
    const archive = writeDeterministicZip(entries);
    const readBack = readZipArchive(archive);
    expect(computeContentDigest(readBack)).toBe(originalDigest);
  });

  it("round-trips an empty (zero-byte) entry", () => {
    const entries = [entry("empty.md", "")];
    const archive = writeDeterministicZip(entries);
    const readBack = readZipArchive(archive);
    expect(readBack[0]?.bytes.length).toBe(0);
  });
});

describe("readZipArchive: hostile inputs and enforced limits", () => {
  it("ARC-01: rejects an archive over the configured byte-size limit", () => {
    const archive = writeDeterministicZip([entry("a.md", "some content")]);
    expect(() => readZipArchive(archive, { maxArchiveBytes: 4 })).toThrow(
      KcError,
    );
    try {
      readZipArchive(archive, { maxArchiveBytes: 4 });
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.code).toBe("archive_rejected");
      expect(kcError.details.some((d) => d.rule === "ARC-01")).toBe(true);
    }
  });

  it("ARC-02: rejects an archive with more entries than the configured cap", () => {
    const archive = writeDeterministicZip([
      entry("a.md", "a"),
      entry("b.md", "b"),
      entry("c.md", "c"),
    ]);
    try {
      readZipArchive(archive, { maxEntries: 2 });
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-02")).toBe(true);
    }
  });

  it("ARC-03: rejects a single entry over the per-entry size cap", () => {
    const archive = writeDeterministicZip([entry("a.md", "x".repeat(1000))]);
    try {
      readZipArchive(archive, { maxEntryBytes: 100 });
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-03")).toBe(true);
    }
  });

  it("ARC-05: rejects an entry whose compression ratio exceeds the configured cap (decompression bomb)", () => {
    // Highly repetitive content compresses far better than the default 200x
    // ceiling; a small override lets the test exercise the rule cheaply
    // instead of constructing an actual multi-hundred-times bomb.
    const archive = writeDeterministicZip([
      entry("bomb.md", "0".repeat(1_000_000)),
    ]);
    try {
      readZipArchive(archive, { maxCompressionRatio: 5 });
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-05")).toBe(true);
    }
  });

  it("ARC-06: rejects an archive too short to contain a valid end-of-central-directory record", () => {
    const truncated = new Uint8Array([1, 2, 3, 4]);
    try {
      readZipArchive(truncated);
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-06")).toBe(true);
    }
  });

  it("ARC-07: rejects an entry whose decompressed bytes fail their declared CRC-32", () => {
    const archive = writeDeterministicZip([entry("a.md", "original content")]);
    // Corrupt the CRC-32 field in the *central directory* record only (the
    // one `extract()` actually checks against — the local header's copy is
    // read solely for the ARC-08 name comparison). The compressed payload is
    // left untouched, so decompression succeeds and only the CRC check
    // fails, isolating ARC-07 from the decompression-failure path.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const centralOffset = view.getUint32(archive.length - 22 + 16, true);
    const corrupted = new Uint8Array(archive);
    const crcFieldStart = centralOffset + 16;
    corrupted[crcFieldStart] = (corrupted[crcFieldStart]! ^ 0xff) as number;
    try {
      readZipArchive(corrupted);
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-07")).toBe(true);
    }
  });

  it("a flipped byte inside the compressed payload breaks the deflate stream itself (ARC-05), not just the CRC", () => {
    // Documents actual, observed behavior on this reader: for a short input,
    // corrupting the compressed bytes (rather than only the declared CRC)
    // almost always breaks the deflate bitstream's structure before CRC is
    // ever checked, so the failure surfaces as ARC-05 ("could not be
    // decompressed"), not ARC-07. Both are legitimate rejections of the same
    // corrupted archive; which one fires depends on where the corruption
    // lands, not on a choice this test makes.
    const archive = writeDeterministicZip([entry("a.md", "original content")]);
    const corrupted = new Uint8Array(archive);
    const payloadStart = 30 + 4;
    corrupted[payloadStart] = (corrupted[payloadStart]! ^ 0xff) as number;
    try {
      readZipArchive(corrupted);
      expect.unreachable();
    } catch (error) {
      const kcError = error as KcError;
      expect(kcError.details.some((d) => d.rule === "ARC-05")).toBe(true);
    }
  });
});
