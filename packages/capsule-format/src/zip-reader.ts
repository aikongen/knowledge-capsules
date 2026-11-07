import { crc32, inflateRawSync } from "node:zlib";

import type { CapsuleEntry } from "./digest.ts";
import { resolveArchiveLimits, type ArchiveLimits } from "./limits.ts";
import {
  collectDuplicatePathViolations,
  collectPathViolations,
  normalizeEntryPath,
} from "./paths.ts";
import { ruleError, violation, type RuleViolation } from "./rules.ts";

/**
 * A hardened ZIP decoder.
 *
 * Every decision here treats the archive as hostile input: the central
 * directory is authoritative (a local header that disagrees is a classic ZIP
 * confusion attack), all header and limit checks run for every entry *before
 * any byte is decompressed* so a bomb is refused rather than expanded, and
 * anything the format allows but a capsule never needs — encryption, ZIP64,
 * data descriptors, unknown compression methods, extra fields with meaning —
 * is refused rather than interpreted.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const EOCD_MINIMUM_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const ZIP64_SENTINEL = 0xffffffff;
/** How far back to look for the end-of-central-directory record. */
const EOCD_SEARCH_WINDOW = 1024;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8_NAME = 0x0800;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_REGULAR_FILE = 0x8000;
const UNIX_DIRECTORY = 0x4000;
const UNIX_SYMLINK = 0xa000;
const HOST_MSDOS = 0;
const MSDOS_DIRECTORY_ATTRIBUTE = 0x10;

interface CentralRecord {
  readonly path: string;
  readonly rawName: Uint8Array;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function reject(violations: readonly RuleViolation[]): never {
  throw ruleError("archive_rejected", violations);
}

function findEndOfCentralDirectory(archive: Uint8Array): number {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const earliest = Math.max(0, archive.length - EOCD_MINIMUM_SIZE - EOCD_SEARCH_WINDOW);
  for (let offset = archive.length - EOCD_MINIMUM_SIZE; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_MINIMUM_SIZE + commentLength === archive.length) {
      return offset;
    }
  }
  return -1;
}

/**
 * Decodes an archive into capsule entries, or throws `archive_rejected` with
 * every failing rule. Never writes to disk and never trusts declared sizes.
 */
export function readZipArchive(
  archive: Uint8Array,
  overrides?: Partial<ArchiveLimits>,
): CapsuleEntry[] {
  const limits = resolveArchiveLimits(overrides);

  if (archive.length > limits.maxArchiveBytes) {
    reject([
      violation(
        "ARC-01",
        `archive is ${String(archive.length)} bytes, over the ${String(limits.maxArchiveBytes)}-byte limit`,
      ),
    ]);
  }
  if (archive.length < EOCD_MINIMUM_SIZE) {
    reject([violation("ARC-06", "archive is too short to contain a ZIP")]);
  }

  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );

  const eocd = findEndOfCentralDirectory(archive);
  if (eocd < 0) {
    reject([
      violation("ARC-06", "no end-of-central-directory record was found"),
    ]);
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    reject([violation("ARC-06", "multi-disk archives are not supported")]);
  }
  if (entryCount > limits.maxEntries) {
    reject([
      violation(
        "ARC-02",
        `archive declares ${String(entryCount)} entries, over the ${String(limits.maxEntries)} limit`,
      ),
    ]);
  }
  if (centralOffset + centralSize > eocd) {
    reject([
      violation("ARC-06", "central directory extends past its own record"),
    ]);
  }

  const violations: RuleViolation[] = [];
  const records: CentralRecord[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > centralOffset + centralSize) {
      reject([
        violation("ARC-06", "central directory is truncated"),
      ]);
    }
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) {
      reject([
        violation(
          "ARC-06",
          `central directory record ${String(index)} has a bad signature`,
        ),
      ]);
    }

    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + CENTRAL_HEADER_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > centralOffset + centralSize) {
      reject([violation("ARC-06", "central directory record is truncated")]);
    }
    const rawName = archive.subarray(nameStart, nameEnd);
    cursor = nameEnd + extraLength + commentLength;

    const at = `entry ${String(index)}`;

    if ((flags & FLAG_ENCRYPTED) !== 0 || (flags & FLAG_STRONG_ENCRYPTION) !== 0) {
      violations.push(violation("ARC-06", "entry is encrypted", at));
      continue;
    }
    if ((flags & FLAG_DATA_DESCRIPTOR) !== 0) {
      violations.push(
        violation("ARC-06", "entry uses a streaming data descriptor", at),
      );
      continue;
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      violations.push(
        violation(
          "ARC-06",
          `entry uses unsupported compression method ${String(method)}`,
          at,
        ),
      );
      continue;
    }
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL
    ) {
      violations.push(
        violation("ARC-06", "ZIP64 entries are not supported", at),
      );
      continue;
    }

    if ((flags & FLAG_UTF8_NAME) === 0 && rawName.some((byte) => byte > 0x7f)) {
      // Without the UTF-8 flag the name is CP437, and guessing an encoding is
      // how two implementations end up disagreeing about which file this is.
      violations.push(
        violation(
          "ARC-06",
          "entry name is non-ASCII without the UTF-8 name flag",
          at,
        ),
      );
      continue;
    }

    let decodedName: string;
    try {
      decodedName = strictUtf8.decode(rawName);
    } catch {
      violations.push(
        violation("ARC-06", "entry name is not valid UTF-8", at),
      );
      continue;
    }

    const path = normalizeEntryPath(decodedName);
    const pathViolations = collectPathViolations(path);

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const hostSystem = versionMadeBy >>> 8;
    if (unixMode !== 0) {
      const fileType = unixMode & UNIX_FILE_TYPE_MASK;
      if (fileType === UNIX_SYMLINK) {
        pathViolations.push(
          violation("PATH-13", `"${path}" is a symbolic link`, path),
        );
      } else if (fileType === UNIX_DIRECTORY) {
        pathViolations.push(
          violation("PATH-07", `"${path}" is a directory entry`, path),
        );
      } else if (fileType !== 0 && fileType !== UNIX_REGULAR_FILE) {
        pathViolations.push(
          violation("PATH-13", `"${path}" is not a regular file`, path),
        );
      }
    }
    if (
      hostSystem === HOST_MSDOS &&
      (externalAttributes & MSDOS_DIRECTORY_ATTRIBUTE) !== 0
    ) {
      pathViolations.push(
        violation("PATH-07", `"${path}" is a directory entry`, path),
      );
    }

    if (uncompressedSize > limits.maxEntryBytes) {
      pathViolations.push(
        violation(
          "ARC-03",
          `"${path}" declares ${String(uncompressedSize)} uncompressed bytes, over the ${String(limits.maxEntryBytes)}-byte limit`,
          path,
        ),
      );
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      pathViolations.push(
        violation("ARC-06", `"${path}" declares content with no data`, path),
      );
    } else if (
      compressedSize > 0 &&
      uncompressedSize / compressedSize > limits.maxCompressionRatio
    ) {
      pathViolations.push(
        violation(
          "ARC-05",
          `"${path}" expands ${(uncompressedSize / compressedSize).toFixed(1)}×, over the ${String(limits.maxCompressionRatio)}× limit`,
          path,
        ),
      );
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      pathViolations.push(
        violation(
          "ARC-04",
          `archive expands past the ${String(limits.maxTotalBytes)}-byte total limit`,
          path,
        ),
      );
    }

    if (pathViolations.length > 0) {
      violations.push(...pathViolations);
      continue;
    }

    records.push({
      path,
      rawName,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
  }

  violations.push(
    ...collectDuplicatePathViolations(records.map((record) => record.path)),
  );

  // Nothing is decompressed until every header-level rule has passed, so a
  // bomb costs a header read rather than the memory it was designed to claim.
  if (violations.length > 0) reject(violations);

  return records.map((record) => extract(archive, view, record, limits));
}

