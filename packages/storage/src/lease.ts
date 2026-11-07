import { mkdir } from "node:fs/promises";

import { KcError } from "@kc/contracts";
import { Database } from "./sqlite-driver.ts";
import { vaultLayout } from "./vault-layout.ts";

function guardFailure(cause: unknown): KcError {
  if ((cause as { code?: unknown }).code === "SQLITE_BUSY") {
    return new KcError("vault_locked", "another kc command is changing the vault; try again", {
      details: [{ at: "/runtime/lease.sqlite", message: "exclusive write guard is busy" }],
      retryable: true,
      cause,
    });
  }
  return new KcError("internal", `could not lock the vault: ${String((cause as Error).message ?? cause)}`, {
    details: [{ at: "/runtime/lease.sqlite", message: String((cause as Error).message ?? cause) }],
    cause,
  });
}

/**
 * One writer at a time: run `work` while holding an exclusive SQLite
 * transaction on runtime/lease.sqlite. The operating system drops the lock if
 * the process exits or crashes, so there is nothing to clean up. A second
 * writer waits up to `busyTimeoutMs` (default 5000) and then fails with the
 * retryable `vault_locked` error.
 */
export const DEFAULT_GUARD_WAIT_MS = 5000;

export async function withWriteGuard<T>(
  vaultRoot: string,
  work: () => Promise<T>,
  busyTimeoutMs: number = DEFAULT_GUARD_WAIT_MS,
): Promise<T> {
  const layout = vaultLayout(vaultRoot);
  await mkdir(layout.runtimeDir, { recursive: true, mode: 0o700 });
  let database: Database | undefined;
  try {
    database = new Database(layout.runtimeLeaseDatabasePath, { timeout: busyTimeoutMs });
    database.pragma(`busy_timeout = ${Math.trunc(busyTimeoutMs)}`);
    database.pragma("journal_mode = DELETE");
    database.exec("BEGIN EXCLUSIVE");
  } catch (cause) {
    try {
      database?.close();
    } catch {
      // The acquisition failure stays authoritative.
    }
    throw guardFailure(cause);
  }
  try {
    return await work();
  } finally {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Closing the connection releases the lock either way.
    }
    database.close();
  }
}
