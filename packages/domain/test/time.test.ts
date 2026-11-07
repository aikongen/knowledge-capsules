import { describe, expect, it } from "bun:test";
import { KcError } from "@kc/contracts";

import {
  MILLISECONDS_PER_DAY,
  assertTimestamp,
  compareTimestamps,
  daysBetween,
  isTimestamp,
  parseTimestamp,
  timestampFromDate,
  timestampToEpochMs,
} from "../src/time.ts";

describe("parseTimestamp / assertTimestamp / isTimestamp", () => {
  it("accepts a UTC timestamp with no fractional seconds", () => {
    const value = "2024-01-01T00:00:00Z";
    expect(parseTimestamp(value).ok).toBe(true);
    expect(isTimestamp(value)).toBe(true);
    expect<unknown>(assertTimestamp(value)).toBe(value);
  });

  it("accepts a UTC timestamp with exactly three fractional digits", () => {
    const value = "2024-01-01T00:00:00.123Z";
    expect(parseTimestamp(value).ok).toBe(true);
    expect(isTimestamp(value)).toBe(true);
  });

  it("rejects a +00:00 offset — a different byte sequence for the same instant", () => {
    expect(parseTimestamp("2024-01-01T00:00:00+00:00").ok).toBe(false);
  });

  it("rejects a lowercase z", () => {
    expect(parseTimestamp("2024-01-01T00:00:00z").ok).toBe(false);
  });

  it("rejects six-digit fractional seconds (microsecond precision)", () => {
    expect(parseTimestamp("2024-01-01T00:00:00.123456Z").ok).toBe(false);
  });

  it("rejects one and two-digit fractional seconds", () => {
    expect(parseTimestamp("2024-01-01T00:00:00.1Z").ok).toBe(false);
    expect(parseTimestamp("2024-01-01T00:00:00.12Z").ok).toBe(false);
  });

  it("rejects a missing T separator or a date-only value", () => {
    expect(parseTimestamp("2024-01-01 00:00:00Z").ok).toBe(false);
    expect(parseTimestamp("2024-01-01").ok).toBe(false);
  });

  it("rejects an empty string and a non-string value", () => {
    expect(parseTimestamp("").ok).toBe(false);
    const result = parseTimestamp(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(KcError);
    expect(result.error.code).toBe("validation_failed");
  });

  it("assertTimestamp throws the shared error envelope on an invalid value", () => {
    expect(() => assertTimestamp("2024-01-01T00:00:00+00:00")).toThrow(
      KcError,
    );
  });
});

describe("timestampFromDate", () => {
  it("always emits exactly three fractional digits, which the pattern accepts", () => {
    const timestamp = timestampFromDate(new Date(Date.UTC(2024, 0, 1)));
    expect(timestamp).toMatch(/\.\d{3}Z$/u);
    expect(isTimestamp(timestamp)).toBe(true);
  });

  it("round-trips through parseTimestamp", () => {
    const date = new Date(Date.UTC(2024, 5, 15, 12, 30, 45, 678));
    const timestamp = timestampFromDate(date);
    const parsed = parseTimestamp(timestamp);
    expect(parsed.ok).toBe(true);
    expect(timestampToEpochMs(assertTimestamp(timestamp))).toBe(
      date.getTime(),
    );
  });
});

describe("compareTimestamps", () => {
  it("treats different byte representations of the same instant as equal", () => {
    const a = assertTimestamp("2024-01-01T00:00:00Z");
    const b = assertTimestamp("2024-01-01T00:00:00.000Z");
    expect(compareTimestamps(a, b)).toBe(0);
  });

  it("orders an earlier instant before a later one", () => {
    const a = assertTimestamp("2024-01-01T00:00:00Z");
    const b = assertTimestamp("2024-01-02T00:00:00Z");
    expect(compareTimestamps(a, b)).toBe(-1);
    expect(compareTimestamps(b, a)).toBe(1);
  });
});

describe("daysBetween", () => {
  it("counts whole days across a month boundary", () => {
    const from = assertTimestamp("2024-01-31T00:00:00Z");
    const to = assertTimestamp("2024-02-01T00:00:00Z");
    expect(daysBetween(from, to)).toBe(1);
  });

  it("counts across a full month", () => {
    const from = assertTimestamp("2024-01-01T00:00:00Z");
    const to = assertTimestamp("2024-02-01T00:00:00Z");
    expect(daysBetween(from, to)).toBe(31);
  });

  it("is negative when the range runs backwards", () => {
    const from = assertTimestamp("2024-02-01T00:00:00Z");
    const to = assertTimestamp("2024-01-31T00:00:00Z");
    expect(daysBetween(from, to)).toBe(-1);
  });

  it("is derived from MILLISECONDS_PER_DAY", () => {
    const from = assertTimestamp("2024-01-01T00:00:00Z");
    const to = assertTimestamp("2024-01-01T12:00:00Z");
    expect(daysBetween(from, to) * MILLISECONDS_PER_DAY).toBe(
      timestampToEpochMs(to) - timestampToEpochMs(from),
    );
    expect(daysBetween(from, to)).toBe(0.5);
  });
});
