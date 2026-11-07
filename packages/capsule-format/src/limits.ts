/**
 * "Archive size, entry count, and per-entry limits are enforced during import"
 * (`CAPSULE_FORMAT.md`), and `SECURITY_AND_PRIVACY.md` names decompression
 * bombs explicitly. The numbers are policy, not format, so callers may tighten
 * them; the defaults are sized for a knowledge capsule, not for arbitrary data.
 */
export interface ArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  /**
   * Uncompressed-to-compressed ratio ceiling. Ordinary text compresses around
   * 3–5×; a 42.zip layer is ~1000×. 200 leaves headroom for a large
   * highly-repetitive JSONL index without admitting a bomb.
   */
  readonly maxCompressionRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export function resolveArchiveLimits(
  overrides?: Partial<ArchiveLimits>,
): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
}
