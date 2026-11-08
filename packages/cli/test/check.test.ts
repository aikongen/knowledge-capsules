import { describe, expect, test } from "bun:test";

import { adviceCount, checkCanonical, checkCapsule, checkSet, checkTrigger, formatReport, quote, sharedTriggerWords, wordCount } from "../src/check.ts";

const texts = (lines: ReturnType<typeof checkCanonical>) => lines.map((f) => `${f.kind}: ${f.text}`);

describe("trigger", () => {
  test("a good trigger has no advice", () => {
    expect(checkTrigger("aikongen/x", "Use when writing a report.")).toEqual([]);
  });

  test("not starting with Use when quotes the first three words", () => {
    expect(texts(checkTrigger("acme/x", "Writing the best report ever"))).toEqual(['advice: trigger starts with "Writing the best"; start with "Use when"']);
  });

  test("over 200 characters", () => {
    const trigger = `Use when ${"x".repeat(200)}`;
    expect(texts(checkTrigger("acme/x", trigger))).toEqual([`advice: trigger ${trigger.length} characters; keep it under about 200 so it reads in the list`]);
  });

  test("a place: this repository, our, we, or its own namespace", () => {
    const place = "the same capsule is pinned in many repositories; name the task, not the place";
    expect(texts(checkTrigger("acme/x", "Use when working in this repository."))).toEqual([`advice: trigger has "this repository": ${place}`]);
    expect(texts(checkTrigger("acme/x", "Use when we write. Use our rules."))).toEqual([`advice: trigger has "our", "we": ${place}`]);
    expect(texts(checkTrigger("aikongen/x", "Use when writing for Aikongen."))).toEqual([`advice: trigger has "aikongen": ${place}`]);
    expect(checkTrigger("acme/x", "Use when answering a question.")).toEqual([]);
  });
});

describe("canonical", () => {
  test("counts words and advises over 2,000", () => {
    expect(wordCount("one two\nthree   four\n")).toBe(4);
    expect(checkCanonical(Array(2001).fill("word").join(" "))).toEqual([{ kind: "advice", text: "2,001 words; split before about 2,000" }]);
    expect(checkCanonical(Array(2000).fill("word").join(" "))).toEqual([]);
  });

  test("links: one advice line per occurrence, with the line number", () => {
    const found = texts(checkCanonical("fine\nSee [the guide](other.md) and https://example.com/a. Also http://b.org\n"));
    expect(found).toEqual([
      'advice: line 2 "[the guide](other.md)": a reader with only this capsule cannot follow it',
      'advice: line 2 "https://example.com/a": a reader with only this capsule cannot follow it',
      'advice: line 2 "http://b.org": a reader with only this capsule cannot follow it',
    ]);
  });

  test("a link inside backticks or double quotes is skipped, not advised; so is a link in a code fence", () => {
    const found = texts(checkCanonical('Say `https://a.io` or "[see](http)" here\n```\ncurl https://c.io\n```\n'));
    expect(found).toEqual(['skipped: line 1 "https://a.io", "[see](http)" look quoted, not links', 'skipped: line 3 "https://c.io" look quoted, not links']);
  });

  test("quotes are cut to 60 characters", () => {
    expect(quote("x".repeat(100))).toBe(`"${"x".repeat(59)}…"`);
    expect(quote("short")).toBe('"short"');
  });

  test("paths", () => {
    const found = texts(checkCanonical("Open /Users/me/a and ./b, ../c, docs/x.md, src/y.ts, z/q.json, w/v.swift, plain.md or docs/readme.txt.\nUse `docs/x.md` or \"./b\".\n"));
    const why = "a path is a pointer; put the substance here";
    expect(found).toEqual([
      `advice: line 1 "/Users/me/a": ${why}`,
      `advice: line 1 "./b": ${why}`,
      `advice: line 1 "../c": ${why}`,
      `advice: line 1 "docs/x.md": ${why}`,
      `advice: line 1 "src/y.ts": ${why}`,
      `advice: line 1 "z/q.json": ${why}`,
      `advice: line 1 "w/v.swift": ${why}`,
      'skipped: line 2 "docs/x.md", "./b" look quoted, not paths',
    ]);
  });

  test("a URL is a link, not a path", () => {
    expect(texts(checkCanonical("https://a.io/b/c.md\n"))).toEqual(['advice: line 1 "https://a.io/b/c.md": a reader with only this capsule cannot follow it']);
  });

  test("dates give one line with the count and the lines", () => {
    expect(texts(checkCanonical("on 2026-11-01 and 2026-11-02\nnothing\nthen 2026-12-31\n"))).toEqual(["advice: 3 dates (lines 1, 3); dates go stale"]);
    expect(texts(checkCanonical("on 2026-11-01\n"))).toEqual(["advice: 1 date (line 1); dates go stale"]);
  });

  test("rules without a reason, judged per paragraph", () => {
    const text = [
      "You must keep it short.",
      "",
      "You must keep it short because people skim.",
      "",
      "Never ship. Always test, otherwise it breaks.",
      "",
      "Please do not panic, and don't stop.",
      "",
      "Mustard is fine.",
    ].join("\n");
    expect(texts(checkCanonical(text))).toEqual(["advice: 2 paragraphs with a rule and no reason (lines 1, 7); say why beside the rule"]);
  });

  test("a rule wrapped over two lines with the reason on the second line is not flagged", () => {
    expect(checkCanonical("You must keep every paragraph short\nbecause people skim.\n")).toEqual([]);
    expect(texts(checkCanonical("You must keep every paragraph short\nand clear.\n"))).toEqual(["advice: 1 paragraph with a rule and no reason (line 1); say why beside the rule"]);
    expect(checkCanonical("| Do | Don't |\n| --- | --- |\n| Never guess. | Always ask. |\n")).toEqual([]);
  });

  test("a heading ends its own paragraph, so the rule is reported on its own line", () => {
    expect(texts(checkCanonical("# T\nNever do X.\n"))).toEqual(["advice: 1 paragraph with a rule and no reason (line 2); say why beside the rule"]);
  });

  test("dates inside code fences, backticks or quotes are not counted", () => {
    expect(checkCanonical("```\n2026-01-01\n```\nUse `2026-01-02` or \"2026-01-03\".\n")).toEqual([]);
    expect(texts(checkCanonical("Real 2026-01-04 and `2026-01-05`.\n"))).toEqual(["advice: 1 date (line 1); dates go stale"]);
  });

  test("a double quote after a digit is an inch mark and opens no quote", () => {
    expect(texts(checkCanonical('A 5" screen must be tall. See https://a.io\n'))).toEqual([
      'advice: line 1 "https://a.io": a reader with only this capsule cannot follow it',
      "advice: 1 paragraph with a rule and no reason (line 1); say why beside the rule",
    ]);
  });

  test("a quoted or backticked rule word is not a rule", () => {
    expect(checkCanonical('Say "never" to the word, and write `must` in code.\n')).toEqual([]);
  });

  test("more than one level-1 heading", () => {
    expect(checkCanonical("# One\n\n## Two\n")).toEqual([]);
    expect(texts(checkCanonical("# One\n\n# Two\n```\n# not a heading\n```\n"))).toEqual(["advice: 2 level-1 headings; one subject per capsule"]);
  });
});

