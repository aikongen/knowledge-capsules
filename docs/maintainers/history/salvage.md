# Salvage (step 3)

Date: 2026-11-07. Source: the earlier prototype checkout, branch `integration/v0.1`, HEAD `ad2b011` (read-only; one untracked file there, not copied). Stack: Bun 1.4.2, TypeScript 7.0.2 (`tsc`, `"strict": true`), tests with `bun test`.

## Copied
Package names are kept (`@kc/*`). Per-package `package.json` keeps name, version, `exports`, workspace and runtime dependencies; build, lint and test scripts, dev dependencies and eslint/tsconfig files were dropped (root `package.json` and `tsconfig.json` replace them). All tests are the originals, with the changes listed under "Edits".

| Package | Source modules | Tests |
|---|---|---|
| `packages/capsule-format` | digest, jcs, manifest, paths, rules, validation, zip-writer, zip-reader, limits, plus jsonl, package, index (needed by the listed ones) | 10 files, 161 tests |
| `packages/domain` | ids, time, version-range, plus patterns, result, semver, lifecycle, materiality, scope, index (ids/validation/storage import them) | 7 files, 210 tests |
| `packages/storage` | atomic, lease (since trimmed to the SQLite guard, audit A3), sqlite, catalog-rebuild, vault-layout, index | 6 files, 110 tests: atomic, catalog-rebuild, lease (with `fixtures/lease-contender.ts`), sqlite, vault-layout, integration/sqlite-storage |
| `packages/source-ingestion` | gateway, network-policy, plus types, errors, http-transport, command-runner, artifact-sink (gateway needs them), index | 3 files, 51 tests: gateway, network-policy, command-runner |
| `packages/contracts` | errors only; plus schemas.ts and validator.ts (see below) | none (old `schemas.test.ts` not copied) |

`contracts` kept the name `@kc/contracts` (no import changes anywhere, the smaller change). It holds `errors.ts` as asked, and also `validator.ts` and `schemas.ts` with 7 of the 22 frozen schema files copied to `packages/contracts/schemas/` (capsule-manifest, evidence, knowledge-item, profile, source, source-acquisition, trace-event (runtime-record removed, audit A3)). Reason: domain derives its id/semver/digest patterns from the schemas at load time, and capsule-format, storage and source-ingestion validate against them. This goes beyond "contracts/errors"; it is the minimum that keeps the listed code working. The seven schema files are copies, not edits.

Fixtures: `fixtures/example-capsule/` is a copy of the old `templates/example-capsule/` (used by capsule-format and storage tests). Test paths were changed from `templates/` to `fixtures/`.

## Minimal pieces copied from cut packages
- `storage/src/resolver-corpus.ts`: copy of `contracts/src/resolver-corpus.ts` (types and `RESOLVER_TRUST_LEVELS`; sqlite.ts implements `ResolverCorpusPort`).
- `storage/src/trace-types.ts`: copy of `traces/src/types.ts` (TraceEvent and repository types that sqlite.ts implements).
- `storage/src/capsule-registry.ts`: copy of `application/src/registry.ts` (`parseCapsuleRegistry`, used by catalog-rebuild).
- `source-ingestion/src/collect-bounded-bytes.ts`: copy of `collectBoundedBytes.ts` from the external `context-kit` package (found in the old checkout's `node_modules`, not modified). Its own node:test tests were not copied.

## Cut
- Not copied (not on the list): research-engine, runtime-adapters, apps/*, client-sdk (old SDK), the MCP app, application, traces, test-fixtures, ui, eslint/typescript config packages, frozen contracts other than the 8 schemas, coordination/.
- `storage/src/capsule-lifecycle-repository.ts` and its 3 tests (repository, recovery, integration): depends on `@kc/application` lifecycle service, not on the list.
- `storage/src/vault-manifest.ts`: not on the list and nothing copied needs it; its export was removed from `storage/src/index.ts`.
- `source-ingestion/src/research-stage-executor.ts` and its test: depends on research-engine. Removed from `source-ingestion/src/index.ts`.
- Dropped dependencies: `better-sqlite3`, `@types/better-sqlite3`, `context-kit`, vitest, eslint, `@types/node`.

## better-sqlite3 to bun:sqlite
`storage/src/sqlite-driver.ts` is a 120-line adapter exposing the better-sqlite3 subset the code used (`prepare/run/get/all`, `exec`, `pragma`, `transaction().immediate/deferred`, `backup`, `open`, `inTransaction`, `name`, `close`) over `bun:sqlite`; `sqlite.ts`, `lease.ts` and two tests changed only their import line. API differences handled:
- `Statement.get()` returns `null` when no row (bun) vs `undefined` (better-sqlite3): the adapter maps null to undefined.
- Named parameters without prefix (`run({ recordId })`) need `strict: true`; the adapter turns it on.
- No `pragma()`: mapped to `PRAGMA` statements (`simple` returns the first column).
- No `timeout` option: mapped to `PRAGMA busy_timeout`.
- No `open` property: tracked by the adapter. `inTransaction` exists in bun:sqlite and is passed through.
- No `backup()`: replaced by `VACUUM INTO '<path>'` (async signature kept).
- Lease tests that spy on `Database.prototype.exec` work unchanged against the adapter class.
Not verified: that `SQLITE_BUSY` error codes match better-sqlite3 in every path beyond what the lease tests exercise (they pass).

## Edits to tests (vitest to bun:test)
- `from "vitest"` became `from "bun:test"`.
- `expect(x)` became `expect<unknown>(x)` at 17 call sites where bun's typed `toBe/toEqual` rejected a branded type against a string literal (domain ids, semver, time, lifecycle; capsule-format paths). No assertion changed.
- `it.runIf(cond)` became `it.if(cond)` (source-ingestion command-runner).
- `storage/test/atomic.test.ts`: `vi.hoisted`/`vi.mock("node:fs/promises")` rewritten with `mock.module` and a `mock(rename)`; same fault injection.
- `storage/test/lease.test.ts`: dropped the Node flag `--experimental-strip-types` from the contender spawn (`process.execPath` is bun).
- `storage/test/integration/...`: `new TraceService(storage).append(e)` became `storage.appendTraceEvent(e)` (TraceService only validated, then called the same method, which validates itself).
- Fixture path edits as above.

## Disabled tests
None. 0 skipped, 0 deleted.

## Network
No test makes a network call. Gateway and network-policy tests use fake `HostResolver` and `HttpTransport` objects. Checked by grep (no fetch/http server use in tests) and by running the whole suite with a preload that throws on `fetch`, `net.Socket.connect`, `dns.lookup` and `dns/promises` lookup/resolve: 590 pass, 0 fail. Gateway tests still run `git` and `bun` as local subprocesses.

## Proof
```
$ bun install
$ bun run check
$ tsc --noEmit -p tsconfig.json
(no errors)
$ bun test
 590 pass
 0 fail
 1152 expect() calls
Ran 590 tests across 26 files. [1420.00ms]
```
