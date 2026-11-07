import { crc32, deflateRawSync } from "node:zlib";

import { sortCapsuleEntries, type CapsuleEntry } from "./digest.ts";
import { normalizeEntryPath } from "./paths.ts";

/**
 * A ZIP encoder written here rather than taken from npm.
 *
 * The archive parameters in `CAPSULE_FORMAT.md` — fixed 1980 DOS timestamp,
 * `version-made-by` 0x031E, external attributes 0o100644, UTF-8 name flag, no
 * extra fields — are precisely the fields general-purpose ZIP libraries either
 * derive from the host or expose inconsistently, so adopting one would mean
 * fighting it for byte-exact output on the most security-sensitive path in the
 * kernel. Only compression is delegated, to Node's bundled zlib.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** `1980-01-01T00:00:00` in MS-DOS date/time encoding. */
export const FIXED_DOS_DATE = 0x0021;
export const FIXED_DOS_TIME = 0x0000;

/** UNIX host, ZIP specification 3.0. */
export const VERSION_MADE_BY = 0x031e;
export const VERSION_NEEDED = 20;
/** Bit 11: entry name is UTF-8. */
export const UTF8_NAME_FLAG = 0x0800;
export const DEFLATE_METHOD = 8;
/** Regular file, 0644, in the high 16 bits as UNIX ZIP writers encode it. */
export const EXTERNAL_ATTRIBUTES = 0o100644 << 16;

class ByteWriter {
  #chunks: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  bytes(value: Uint8Array): void {
    this.#chunks.push(value);
    this.#length += value.length;
  }

  u16(value: number): void {
    const buffer = new Uint8Array(2);
    new DataView(buffer.buffer).setUint16(0, value, true);
    this.bytes(buffer);
  }

  u32(value: number): void {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setUint32(0, value >>> 0, true);
    this.bytes(buffer);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

interface PreparedEntry {
  readonly name: Uint8Array;
  readonly crc: number;
  readonly uncompressedSize: number;
  readonly compressed: Uint8Array;
  readonly localOffset: number;
}

/**
 * A deterministic `.kcap` archive.
 *
 * The archive-byte digest is not capsule identity, but it is release evidence,
 * so packing the same entry set twice must produce identical bytes. Everything
 * that would otherwise vary — mtime, host OS, entry order, permissions — is
 * pinned above.
 */
export function writeDeterministicZip(
  entries: Iterable<CapsuleEntry>,
): Uint8Array {
  const encoder = new TextEncoder();
  const body = new ByteWriter();
  const prepared: PreparedEntry[] = [];

  for (const entry of sortCapsuleEntries(entries)) {
    const name = encoder.encode(normalizeEntryPath(entry.path));
    const compressed = new Uint8Array(
      deflateRawSync(entry.bytes, { level: 9 }),
    );
    const localOffset = body.length;

    body.u32(LOCAL_HEADER_SIGNATURE);
    body.u16(VERSION_NEEDED);
    body.u16(UTF8_NAME_FLAG);
    body.u16(DEFLATE_METHOD);
    body.u16(FIXED_DOS_TIME);
    body.u16(FIXED_DOS_DATE);
    const crc = crc32(entry.bytes);
    body.u32(crc);
    body.u32(compressed.length);
    body.u32(entry.bytes.length);
    body.u16(name.length);
    body.u16(0);
    body.bytes(name);
    body.bytes(compressed);

    prepared.push({
      name,
      crc,
      uncompressedSize: entry.bytes.length,
      compressed,
      localOffset,
    });
  }

  const centralDirectory = new ByteWriter();
  for (const entry of prepared) {
    centralDirectory.u32(CENTRAL_HEADER_SIGNATURE);
    centralDirectory.u16(VERSION_MADE_BY);
    centralDirectory.u16(VERSION_NEEDED);
    centralDirectory.u16(UTF8_NAME_FLAG);
    centralDirectory.u16(DEFLATE_METHOD);
    centralDirectory.u16(FIXED_DOS_TIME);
    centralDirectory.u16(FIXED_DOS_DATE);
    centralDirectory.u32(entry.crc);
    centralDirectory.u32(entry.compressed.length);
    centralDirectory.u32(entry.uncompressedSize);
    centralDirectory.u16(entry.name.length);
    centralDirectory.u16(0);
    centralDirectory.u16(0);
    centralDirectory.u16(0);
    centralDirectory.u16(0);
    centralDirectory.u32(EXTERNAL_ATTRIBUTES);
    centralDirectory.u32(entry.localOffset);
    centralDirectory.bytes(entry.name);
  }

  const out = new ByteWriter();
  out.bytes(body.concat());
  const centralOffset = out.length;
  out.bytes(centralDirectory.concat());
  out.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  out.u16(0);
  out.u16(0);
  out.u16(prepared.length);
  out.u16(prepared.length);
  out.u32(centralDirectory.length);
  out.u32(centralOffset);
  out.u16(0);
  return out.concat();
}
