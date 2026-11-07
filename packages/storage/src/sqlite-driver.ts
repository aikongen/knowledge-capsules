/**
 * Salvage adapter: the subset of the better-sqlite3 API that `@kc/storage`
 * used, implemented over Bun's built-in `bun:sqlite` so the product needs no
 * Node native addon. Differences from better-sqlite3 that this file absorbs:
 *
 * - `Statement.get()` returns `null` for "no row" in bun:sqlite; better-sqlite3
 *   returned `undefined`, and callers compare against `undefined`.
 * - bun:sqlite only accepts bare named-parameter keys in `strict` mode, which
 *   is turned on so `run({ recordId })` keeps working.
 * - There is no `pragma()`, `open`, `backup()` or `timeout` option; they are
 *   mapped to `PRAGMA` statements, a tracked flag, `VACUUM INTO` and
 *   `PRAGMA busy_timeout`.
 * - `transaction()` and `inTransaction` exist in bun:sqlite and are used as is.
 */
import { Database as BunDatabase, type Statement as BunStatement } from "bun:sqlite";

export interface DatabaseOptions {
  readonly readonly?: boolean;
  /** Milliseconds to wait on a locked database (better-sqlite3 `timeout`). */
  readonly timeout?: number;
}

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

type Binding = string | number | bigint | boolean | null | Uint8Array | Record<string, unknown>;

export class Statement {
  readonly #statement: BunStatement;

  constructor(statement: BunStatement) {
    this.#statement = statement;
  }

  run(...params: Binding[]): RunResult {
    return this.#statement.run(...(params as never[])) as RunResult;
  }

  get(...params: Binding[]): unknown {
    return this.#statement.get(...(params as never[])) ?? undefined;
  }

  all(...params: Binding[]): unknown[] {
    return this.#statement.all(...(params as never[]));
  }
}

export class Database {
  readonly #database: BunDatabase;
  readonly name: string;
  #open = true;

  constructor(path: string, options: DatabaseOptions = {}) {
    this.name = path;
    this.#database = options.readonly === true
      ? new BunDatabase(path, { readonly: true, strict: true })
      : new BunDatabase(path, { create: true, readwrite: true, strict: true });
    if (options.timeout !== undefined) {
      this.#database.exec(`PRAGMA busy_timeout = ${Math.trunc(options.timeout)}`);
    }
  }

  get open(): boolean {
    return this.#open;
  }

  get inTransaction(): boolean {
    return this.#database.inTransaction;
  }

  prepare(sql: string): Statement {
    return new Statement(this.#database.prepare(sql));
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  /** `pragma("x = 1")` sets; `pragma("x", { simple: true })` returns the value. */
  pragma(source: string, options: { readonly simple?: boolean } = {}): unknown {
    if (source.includes("=")) {
      this.#database.exec(`PRAGMA ${source}`);
      return undefined;
    }
    const rows = this.#database.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[];
    if (options.simple === true) {
      const first = rows[0];
      return first === undefined ? undefined : Object.values(first)[0];
    }
    return rows;
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): ((...args: Args) => Result) & {
    immediate: (...args: Args) => Result;
    deferred: (...args: Args) => Result;
  } {
    return this.#database.transaction(fn) as never;
  }

  /** Consistent copy of the live database; replaces better-sqlite3 `backup()`. */
  async backup(destination: string): Promise<void> {
    this.#database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  }

  close(): void {
    this.#database.close();
    this.#open = false;
  }
}

export default Database;