function extract(
  archive: Uint8Array,
  view: DataView,
  record: CentralRecord,
  limits: ArchiveLimits,
): CapsuleEntry {
  const { localOffset, path } = record;
  if (localOffset + LOCAL_HEADER_SIZE > archive.length) {
    reject([violation("ARC-06", `"${path}" has an out-of-range local header`, path)]);
  }
  if (view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    reject([violation("ARC-06", `"${path}" has a bad local header signature`, path)]);
  }

  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  const localNameStart = localOffset + LOCAL_HEADER_SIZE;
  const localName = archive.subarray(
    localNameStart,
    localNameStart + localNameLength,
  );

  if (
    localName.length !== record.rawName.length ||
    localName.some((byte, index) => byte !== record.rawName[index])
  ) {
    reject([
      violation(
        "ARC-08",
        `"${path}" has a local header name that differs from its central directory name`,
        path,
      ),
    ]);
  }

  const dataStart = localNameStart + localNameLength + localExtraLength;
  const dataEnd = dataStart + record.compressedSize;
  if (dataEnd > archive.length) {
    reject([violation("ARC-06", `"${path}" has truncated entry data`, path)]);
  }

  const compressed = archive.subarray(dataStart, dataEnd);
  let bytes: Uint8Array;
  if (record.method === METHOD_STORE) {
    bytes = new Uint8Array(compressed);
  } else {
    try {
      bytes = new Uint8Array(
        inflateRawSync(compressed, {
          // A lying `uncompressedSize` cannot buy more than one extra byte of
          // allocation before zlib aborts the stream.
          maxOutputLength: Math.min(
            limits.maxEntryBytes,
            record.uncompressedSize + 1,
          ),
        }),
      );
    } catch (cause) {
      throw ruleError("archive_rejected", [
        violation(
          "ARC-05",
          `"${path}" could not be decompressed within its declared size`,
          path,
        ),
      ]).withCause(cause);
    }
  }

  if (bytes.length !== record.uncompressedSize) {
    reject([
      violation(
        "ARC-06",
        `"${path}" decompressed to ${String(bytes.length)} bytes but declares ${String(record.uncompressedSize)}`,
        path,
      ),
    ]);
  }
  if (crc32(bytes) !== record.crc) {
    reject([
      violation("ARC-07", `"${path}" failed its CRC-32 check`, path),
    ]);
  }

  return { path, bytes };
}
