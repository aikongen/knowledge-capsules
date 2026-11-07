import { createHash } from "node:crypto";

import { compareUtf8, normalizeEntryPath } from "./paths.ts";

/** One file in a capsule: a package-relative NFC path and its exact bytes. */
export interface CapsuleEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const encoder = new TextEncoder();

function uint64BigEndian(value: number): Uint8Array {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), false);
  return buffer;
}

/**
 * Everything in an entry record except the payload:
 * `path-length || path || byte-length`, both lengths unsigned 64-bit
 * big-endian. `path-length` counts *bytes*, so "café" is 5 and not 4.
 *
 * Split out so the digest can stream an entry's bytes straight into the hash
 * without first materialising a copy of a possibly large attachment.
 */
function encodeEntryHeader(path: Uint8Array, byteLength: number): Uint8Array {
  const header = new Uint8Array(8 + path.length + 8);
  header.set(uint64BigEndian(path.length), 0);
  header.set(path, 8);
  header.set(uint64BigEndian(byteLength), 8 + path.length);
  return header;
}

/**
 * `path-length || path || byte-length || bytes`.
 *
 * `computeContentDigest` hashes exactly this, header then payload, so a test
 * that pins this layout is pinning what the digest actually consumes. An
 * encoder the digest did not use would let the two drift and make such a test
 * prove nothing.
 */
export function encodeEntryRecord(entry: CapsuleEntry): Uint8Array {
  const path = encoder.encode(normalizeEntryPath(entry.path));
  const header = encodeEntryHeader(path, entry.bytes.length);
  const record = new Uint8Array(header.length + entry.bytes.length);
  record.set(header, 0);
  record.set(entry.bytes, header.length);
  return record;
}

/** Ascending by unsigned UTF-8 byte value of the NFC path. */
export function sortCapsuleEntries(
  entries: Iterable<CapsuleEntry>,
): CapsuleEntry[] {
  return [...entries].sort((left, right) =>
    compareUtf8(normalizeEntryPath(left.path), normalizeEntryPath(right.path)),
  );
}

/**
 * A single SHA-256 over the concatenation of every entry record, in path order.
 * No per-entry intermediate digest and no Merkle construction, so a verifier
 * that hashes the stream in one pass and one that streams it piecewise agree.
 */
export function computeContentDigest(
  entries: Iterable<CapsuleEntry>,
): string {
  const hash = createHash("sha256");
  for (const entry of sortCapsuleEntries(entries)) {
    const path = encoder.encode(normalizeEntryPath(entry.path));
    hash.update(encodeEntryHeader(path, entry.bytes.length));
    hash.update(entry.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