describe("report", () => {
  test("no advice", () => {
    expect(formatReport({ id: "aikongen/x", version: "1.0.0" }, [])).toEqual(["aikongen/x@1.0.0: no advice"]);
  });

  test("counts advice, not skipped, and says one piece of advice", () => {
    const findings = checkCapsule({ id: "a/x", version: "1.0.0", trigger: "Use when writing.", canonical: "On 2026-01-01 see `./a`.\n" });
    expect(adviceCount(findings)).toBe(1);
    expect(formatReport({ id: "a/x", version: "1.0.0" }, findings)).toEqual([
      "a/x@1.0.0: 1 piece of advice",
      '  skipped: line 1 "./a" look quoted, not paths',
      "  advice: 1 date (line 1); dates go stale",
    ]);
  });
});

describe("set", () => {
  test("shared words, stop words dropped, in the order of the first trigger", () => {
    expect(sharedTriggerWords("Use when writing, changing or reviewing a capsule.", "Use when reviewing, writing or changing Markdown for any reader.")).toEqual(["writing", "changing", "reviewing"]);
  });

  test("the words of the usual 'even when the request does not mention' phrase say nothing", () => {
    const a = "Use when writing text, even when the request does not mention it, only from such cases as says.";
    const b = "Use when coding, even when the request does not mention it, only from such cases as says.";
    expect(sharedTriggerWords(a, b)).toEqual([]);
  });

  test("fewer than 3 shared words is not reported", () => {
    expect(sharedTriggerWords("Use when writing or changing code", "Use when writing or changing prose")).toEqual([]);
  });

  test("one line per pair", () => {
    const items = [
      { id: "a/one", trigger: "Use when writing, changing or reviewing text." },
      { id: "a/two", trigger: "Use when reviewing, writing or changing code." },
      { id: "a/three", trigger: "Use when designing screens." },
    ];
    expect(checkSet(items)).toEqual(["triggers of a/one and a/two share: writing, changing, reviewing"]);
  });
});
