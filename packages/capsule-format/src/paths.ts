import { violation, type RuleViolation } from "./rules.ts";

/** `CAPSULE_FORMAT.md`: "Maximum path length is 512 bytes after UTF-8 encoding." */
export const MAX_PATH_BYTES = 512;

const encoder = new TextEncoder();

const WINDOWS_DRIVE = /^[A-Za-z]:$/;
const LEADING_OR_TRAILING_WHITESPACE = /^\s|\s$/u;

/**
 * NFC, because macOS `readdir` returns decomposed names and the same capsule
 * would otherwise digest differently depending on the machine that packed it.
 */
export function normalizeEntryPath(path: string): string {
  return path.normalize("NFC");
}

/**
 * Uniqueness is checked on the NFC + ASCII-case-folded form so that `Item.md`
 * and `item.md` collide before extraction onto a case-insensitive filesystem
 * silently drops one of them while the recomputed digest still matches.
 *
 * Folding is deliberately ASCII-only: full Unicode case folding would make
 * `ﬁ.md` collide with `fi.md`, which no real filesystem does, and would make
 * acceptance depend on the ICU version of the machine doing the import.
 */
export function foldEntryPath(path: string): string {
  return normalizeEntryPath(path).replaceAll(/[A-Z]/g, (character) =>
    character.toLowerCase(),
  );
}

export function pathByteLength(path: string): number {
  return encoder.encode(path).length;
}

/**
 * Ordering for the canonical entry stream: unsigned UTF-8 byte value.
 *
 * `Array.prototype.sort()` compares UTF-16 code units and disagrees with byte
 * order for code points above U+FFFF — U+FFFD (EF BF BD) sorts *before* U+10000
 * (F0 90 80 80) in UTF-8 because EF < F0, but *after* it in UTF-16 because FFFD
 * exceeds the D800 lead surrogate — so every entry ordering in this package goes
 * through here.
 */
export function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * Every path rule from the spec's "Path rules" section, applied to one already
 * NFC-normalized package-relative path. Collects rather than throws so an
 * import can report a whole malformed archive at once.
 */
export function collectPathViolations(path: string): RuleViolation[] {
  const found: RuleViolation[] = [];
  const at = path;

  if (path.length === 0) return [violation("PATH-01", "path is empty")];

  if (path.includes("\\")) {
    found.push(violation("PATH-06", "path contains a backslash", at));
  }
  if (path.startsWith("/")) {
    found.push(violation("PATH-02", "path is absolute", at));
  }
  if (path.endsWith("/")) {
    found.push(
      violation("PATH-07", "path is a directory entry, not a file", at),
    );
  }

  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20) {
      found.push(
        violation(
          "PATH-11",
          `path contains the control character U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
          at,
        ),
      );
      break;
    }
  }

  const byteLength = pathByteLength(path);
  if (byteLength > MAX_PATH_BYTES) {
    found.push(
      violation(
        "PATH-08",
        `path is ${String(byteLength)} bytes, over the ${String(MAX_PATH_BYTES)}-byte maximum`,
        at,
      ),
    );
  }

  const segments = path.split("/");
  for (const [index, segment] of segments.entries()) {
    if (segment === "") {
      // A leading empty segment is already reported as an absolute path and a
      // trailing one as a directory entry; only interior gaps are new news.
      const isEdge = index === 0 || index === segments.length - 1;
      if (!isEdge) {
        found.push(violation("PATH-05", "path contains an empty segment", at));
      }
      continue;
    }
    if (segment === "..") {
      found.push(violation("PATH-03", "path contains a '..' segment", at));
      continue;
    }
    if (segment === ".") {
      found.push(violation("PATH-04", "path contains a '.' segment", at));
      continue;
    }
    if (index === 0 && WINDOWS_DRIVE.test(segment)) {
      found.push(
        violation("PATH-02", "path is absolute (drive-qualified)", at),
      );
    }
    if (LEADING_OR_TRAILING_WHITESPACE.test(segment)) {
      found.push(
        violation(
          "PATH-09",
          `segment "${segment}" has leading or trailing whitespace`,
          at,
        ),
      );
    }
    if (segment.endsWith(".")) {
      // Windows strips trailing dots, so "notes.md." and "notes.md" would name
      // the same extracted file while hashing as two distinct entries.
      found.push(
        violation("PATH-10", `segment "${segment}" ends with '.'`, at),
      );
    }
  }

  return found;
}

/** Fatal on the folded form, per the spec's silent-content-substitution note. */
export function collectDuplicatePathViolations(
  paths: Iterable<string>,
): RuleViolation[] {
  const seen = new Map<string, string>();
  const found: RuleViolation[] = [];
  for (const path of paths) {
    const folded = foldEntryPath(path);
    const previous = seen.get(folded);
    if (previous === undefined) {
      seen.set(folded, path);
      continue;
    }
    found.push(
      violation(
        "PATH-12",
        `"${path}" and "${previous}" collide on the NFC + case-folded form "${folded}"`,
        path,
      ),
    );
  }
  return found;
}
