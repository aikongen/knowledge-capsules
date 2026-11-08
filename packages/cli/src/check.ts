/**
 * kc check: advice about one capsule's trigger and canonical.md. Pure functions
 * over strings; no files, no network, no model. Advice never blocks anything.
 */

export interface CheckInput {
  readonly id: string;
  readonly version: string;
  readonly trigger: string;
  readonly canonical: string;
}

export interface Finding {
  readonly kind: "advice" | "skipped";
  readonly text: string;
}

const MAX_QUOTE = 60;
const MAX_WORDS = 2000;
const MAX_TRIGGER = 200;

const advice = (text: string): Finding => ({ kind: "advice", text });
const skipped = (text: string): Finding => ({ kind: "skipped", text });

/** The words in quotes, cut to 60 characters. */
export function quote(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return `"${flat.length > MAX_QUOTE ? `${flat.slice(0, MAX_QUOTE - 1)}…` : flat}"`;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function lineList(lines: readonly number[]): string {
  const unique = [...new Set(lines)];
  return `${unique.length === 1 ? "line" : "lines"} ${unique.join(", ")}`;
}

/** Trigger advice: a, b and c of the list. */
export function checkTrigger(id: string, trigger: string): Finding[] {
  const found: Finding[] = [];
  if (!trigger.startsWith("Use when")) {
    const first = trigger.split(/\s+/).filter((w) => w !== "").slice(0, 3).join(" ");
    found.push(advice(`trigger starts with ${quote(first)}; start with "Use when"`));
  }
  if (trigger.length > MAX_TRIGGER) {
    found.push(advice(`trigger ${trigger.length} characters; keep it under about ${MAX_TRIGGER} so it reads in the list`));
  }
  const namespace = id.split("/")[0] ?? "";
  const lower = trigger.toLowerCase();
  const places = ["this repository", "our", "we", namespace.toLowerCase()].filter(
    (p) => p !== "" && new RegExp(`(^|[^a-z0-9])${p.replace(/[^a-z0-9 ]/g, "\\$&")}(?![a-z0-9])`).test(lower),
  );
  if (places.length > 0) {
    found.push(advice(`trigger has ${places.map((p) => quote(p.trim())).join(", ")}: the same capsule is pinned in many repositories; name the task, not the place`));
  }
  return found;
}

interface Line {
  readonly n: number;
  readonly text: string;
  readonly fenced: boolean;
}

/** Lines with their numbers (from 1); lines inside a fenced code block are marked, the fence lines too. */
function linesOf(text: string): Line[] {
  let inFence = false;
  return text.split("\n").map((raw, i) => {
    const text = raw.replace(/\r$/, "");
    const fence = /^\s*(```|~~~)/.test(text);
    if (fence) inFence = !inFence;
    return { n: i + 1, text, fenced: fence || inFence };
  });
}

/** [start, end] index pairs of `code` and "quoted" spans on one line, the quote marks included. */
function quotedSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of [/`[^`]*`/g, /"[^"]*"/g, /“[^”]*”/g]) {
    for (const m of text.matchAll(pattern)) spans.push([m.index, m.index + m[0].length - 1]);
  }
  return spans;
}

const isQuoted = (spans: readonly [number, number][], at: number): boolean => spans.some(([a, b]) => at > a && at < b);

/** Spans of a line that look like links, as [start, token]. Markdown links first, then bare URLs not inside them. */
function linkTokens(text: string): { at: number; token: string }[] {
  const found: { at: number; token: string }[] = [];
  const covered: [number, number][] = [];
  for (const m of text.matchAll(/\[[^\]]*\]\([^)\s]*\)/g)) {
    found.push({ at: m.index, token: m[0] });
    covered.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)>\]"'`]+/g)) {
    if (covered.some(([a, b]) => m.index >= a && m.index < b)) continue;
    found.push({ at: m.index, token: m[0].replace(/[.,;:!?]+$/, "") });
  }
  return found.sort((a, b) => a.at - b.at);
}

const PATH_START = /^(\/Users\/|\/home\/|\.\/|\.\.\/)/;
const PATH_END = /\.(md|json|ts|swift)$/;

