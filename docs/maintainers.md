# Maintainer guide

For people who change Knowledge Capsules. Users read the [README](../README.md); the command reference is [cli.md](cli.md).

## Set up and check

```
git clone git@github.com:aikongen/knowledge-capsules.git && cd knowledge-capsules
bun install
bun run check    # type check
bun test         # all tests
```

## Build

The README banner is `assets/banner.png`, rendered from `assets/banner-source.html` with headless Chrome (`--window-size=1600,400 --force-device-scale-factor=2 --screenshot`), then reduced to 192 colours with `magick -colors 192 PNG8:`.

The README pictures are `assets/scenes/*.html`, rendered to the PNG beside each with headless Chrome (`--window-size=1600,1000 --force-device-scale-factor=1 --virtual-time-budget=6000 --screenshot`). The text in them is real `kc` output from a scratch vault; capture it again when the output changes.

Social preview: upload assets/social-preview.png under Settings → General → Social preview. It is rendered from `assets/social-preview-source.html` at `--window-size=1280,640 --force-device-scale-factor=1`.

```
bun run build        # macOS arm64 -> dist/kc
bun run build:all    # also dist/kc-linux-x64 and dist/kc-windows-x64.exe
```

Each is a single compiled Bun binary, about 63 MB on macOS, and needs no Node. Measurements and the Bun/Deno choice are in [stack-spike.md](maintainers/history/stack-spike.md).

## Layout

Bun workspace, `packages/*`:

- `packages/cli`: the `kc` binary and MCP server (entry `src/main.ts`).
- `packages/capsule-format`: capsule format and digest.
- `packages/domain` (ids, timestamps, version ranges), `packages/contracts` (the error shape and schemas), `packages/storage` (atomic writes, the SQLite index, the vault guard), `packages/source-ingestion` (policy-controlled fetch of web, file and git sources; kept, not used by the CLI yet): building blocks copied from the old code, see [salvage.md](maintainers/history/salvage.md).

Format documents: [capsule-format.md](capsule-format.md) (user page), [capsule-format-internals.md](maintainers/capsule-format-internals.md). Examples are in `examples/`.

## Run from source

`bun run packages/cli/src/main.ts <command>` runs `kc` without building. `kc connect` then writes `bun <main.ts> mcp` by absolute paths, with a note saying so.

## Vault internals

