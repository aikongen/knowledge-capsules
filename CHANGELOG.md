# Changelog

This file records user-visible changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

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

