import { describe, expect, it } from "bun:test";

import {
  MAX_PATH_BYTES,
  collectDuplicatePathViolations,
  collectPathViolations,
  compareUtf8,
  foldEntryPath,
} from "../src/paths.ts";

/** Asserts exactly one rule fired, and that it is the expected one. */
function expectSingleRule(path: string, rule: string): void {
  const violations = collectPathViolations(path);
  expect<unknown>(violations.map((v) => v.rule)).toEqual([rule]);
}

describe("collectPathViolations: each rule rejects, and names itself", () => {
  it("PATH-02 rejects an absolute path", () => {
    expectSingleRule("/etc/passwd", "PATH-02");
  });

  it("PATH-02 rejects a Windows drive-qualified path", () => {
    expectSingleRule("C:/notes.md", "PATH-02");
  });

  it("PATH-03 rejects a '..' traversal segment", () => {
    expectSingleRule("a/../b.md", "PATH-03");
  });

  it("PATH-04 rejects a '.' segment", () => {
    expectSingleRule("a/./b.md", "PATH-04");
  });

  it("PATH-05 rejects an interior empty segment", () => {
    expectSingleRule("a//b.md", "PATH-05");
  });

  it("PATH-06 rejects a backslash separator", () => {
    expectSingleRule("a\\b.md", "PATH-06");
  });

  it("PATH-07 rejects a trailing-slash directory entry", () => {
    expectSingleRule("a/b/", "PATH-07");
  });

  it("PATH-08 rejects a path one byte over the 512-byte maximum", () => {
    const overLimit = "a".repeat(MAX_PATH_BYTES + 1);
    expectSingleRule(overLimit, "PATH-08");
  });

  it("accepts exactly 512 bytes: the limit is '>', not '>='", () => {
    const exact = "a".repeat(MAX_PATH_BYTES);
    expect(exact.length).toBe(MAX_PATH_BYTES);
    expect(collectPathViolations(exact)).toEqual([]);
  });

  it("PATH-09 rejects a segment with leading whitespace", () => {
    expectSingleRule(" notes.md", "PATH-09");
  });

  it("PATH-09 rejects a segment with trailing whitespace", () => {
    expectSingleRule("notes.md ", "PATH-09");
  });

  it("PATH-10 rejects a segment with a trailing dot", () => {
    expectSingleRule("notes.md.", "PATH-10");
  });

  it("PATH-11 rejects a control character below U+0020", () => {
    expectSingleRule("notes\x01.md", "PATH-11");
  });

  it("accepts a normal nested relative path with no violations", () => {
    expect(collectPathViolations("knowledge/items.jsonl")).toEqual([]);
  });

  it("accepts a deeply nested normal path", () => {
    expect(collectPathViolations("attachments/diagrams/flow-v2.png")).toEqual(
      [],
    );
  });

  it("reports every applicable rule at once rather than stopping at the first", () => {
    // Absolute + backslash + trailing dot all apply to this one path.
    const violations = collectPathViolations("/a\\b.");
    const rules = violations.map((v) => v.rule).sort();
    expect(rules).toContain("PATH-02");
    expect(rules).toContain("PATH-06");
  });
});

describe("compareUtf8: unsigned UTF-8 byte order", () => {
  it("orders ASCII strings the same as a naive comparison", () => {
    expect(compareUtf8("a", "b")).toBeLessThan(0);
    expect(compareUtf8("b", "a")).toBeGreaterThan(0);
    expect(compareUtf8("a", "a")).toBe(0);
  });

  it("orders a shorter prefix before its longer extension", () => {
    expect(compareUtf8("a", "ab")).toBeLessThan(0);
  });

  it("disagrees with Array.prototype.sort() default (UTF-16 code unit) ordering for an astral character", () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A encodes to UTF-8 F0 9D 90 80.
    // U+FFFD REPLACEMENT CHARACTER encodes to UTF-8 EF BF BD.
    // By unsigned byte value, 0xEF (U+FFFD's lead byte) > 0xF0 is false —
    // 0xEF < 0xF0, so U+FFFD sorts *before* U+1D400 in UTF-8 byte order.
    // In UTF-16, U+1D400 is a surrogate pair starting at 0xD835, and 0xD835 <
    // 0xFFFD, so U+1D400 sorts *before* U+FFFD in code-unit order: the two
    // orderings disagree.
    const astral = "\u{1D400}";
    const replacement = "\uFFFD";

    const byteOrder = compareUtf8(astral, replacement);
    const codeUnitOrder = [astral, replacement].sort()[0];

    expect(byteOrder).toBeGreaterThan(0); // replacement sorts first by UTF-8 bytes
    expect(codeUnitOrder).toBe(astral); // but astral sorts first under default .sort()
  });

  it("confirms the astral/replacement pair actually exercises default .sort() disagreement", () => {
    const astral = "\u{1D400}";
    const replacement = "\uFFFD";
    const defaultSorted = [replacement, astral].sort();
    // Array.prototype.sort() puts astral first (U+D835 < U+FFFD as code units),
    // the opposite of the UTF-8 byte order asserted above (replacement first).
    expect(defaultSorted).toEqual([astral, replacement]);
  });
});

describe("collectDuplicatePathViolations", () => {
  it("PATH-12 catches an exact duplicate path", () => {
    const violations = collectDuplicatePathViolations([
      "notes.md",
      "notes.md",
    ]);
    expect(violations.map((v) => v.rule)).toEqual(["PATH-12"]);
  });

  it("PATH-12 catches a case-collision pair", () => {
    const violations = collectDuplicatePathViolations(["Item.md", "item.md"]);
    expect(violations.map((v) => v.rule)).toEqual(["PATH-12"]);
  });

  it("PATH-12 catches an NFC/NFD pair naming the same logical file", () => {
    const nfc = "caf\u00e9.md"; // U+00E9: precomposed é
    const nfd = "cafe\u0301.md"; // e + U+0301 combining acute accent
    expect(nfc.normalize("NFC")).not.toBe(nfd); // different code-unit sequences
    expect(foldEntryPath(nfc)).toBe(foldEntryPath(nfd)); // same folded identity
    const violations = collectDuplicatePathViolations([nfc, nfd]);
    expect(violations.map((v) => v.rule)).toEqual(["PATH-12"]);
  });

  it("accepts distinct paths with no collisions", () => {
    expect(
      collectDuplicatePathViolations(["a.md", "b.md", "a/c.md"]),
    ).toEqual([]);
  });
});
