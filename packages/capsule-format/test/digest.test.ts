import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  computeContentDigest,
  encodeEntryRecord,
  sortCapsuleEntries,
  type CapsuleEntry,
} from "../src/digest.ts";

const encoder = new TextEncoder();

function readUint64BE(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
    offset,
    false,
  );
}

describe("encodeEntryRecord: entry record layout", () => {
  it("lays out path-length || path || byte-length || bytes as unsigned 64-bit big-endian", () => {
    const entry: CapsuleEntry = { path: "a.md", bytes: encoder.encode("hi") };
    const record = encodeEntryRecord(entry);

    expect(readUint64BE(record, 0)).toBe(4n); // "a.md" is 4 bytes
    expect(record.slice(8, 12)).toEqual(encoder.encode("a.md"));
    expect(readUint64BE(record, 12)).toBe(2n); // "hi" is 2 bytes
    expect(record.slice(20, 22)).toEqual(encoder.encode("hi"));
    expect(record.length).toBe(8 + 4 + 8 + 2);
  });

  it("big-endian encoding puts the most significant byte first, not the least", () => {
    // A path of exactly 256 bytes: 0x00000000_00000100 big-endian is
    // 00 00 00 00 00 00 01 00 — the 0x01 lands at offset 6, not offset 1.
    const path = "a".repeat(256);
    const entry: CapsuleEntry = { path, bytes: new Uint8Array() };
    const record = encodeEntryRecord(entry);
    expect(Array.from(record.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it("path-length counts UTF-8 bytes, not UTF-16 characters", () => {
    // "café" is 4 JS characters but 5 UTF-8 bytes ("é" is U+00E9, 2 bytes).
    const entry: CapsuleEntry = { path: "café", bytes: new Uint8Array() };
    const record = encodeEntryRecord(entry);
    expect("café".length).toBe(4);
    expect(readUint64BE(record, 0)).toBe(5n);
  });

  it("NFC-normalizes the path before encoding, so an NFD path hashes as its NFC twin", () => {
    const nfc = "café.md";
    const nfd = "café.md";
    const recordFromNfc = encodeEntryRecord({ path: nfc, bytes: new Uint8Array() });
    const recordFromNfd = encodeEntryRecord({ path: nfd, bytes: new Uint8Array() });
    expect(recordFromNfd).toEqual(recordFromNfc);
  });
});

describe("sortCapsuleEntries", () => {
  it("sorts ascending by UTF-8 byte value of the NFC path", () => {
    const entries: CapsuleEntry[] = [
      { path: "b.md", bytes: new Uint8Array() },
      { path: "a.md", bytes: new Uint8Array() },
      { path: "a/b.md", bytes: new Uint8Array() },
    ];
    const sorted = sortCapsuleEntries(entries).map((entry) => entry.path);
    expect(sorted).toEqual(["a.md", "a/b.md", "b.md"]);
  });
});

describe("computeContentDigest", () => {
  it("is a single SHA-256 over the concatenation of every sorted entry record", () => {
    const entries: CapsuleEntry[] = [
      { path: "b.md", bytes: encoder.encode("B") },
      { path: "a.md", bytes: encoder.encode("A") },
    ];
    const expectedBytes = new Uint8Array([
      ...encodeEntryRecord({ path: "a.md", bytes: encoder.encode("A") }),
      ...encodeEntryRecord({ path: "b.md", bytes: encoder.encode("B") }),
    ]);
    const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
    expect(computeContentDigest(entries)).toBe(`sha256:${expectedHash}`);
  });

  it("is deterministic: hashing the same package twice yields the same digest", () => {
    const entries: CapsuleEntry[] = [
      { path: "a.md", bytes: encoder.encode("content a") },
      { path: "b/c.md", bytes: encoder.encode("content c") },
    ];
    expect(computeContentDigest(entries)).toBe(computeContentDigest(entries));
  });

  it("is independent of the entry order given to the function", () => {
    const entries: CapsuleEntry[] = [
      { path: "a.md", bytes: encoder.encode("A") },
      { path: "b.md", bytes: encoder.encode("B") },
      { path: "c.md", bytes: encoder.encode("C") },
    ];
    const forward = computeContentDigest(entries);
    const reversed = computeContentDigest([...entries].reverse());
    const shuffled = computeContentDigest([entries[1]!, entries[2]!, entries[0]!]);
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it("is sensitive to a single flipped byte in any entry", () => {
    const original: CapsuleEntry[] = [{ path: "a.md", bytes: encoder.encode("hello") }];
    const flipped: CapsuleEntry[] = [
      { path: "a.md", bytes: encoder.encode("hellp") },
    ];
    expect(computeContentDigest(flipped)).not.toBe(computeContentDigest(original));
  });

  it("is sensitive to renaming an entry", () => {
    const original: CapsuleEntry[] = [{ path: "a.md", bytes: encoder.encode("hello") }];
    const renamed: CapsuleEntry[] = [{ path: "z.md", bytes: encoder.encode("hello") }];
    expect(computeContentDigest(renamed)).not.toBe(computeContentDigest(original));
  });

  it("normalizes paths to NFC before sorting and hashing, so NFC/NFD twins digest identically", () => {
    const nfc: CapsuleEntry = { path: "café.md", bytes: encoder.encode("x") };
    const nfd: CapsuleEntry = { path: "café.md", bytes: encoder.encode("x") };
    expect(computeContentDigest([nfc])).toBe(computeContentDigest([nfd]));
  });
});
