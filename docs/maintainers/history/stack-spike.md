# Stack spike: Bun vs Deno vs Go

Historical: the measurements below stay as the record. The `spike/` scripts were removed in the commit that added this line; restore any file with `git show <that-commit>^:spike/<file>`.

Date: 2026-11-07. Host: Apple Silicon Mac. Bun 1.4.2, Deno 2.9.8, TypeScript 7.0.2 (tsc, strict), `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7 (both pinned). Go not installed and not tried.

## Purpose
Decide whether the product (CLI plus MCP server, strict TypeScript, no Node runtime for end users, one standalone binary for macOS arm64, Linux x64, Windows x64, SQLite local index) is built with Bun, Deno, or Go. The spike was throwaway code in `spike/`.

## What was built
- `spike/server.ts`: MCP server over stdio (McpServer + StdioServerTransport), one tool `hello({name: string})` returning `Hello, <name>`. Same source for both runtimes. Bun resolves from `node_modules`; Deno from `spike/deno.json` import map (`npm:` specifiers).
- `spike/probe.ts` (JSON-RPC driver), `spike/bench.ts` (cold start), `spike/sqlite-check.ts` (`bun:sqlite`), `spike/sqlite-check-deno.ts` (`node:sqlite`).
- `tsc -p spike --noEmit` passes with `"strict": true`.

## Commands
```
cd spike && bun add @modelcontextprotocol/sdk zod   # then pinned to exact versions
bun build --compile --target=bun-{darwin-arm64|linux-x64|windows-x64} server.ts --outfile dist/bun-<target>[.exe]
deno compile -A --target {aarch64-apple-darwin|x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc} --output dist/deno-<target>[.exe] server.ts
bun probe.ts ./dist/<binary>          # initialize, notifications/initialized, tools/list, tools/call hello "Capsules"
bun bench.ts ./dist/<binary> 10       # 1 warm-up + 10 runs
```
Flags needed: none beyond `--target`/`--outfile`; Deno used `-A` (not narrowed). Cross-targets downloaded runtime bases on first use (network). One failure: `deno compile` of the SQLite check first failed type-check (`TS2584 Cannot find name 'console'`) because `spike/tsconfig.json` had `lib: ["ESNext"]`; fixed by adding `"DOM"`.

## Results
| Target | Runtime | Built | Size MB | Cold start median / max ms | Ran where |
|---|---|---|---|---|---|
| macOS arm64 | Bun | yes | 63.0 | 38.5 / 43.7 | this Mac: full probe OK |
| Linux x64 | Bun | yes | 82.0 | not measured | a Linux VPS (x86_64): initialize OK |
| Windows x64 | Bun | yes | 86.8 | not measured | not run (unverified) |
| macOS arm64 | Deno | yes | 85.0 | 74.4 / 77.4 | this Mac: full probe OK |
| Linux x64 | Deno | yes | 121.7 | not measured | a Linux VPS: initialize OK |
| Windows x64 | Deno | yes | 97.1 | not measured | not run (unverified) |

Sizes are `ls -l` bytes / 1e6. RSS at the initialize response (median of 10, `ps`): Bun 33.4 MB, Deno 58.7 MB. Cold start = spawn to `initialize` response, after one warm-up.
Both macOS binaries returned correct responses to initialize, tools/list (one tool, `hello`, schema `{name: string}` required) and tools/call (`Hello, Capsules`). Source runs under both runtimes too (`bun run`, `deno run -A`).

## SQLite
- Bun: `bun:sqlite` (built into the runtime). Compiled macOS arm64 binary (62.2 MB) created table, inserted, selected: `[{"id":1,"v":"capsule"}]`. Linux x64 binary ran the same on a Linux VPS.
- Deno: `node:sqlite` `DatabaseSync` works in Deno 2.9.8 and in the compiled macOS arm64 binary, same output. No FFI or `jsr:@db/sqlite` needed. Linux x64 binary ran the same on a Linux VPS.
- Windows: the SQLite check compiled for `bun-windows-x64` and `x86_64-pc-windows-msvc` without error, but it was not executed; Windows SQLite behavior is unverified. Both modules are runtime built-ins, so the cross target should ship them, but that is inference, not tested.
- Old storage package (the earlier storage package, read-only): `better-sqlite3` 13.0.3 (native addon) with `@types/better-sqlite3`. Neither runtime needs it; the storage package would need a port to `bun:sqlite` or `node:sqlite`. Not tested whether better-sqlite3 works under compile in either runtime.

## Cross-compile caveats
- Both toolchains cross-compile from macOS in one command; both downloaded target runtimes on first use (network needed once).
- Only Linux x64 outputs were executed off-host; Windows outputs were never run (no Windows machine used).
- Deno's output is much larger on Linux (121.7 MB) and embeds 15.9 MB of npm files.
- Deno Linux target used was `-gnu` (glibc); musl/older-glibc compatibility untested.
- Unsigned/unnotarized macOS binaries ran locally; Gatekeeper behavior for downloaded binaries untested.

## Recommendation: Bun
Reasons:
1. Smaller and faster measured on the same source: 63 vs 85 MB on macOS, 38.5 vs 74.4 ms cold start, 33 vs 59 MB RSS.
2. `bun:sqlite` works in the compiled binary with no extra dependency or flag; one command per target, no permission flags.
3. The SDK, `zod` and strict TypeScript worked unchanged, with ordinary `node_modules`/`bun install` resolution.

Main risk: Windows x64 was only built, not run, and Bun is the younger runtime for standalone distribution; a Windows run is the first follow-up check. `bun:sqlite` also ties storage code to Bun (a thin adapter keeps `node:sqlite` as an escape hatch).
Deno is a viable close second (all targets built and Linux ran, `node:sqlite` works); it lost on size and startup only.
Go would be the right fallback if the Windows binary fails to run or the compiled Bun binaries show a blocking defect (SQLite, stdio or signing/notarization) that cannot be fixed, or if binary size/startup targets become much stricter than ~60-90 MB and ~40-75 ms.