/** Path-like tokens of a line, as [start, token]. URLs are not paths. */
function pathTokens(text: string): { at: number; token: string }[] {
  const found: { at: number; token: string }[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const lead = m[0].match(/^[(\[<"'`*“‘]*/)?.[0].length ?? 0;
    const token = m[0].slice(lead).replace(/[)\]>"'`*”’,;:!?.]+$/, "");
    if (token === "" || token.includes("://")) continue;
    if (PATH_START.test(token) || (token.includes("/") && PATH_END.test(token))) found.push({ at: m.index + lead, token });
  }
  return found;
}

/** Group per line: one advice line per occurrence, one skipped line per source line. */
function reachFindings(lines: readonly Line[], tokens: (text: string) => { at: number; token: string }[], advise: string, skipWhy: string): Finding[] {
  const found: Finding[] = [];
  for (const line of lines) {
    const spans = quotedSpans(line.text);
    const hidden: string[] = [];
    for (const { at, token } of tokens(line.text)) {
      if (line.fenced || isQuoted(spans, at)) hidden.push(quote(token));
      else found.push(advice(`line ${line.n} ${quote(token)}: ${advise}`));
    }
    if (hidden.length > 0) found.push(skipped(`line ${line.n} ${hidden.join(", ")} ${skipWhy}`));
  }
  return found;
}

const RULE = /\b(must|never|do not|don[’']t|always)\b/i;
const REASON = /\b(because|so|which|otherwise|since)\b/i;

/** Sentences of a paragraph, split on ". ", "! " and "? ". */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== "");
}

/** Paragraphs: consecutive unfenced lines joined with spaces; a blank line, a table row, a heading or a list item starts a new one; table rows are left out. `n` is the first line. */
function paragraphs(lines: readonly Line[]): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let current: { n: number; text: string } | undefined;
  for (const l of lines) {
    const text = l.text.trim();
    const starts = /^([-*]|\d+\.)\s/.test(text) || text.startsWith("#");
    if (l.fenced || text === "" || text.startsWith("|")) {
      if (current) out.push(current);
      current = undefined;
      continue;
    }
    if (current && !starts) current.text += ` ${text}`;
    else {
      if (current) out.push(current);
      current = { n: l.n, text };
    }
  }
  if (current) out.push(current);
  return out;
}

/** The text with every `code` and "quoted" span blanked, so a quoted rule word is not a rule. */
function unquoted(text: string): string {
  const chars = [...text];
  for (const [a, b] of quotedSpans(text)) for (let i = a; i <= b; i++) chars[i] = " ";
  return chars.join("");
}

/** Advice for canonical.md: d to i of the list. */
export function checkCanonical(canonical: string): Finding[] {
  const found: Finding[] = [];
  const words = wordCount(canonical);
  if (words > MAX_WORDS) found.push(advice(`${thousands(words)} words; split before about ${thousands(MAX_WORDS)}`));
  const lines = linesOf(canonical);

  found.push(...reachFindings(lines, linkTokens, "a reader with only this capsule cannot follow it", "look quoted, not links"));
  found.push(...reachFindings(lines, pathTokens, "a path is a pointer; put the substance here", "look quoted, not paths"));

  const dates = lines.flatMap((l) => [...l.text.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(() => l.n));
  if (dates.length > 0) found.push(advice(`${plural(dates.length, "date", "dates")} (${lineList(dates)}); dates go stale`));

  const rules = paragraphs(lines)
    .map((p) => unquoted(p.text))
    .map((text, i) => ({ n: paragraphs(lines)[i]!.n, rule: sentences(text).some((s) => RULE.test(s)), reason: REASON.test(text) }))
    .filter((p) => p.rule && !p.reason)
    .map((p) => p.n);
  if (rules.length > 0) found.push(advice(`${plural(rules.length, "paragraph", "paragraphs")} with a rule and no reason (${lineList(rules)}); say why beside the rule`));

  const headings = lines.filter((l) => !l.fenced && l.text.startsWith("# "));
  if (headings.length > 1) found.push(advice(`${headings.length} level-1 headings; one subject per capsule`));
  return found;
}

export function checkCapsule(input: CheckInput): Finding[] {
  return [...checkTrigger(input.id, input.trigger), ...checkCanonical(input.canonical)];
}

export function adviceCount(findings: readonly Finding[]): number {
  return findings.filter((f) => f.kind === "advice").length;
}

/** The lines kc prints for one capsule: a header, then one line per finding. */
export function formatReport(input: Pick<CheckInput, "id" | "version">, findings: readonly Finding[]): string[] {
  const n = adviceCount(findings);
  const head = `${input.id}@${input.version}: ${n === 0 ? "no advice" : plural(n, "piece of advice", "pieces of advice")}`;
  return [head, ...findings.map((f) => `  ${f.kind}: ${f.text}`)];
}

const STOP_WORDS = new Set(["use", "when", "or", "and", "a", "an", "the", "for", "any", "anything", "of", "to", "in", "on", "its", "it", "is", "that", "this", "with"]);

function triggerWords(trigger: string): string[] {
  return [...new Set(trigger.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "" && !STOP_WORDS.has(w)))];
}

/** Words two triggers share, in the order of the first, when there are at least 3. */
export function sharedTriggerWords(a: string, b: string): string[] {
  const other = new Set(triggerWords(b));
  const shared = triggerWords(a).filter((w) => other.has(w));
  return shared.length >= 3 ? shared : [];
}

/** Set-level lines: one for each pair of capsules whose triggers share 3 or more words. */
export function checkSet(items: readonly { id: string; trigger: string }[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const shared = sharedTriggerWords(items[i]!.trigger, items[j]!.trigger);
      if (shared.length > 0) lines.push(`triggers of ${items[i]!.id} and ${items[j]!.id} share: ${shared.join(", ")}`);
    }
  }
  return lines;
}
