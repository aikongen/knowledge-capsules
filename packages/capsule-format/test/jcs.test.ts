import { describe, expect, it } from "bun:test";

import { KcError } from "@kc/contracts";

import {
  canonicalJsonBytes,
  canonicalizeJson,
  canonicalizeJsonString,
} from "../src/jcs.ts";

describe("canonicalizeJson: key ordering", () => {
  it("sorts object keys ascending regardless of insertion order", () => {
    const value = { b: 1, a: 2, c: 3 };
    expect(canonicalizeJson(value)).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts keys inside nested objects independently at every level", () => {
    const value = { z: { y: 1, x: 2 }, a: 1 };
    expect(canonicalizeJson(value)).toBe('{"a":1,"z":{"x":2,"y":1}}');
  });

  it("preserves array element order, which is not sorted", () => {
    const value = [3, 1, 2];
    expect(canonicalizeJson(value)).toBe("[3,1,2]");
  });
});

describe("canonicalizeJson: ES6 number serialization", () => {
  it("emits integers without a decimal point", () => {
    expect(canonicalizeJson(42)).toBe("42");
  });

  it("emits decimals as ES6 number-to-string, not fixed precision", () => {
    expect(canonicalizeJson(1.5)).toBe("1.5");
  });

  it("emits -0 as \"0\", per RFC 8785 deferring to ES6 ToString", () => {
    expect(canonicalizeJson(-0)).toBe("0");
  });

  it("emits a small-magnitude decimal in exponential form, matching JSON.stringify", () => {
    // ES6 ToString switches to exponential notation below 1e-6; unlike large
    // magnitudes, this stays well inside the exactly-representable range
    // because it is not an integer, so it is accepted rather than rejected.
    expect(canonicalizeJson(1e-7)).toBe("1e-7");
  });

  it("rejects 1e21 even though JSON.stringify would happily emit \"1e+21\"", () => {
    // 1e21 has no fractional part at double precision, so Number.isInteger
    // treats it as an integer, and it is far outside ±2^53 — the ES6
    // exponential-notation quirk never gets a chance to matter here.
    expect(() => canonicalizeJson(1e21)).toThrow(KcError);
  });

  it("round-trips 2^53 exactly, the boundary the spec calls exactly representable", () => {
    const maxExact = 2 ** 53;
    expect(canonicalizeJson(maxExact)).toBe(String(maxExact));
  });

  it("rejects the first integer past 2^53 that a double can actually represent", () => {
    // 2**53 + 1 is not itself representable as a double (it silently rounds
    // back down to 2**53), so it cannot exercise this boundary. The spacing
    // between representable doubles at this magnitude is 2, making 2**53 + 2
    // the first distinct value past the boundary.
    expect(2 ** 53 + 1).toBe(2 ** 53);
    expect(() => canonicalizeJson(2 ** 53 + 2)).toThrow(KcError);
  });

  it("rejects a negative integer past -2^53 symmetrically", () => {
    expect(() => canonicalizeJson(-(2 ** 53) - 2)).toThrow(KcError);
  });

  it("rejects NaN", () => {
    expect(() => canonicalizeJson(Number.NaN)).toThrow(KcError);
  });

  it("rejects +Infinity", () => {
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(KcError);
  });

  it("rejects -Infinity", () => {
    expect(() => canonicalizeJson(Number.NEGATIVE_INFINITY)).toThrow(KcError);
  });
});

describe("canonicalizeJsonString: escaping", () => {
  it("escapes the named control characters with their short form", () => {
    expect(canonicalizeJsonString("\b\t\n\f\r", "/x")).toBe(
      '"\\b\\t\\n\\f\\r"',
    );
  });

  it("escapes a double quote", () => {
    expect(canonicalizeJsonString('"', "/x")).toBe('"\\""');
  });

  it("escapes a backslash", () => {
    expect(canonicalizeJsonString("\\", "/x")).toBe('"\\\\"');
  });

  it("escapes a control character with no short form as \\u00XX", () => {
    expect(canonicalizeJsonString("", "/x")).toBe('"\\u0001"');
  });

  it("escapes U+001F (last control character below the printable range)", () => {
    expect(canonicalizeJsonString("", "/x")).toBe('"\\u001f"');
  });

  it("leaves U+0020 (space) unescaped, one past the control range", () => {
    expect(canonicalizeJsonString(" ", "/x")).toBe('" "');
  });

  it("passes through a non-BMP character (an astral emoji) unescaped", () => {
    const value = "\u{1F600}";
    expect(canonicalizeJsonString(value, "/x")).toBe(`"${value}"`);
  });

  it("passes through a valid surrogate pair as the two original UTF-16 units", () => {
    const value = "\u{1D400}"; // MATHEMATICAL BOLD CAPITAL A
    const result = canonicalizeJsonString(value, "/x");
    expect(result).toBe(`"${value}"`);
    expect(result.length).toBe(4); // opening quote + 2 surrogate units + closing quote
  });

  it("rejects a lone high surrogate", () => {
    expect(() => canonicalizeJsonString("\ud800", "/x")).toThrow(KcError);
  });

  it("rejects a lone low surrogate", () => {
    expect(() => canonicalizeJsonString("\udc00", "/x")).toThrow(KcError);
  });

  it("rejects a high surrogate followed by a non-surrogate", () => {
    expect(() => canonicalizeJsonString("\ud800a", "/x")).toThrow(KcError);
  });
});

describe("canonicalizeJson: nested structures", () => {
  it("canonicalizes arrays of objects with per-object key sorting", () => {
    const value = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    expect(canonicalizeJson(value)).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  it("canonicalizes deeply nested mixed structures", () => {
    const value = { list: [1, { z: true, a: null }], top: "x" };
    expect(canonicalizeJson(value)).toBe(
      '{"list":[1,{"a":null,"z":true}],"top":"x"}',
    );
  });

  it("omits object keys whose value is undefined, matching JCS's treatment of absent members", () => {
    const value = { a: 1, b: undefined };
    expect(canonicalizeJson(value)).toBe('{"a":1}');
  });

  it("rejects a cyclic object instead of hanging or overflowing the stack", () => {
    const value: Record<string, unknown> = { a: 1 };
    value.self = value;
    expect(() => canonicalizeJson(value)).toThrow(KcError);
  });
});

describe("canonicalJsonBytes", () => {
  it("returns the UTF-8 encoding of the canonical text", () => {
    const bytes = canonicalJsonBytes({ a: "café" });
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('{"a":"café"}');
    // "café" is 4 characters but 5 bytes once "é" (U+00E9) is UTF-8 encoded.
    expect(bytes.length).toBe('{"a":"caf'.length + 2 + 2);
  });
});
