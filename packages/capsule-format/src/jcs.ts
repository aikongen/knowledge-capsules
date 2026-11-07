import { KcError } from "@kc/contracts";

/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Implemented here rather than taken from npm on purpose: this is the function
 * that decides capsule identity, so a compromised or subtly wrong transitive
 * dependency would silently change every digest the product issues. The
 * algorithm is roughly a hundred lines and fully specified, which makes the
 * supply-chain risk the more expensive side of the trade.
 *
 * Two deviations from plain `JSON.stringify` matter:
 *
 * - keys are sorted by UTF-16 code unit, which is what `<` on JS strings
 *   already does — this is *not* the UTF-8 byte order used for entry paths in
 *   `CAPSULE_FORMAT.md`, and the two disagree above U+FFFF;
 * - values JCS cannot round-trip are rejected instead of silently mangled,
 *   where `JSON.stringify` would emit `null` for a non-finite number and drop
 *   `undefined` members.
 */

const ESCAPES: Readonly<Record<number, string>> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

/**
 * `CAPSULE_FORMAT.md`: "integers outside ±2^53 ... are rejected at
 * publication". Read literally, so 2^53 itself is accepted and 2^53 + 1 — the
 * first integer a double cannot represent exactly — is not.
 */
const MAX_EXACT_INTEGER = 2 ** 53;

function reject(message: string, at: string): never {
  throw new KcError("validation_failed", message, {
    details: [{ at, message }],
  });
}

export function canonicalizeJsonString(value: string, at: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const escape = ESCAPES[code];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      // A lone surrogate has no UTF-8 encoding; TextEncoder would substitute
      // U+FFFD and two different inputs would canonicalize identically.
      const isHigh = code <= 0xdbff;
      const next = isHigh ? value.charCodeAt(index + 1) : Number.NaN;
      const paired = isHigh && next >= 0xdc00 && next <= 0xdfff;
      if (!paired) {
        reject(
          `string contains an unpaired surrogate (U+${code.toString(16).toUpperCase()})`,
          at,
        );
      }
      out += value[index]! + value[index + 1]!;
      index += 1;
      continue;
    }
    out += value[index]!;
  }
  return `${out}"`;
}

function canonicalizeNumber(value: number, at: string): string {
  if (!Number.isFinite(value)) {
    reject("non-finite numbers cannot be canonicalized", at);
  }
  if (Number.isInteger(value) && Math.abs(value) > MAX_EXACT_INTEGER) {
    reject(`integer ${value} is outside the exactly representable ±2^53`, at);
  }
  // RFC 8785 defers to ES6 number-to-string, which is exactly what
  // `JSON.stringify` emits, including "0" for -0 and "1e+30" for 1e30.
  return JSON.stringify(value);
}

function canonicalize(value: unknown, at: string, seen: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalizeNumber(value, at);
    case "string":
      return canonicalizeJsonString(value, at);
    case "bigint":
      return reject("bigint cannot be canonicalized as JSON", at);
    case "undefined":
      return reject("undefined cannot be canonicalized as JSON", at);
    case "function":
    case "symbol":
      return reject(`${typeof value} cannot be canonicalized as JSON`, at);
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) reject("value contains a cycle", at);
  seen.add(object);

  let out: string;
  if (Array.isArray(object)) {
    const parts = object.map((item, index) =>
      canonicalize(item, `${at}/${String(index)}`, seen),
    );
    out = `[${parts.join(",")}]`;
  } else {
    const record = object as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      // `Array.prototype.sort` on strings compares UTF-16 code units, which is
      // precisely what RFC 8785 §3.2.3 mandates for property names.
      .sort();
    const parts = keys.map((key) => {
      const pointer = `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      return `${canonicalizeJsonString(key, pointer)}:${canonicalize(record[key], pointer, seen)}`;
    });
    out = `{${parts.join(",")}}`;
  }

  seen.delete(object);
  return out;
}

/** Canonical JCS text for a JSON value. Throws `validation_failed` otherwise. */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value, "", new Set());
}

/** UTF-8 bytes of {@link canonicalizeJson}, which is what actually gets hashed. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}