Plain files are canonical. `database.sqlite` is an index that can be deleted and rebuilt; nothing is stored only there. Location follows the XDG Base Directory spec (https://specifications.freedesktop.org/basedir-spec/latest/).

```
<vault>/
  vault.json                         {"schemaVersion":"0.1"}
  capsules/<namespace>/<name>/
    registry.json                    the list of this capsule's versions: version, digest, status, publishedAt, revision
    versions/<semver>/<digest hex>/  one published version: capsule.json, canonical.md (and any listed files)
  usage/<time>-<id>.json             one file per report_usage call
  runtime/                           lease.sqlite, the one-writer guard
  database.sqlite                    rebuildable index
```

- A published version never changes. A version directory is written once, atomically (staged, then renamed). Publishing the same id and version with another digest is refused (`immutable_version`); with the same digest it does nothing.
- One kc command changes the vault at a time (`publish`, `add`, `import`, index rebuild). Others wait up to 5 s, then fail with `vault_locked` ("another writer holds the vault"). The operating system drops the lock if the writer crashes. Readers (`mcp`, `export`) take none.
- The index is rebuilt from the version directories and `registry.json`. `kc status` rebuilds it when missing, unreadable, or its row count differs from the versions on disk; every write rebuilds it too. The MCP server reads files, never the index, so a missing index cannot block an agent.
- `kc.json` in a repository: see [cli.md](cli.md).

## Connect formats

`connect` registers the server named `kc`. Harnesses start a command name resolved on PATH, so the entry's command is:

- `kc`, when `kc` on PATH is the running binary;
- otherwise the absolute path of the running binary, with a one-line note that the entry breaks if the binary moves;
- from source, `bun <main.ts> mcp` by absolute paths.

The note's text is `NOTE_TEXT` in `packages/cli/src/connect.ts`. The instruction file each agent reads comes from its own documentation:

- claude-code, `CLAUDE.md`: https://code.claude.com/docs/en/memory
- codex, `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- opencode, `AGENTS.md`: https://opencode.ai/docs/rules/
- pi, `AGENTS.md`: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent

Once connected, `.mcp.json` holds an entry like `{ "mcpServers": { "kc": { "command": "kc", "args": ["mcp"] } } }`. When `$KC_VAULT` is set, it is written into the entry's environment (`env` in `.mcp.json`, `.pi/mcp.json` and Codex's `[mcp_servers.kc.env]`; `environment` in `opencode.json`).

| Target | Shape | Source | Status |
| --- | --- | --- | --- |
| claude-code | `{"mcpServers":{"kc":{"command":"...","args":["mcp"],"env":{...}}}}` | https://code.claude.com/docs/en/mcp | verified |
| codex | `[mcp_servers.kc]` with `command` and `args` | https://learn.chatgpt.com/docs/extend/mcp?surface=cli (was developers.openai.com/codex/mcp) | verified |
| opencode | `{"$schema":"https://opencode.ai/config.json","mcp":{"servers":{"kc":{"type":"local","command":["...","mcp"],"environment":{...}}}}}` | https://opencode.ai/docs/mcp-servers/ (checked 2026-11-07: `mcp.servers.<name>`, `$schema` https://opencode.ai/config.json) | verified against the current docs |
| pi | `{"mcpServers":{"kc":{"command":"...","args":["mcp"]}}}` | https://github.com/nicobailon/pi-mcp-adapter | unverified: pi needs the pi-mcp-adapter extension; not verified here. Pi has no built-in MCP |

Home is `$HOME` (`%USERPROFILE%` on Windows). A `opencode.json` or `.mcp.json` that is not a plain JSON object is refused rather than overwritten.

## MCP tools (exactly four)

| Tool | Input | Output |
| --- | --- | --- |
| `list_capsules` | none | JSON array of `{id, version, trigger}`: the versions in `kc.json` if the current directory has one, else the latest of every capsule in the vault |
| `get_capsule` | `id`, optional `version` | two text blocks: the core as JSON (`id, version, digest, kind, trigger, scope`), then the markdown content. Version: given, else in `kc.json`, else latest |
| `get_version` | `digest` (`sha256:...`) | same two blocks for that exact version; `isError` if unknown |
| `report_usage` | `capsule` (id), optional `digest`, optional `note` | writes `usage/<time>-<id>.json` with `reportedAt`, `capsule`, `digest`, `note`; returns `{recorded: true}` |

## Walkthrough (real binary)

Binary: `kc`, 63 MB, macOS arm64. Temp vaults, `KC_VAULT` set per command.

```
$ kc init
created the vault at .../w1
$ kc publish examples/design-guidelines
published surfaces/design-guidelines@1.0.1
$ kc publish examples/documentation-guidelines
published surfaces/documentation-guidelines@1.0.1
$ kc status
vault: .../w1
capsules: 2, versions: 2
$ kc export surfaces/design-guidelines@1.0.1 design.zip
exported surfaces/design-guidelines@1.0.1 to .../design.zip
$ KC_VAULT=w2 kc import design.zip
imported surfaces/design-guidelines@1.0.1
```

The fingerprint after export and import is the one from `publish` (`sha256:bec437fe...ca7a17` for design-guidelines 1.0.1).

## Records and decisions

- Task record, plan and decisions: kept locally by the maintainer (not in the repository). Decisions the public needs go to docs/.
- Documentation convention: [documentation.md](documentation.md). Design guidelines: [design-guidelines.md](design-guidelines.md).

## Known open items

- Open gaps: no `--vault` option, no way to keep or list drafts, the index staleness check compares counts only.
- The Pi connect entry (`.pi/mcp.json`) is unverified: pi needs the pi-mcp-adapter extension; not verified here.

## Cut a release

Releases are built and uploaded from this Mac. No GitHub Actions.

```
bun run build:all && mv dist/kc dist/kc-darwin-arm64 && (cd dist && shasum -a 256 kc-darwin-arm64 kc-linux-x64 kc-windows-x64.exe > SHA256SUMS) && gh release create vX.Y.Z --prerelease --title vX.Y.Z --notes "..." dist/kc-darwin-arm64 dist/kc-linux-x64 dist/kc-windows-x64.exe dist/SHA256SUMS
```

Drop `--prerelease` for a final release. The release has three binaries (`kc-darwin-arm64`, `kc-linux-x64`, `kc-windows-x64.exe`) and `SHA256SUMS`. `install.sh` (macOS, Linux) and `install.ps1` (Windows) download the latest release and check the SHA256. Public install line: `curl -fsSL https://raw.githubusercontent.com/aikongen/knowledge-capsules/main/install.sh | sh`. `install.ps1` has not been tested (no Windows machine).

macOS: downloads through `curl` or `gh` carry no quarantine flag; browser downloads do, so Gatekeeper blocks them until the flag is removed (the README gives the two commands). Signing and notarisation are left out by choice.
