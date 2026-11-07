import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { KcError } from "@kc/contracts";
import { writeJsonAtomic } from "@kc/storage";

export const REPO_MANIFEST = "kc.json";

export interface Pin {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface RepoManifest {
  readonly schemaVersion: "0.1";
  readonly capsules: readonly Pin[];
}

export async function readRepoManifest(dir: string): Promise<RepoManifest | undefined> {
  let text: string;
  try {
    text = await readFile(join(dir, REPO_MANIFEST), "utf8");
  } catch {
    return undefined;
  }
  const value = JSON.parse(text) as { capsules?: unknown };
  if (!Array.isArray(value.capsules)) {
    throw new KcError("validation_failed", `${REPO_MANIFEST} has no capsules list`);
  }
  return { schemaVersion: "0.1", capsules: value.capsules as Pin[] };
}

export async function writeRepoManifest(dir: string, pins: readonly Pin[]): Promise<string> {
  const path = join(dir, REPO_MANIFEST);
  const sorted = [...pins].sort((a, b) => (a.id < b.id ? -1 : 1));
  const result = await writeJsonAtomic(path, { schemaVersion: "0.1", capsules: sorted });
  if (!result.ok) throw result.error;
  return path;
}

/** Entries are unique by capsule id: setting a pin replaces the earlier one. */
export function withPin(pins: readonly Pin[], pin: Pin): Pin[] {
  return [...pins.filter((p) => p.id !== pin.id), pin];
}
