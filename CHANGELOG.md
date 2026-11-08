# Changelog

This file records user-visible changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- `kc check <folder>` and `kc check`: advice on a capsule, or on every capsule this repository uses, and on the words their triggers share. Advice only: it never blocks a publish, never scores, and exits 0.
- `kc publish` ends with one line pointing to `kc check` when there is advice.
- The MCP `list_capsules` items carry `notFor`, the capsule's `scope.excludes`, so an agent sees what a capsule is not for beside its "use when" line.
- `get_capsule` writes an `opened` record to the vault's usage log; `report_usage` records carry `event: "reported"`.

### Changed

- Example capsules renamed to the author namespace `aikongen/` (was `surfaces/`), with new versions: design-guidelines 1.2.0, documentation-guidelines 1.2.0, and two new ones, design-evidence-guidelines 1.0.0 and capsule-writing-guidelines 1.1.0.

## 0.1.0-preview.8 - 2026-11-07

### Changed

- The MCP server is registered as `KnowledgeCapsules` (was `kc`); `kc connect` migrates existing entries.

### Fixed

- `install.sh` replaces an installed `kc` as a new file; on macOS, copying over a running-before binary made the system stop it at start.
- `kc publish` takes the timestamp inside the write lock, and republishing identical content is a no-op, so two simultaneous first publishes of one folder end as one stored version instead of an `immutable_version` refusal.

## 0.1.0-preview.7 - 2026-11-07

### Fixed

- `kc connect codex` writes the tools approval setting so Codex can call kc without a prompt, and honours `CODEX_HOME`.
- `kc connect opencode` turns off OpenCode's code mode so the kc tools are direct.

### Changed

- Codex and OpenCode verified end to end (both call the kc tools and record usage).

### Known limits

- No Intel Mac build yet.
- Pi is not tested.
- The Windows installer is not tested.

## 0.1.0-preview.6 - 2026-11-07

### Changed

- The repository is renamed knowledge-capsules.

### Fixed

- `install.ps1` picks the newest release, including pre-releases.
- `install.sh` follows the renamed repository.

### Known limits

- No Intel Mac build yet.
- Pi is not tested.
- The Windows installer is not tested.

## 0.1.0-preview.5 - 2026-11-07

### Added

- Downloads: `kc-darwin-arm64` (macOS, Apple silicon), `kc-linux-x64`, `kc-windows-x64.exe` and `SHA256SUMS`.
- `kc connect` leaves a note for the agent in CLAUDE.md or AGENTS.md (`--no-note` skips it).

### Known limits

