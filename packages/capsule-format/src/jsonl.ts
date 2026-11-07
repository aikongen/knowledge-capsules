import { KcError } from "@kc/contracts";

export interface JsonlRecord {
  /** 1-based line number, for pointing an operator at the offending row. */
  readonly line: number;
  readonly value: unknown;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Parses a JSONL entry without re-serializing it.
 *
 * Blank lines are rejected rather than skipped: a tolerant reader makes
 * `inventory` counts (PKG-07) ambiguous, and the count is a validation rule.
 */
export function parseJsonl(bytes: Uint8Array, at: string): JsonlRecord[] {
  if (bytes.length === 0) return [];

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    throw new KcError("validation_failed", `${at} is not valid UTF-8`, {
      details: [{ at, message: "entry is not valid UTF-8" }],
      cause,
    });
  }

  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body === "") return [];

  const records: JsonlRecord[] = [];
  const details: { at: string; message: string }[] = [];

  for (const [index, line] of body.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      details.push({
        at: `${at}:${String(lineNumber)}`,
        message: "blank line in a JSONL index",
      });
      continue;
    }
    try {
      records.push({ line: lineNumber, value: JSON.parse(line) as unknown });
    } catch (cause) {
      details.push({
        at: `${at}:${String(lineNumber)}`,
        message: cause instanceof Error ? cause.message : "invalid JSON",
      });
    }
  }

  if (details.length > 0) {
    throw new KcError("validation_failed", `the vault's records are damaged at ${at}`, {
      details,
    });
  }

  return records;
}
