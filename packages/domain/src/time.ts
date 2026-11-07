import { parseBranded, type Brand } from "./ids.ts";
import { TIMESTAMP_PATTERN } from "./patterns.ts";
import { unwrap, type Result } from "./result.ts";

/**
 * UTC instant with a literal `Z` and either no fractional part or exactly three
 * digits. `CAPSULE_FORMAT.md` fixes this shape because a hand-written
 * `...T16:00:00Z` and `Date.prototype.toISOString()` never hash the same.
 */
export type Timestamp = Brand<string, "Timestamp">;

export function parseTimestamp(value: unknown, at = "/"): Result<Timestamp> {
  return parseBranded<Timestamp>(value, TIMESTAMP_PATTERN, "timestamp", at);
}

export function assertTimestamp(value: unknown, at = "/"): Timestamp {
  return unwrap(parseTimestamp(value, at));
}

export function isTimestamp(value: unknown): value is Timestamp {
  return parseTimestamp(value).ok;
}

/** Always emits three fractional digits, which the contract pattern allows. */
export function timestampFromDate(date: Date): Timestamp {
  return date.toISOString() as Timestamp;
}

export function timestampToEpochMs(value: Timestamp): number {
  return Date.parse(value);
}

/**
 * Lexicographic comparison is wrong here: `...:00Z` and `...:00.000Z` are the
 * same instant but sort apart, because `.` precedes `Z`.
 */
export function compareTimestamps(a: Timestamp, b: Timestamp): -1 | 0 | 1 {
  const left = timestampToEpochMs(a);
  const right = timestampToEpochMs(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export const MILLISECONDS_PER_DAY = 86_400_000;

export function daysBetween(from: Timestamp, to: Timestamp): number {
  return (timestampToEpochMs(to) - timestampToEpochMs(from)) / MILLISECONDS_PER_DAY;
}
