import type { CapsuleEntry } from "./digest.ts";
import { sortCapsuleEntries } from "./digest.ts";
import { normalizeEntryPath } from "./paths.ts";

/**
 * Every file physically present in a capsule, keyed by NFC package-relative
 * path — including files the manifest never declared, because PKG-02 can only
 * fire if the undeclared ones survive this far.
 */
export interface CapsulePackage {
  readonly entries: ReadonlyMap<string, Uint8Array>;
}

export function createCapsulePackage(
  entries: Iterable<CapsuleEntry>,
): CapsulePackage {
  const map = new Map<string, Uint8Array>();
  for (const entry of entries) map.set(normalizeEntryPath(entry.path), entry.bytes);
  return { entries: map };
}

/** Package contents as a stream sorted by UTF-8 path bytes. */
export function capsuleEntries(pkg: CapsulePackage): CapsuleEntry[] {
  return sortCapsuleEntries(
    [...pkg.entries].map(([path, bytes]) => ({ path, bytes })),
  );
}

/** Structural JSON equality: key order is irrelevant, array order is not. */
export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;

  if (leftIsArray) {
    const a = left;
    const b = right as unknown[];
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
  );
}
