# Electron Local Application Baseline — Illustrative Fixture

> This is a product test fixture, not the complete Electron production capsule. It demonstrates how accepted guidance, evidence handles, scope, and limitations fit together.

## Accepted baseline

Use an isolated, sandboxed renderer without direct Node integration. Expose only a narrow, typed preload API required by the UI. `[ev-context-isolation]` `[ev-sandbox]`

Treat IPC as an explicit trust boundary. Validate payloads and sender/frame context before privileged actions, and do not expose raw Electron IPC primitives to renderer content. `[ev-ipc-validation]`

## Limitations

This fixture does not cover packaging, signing, notarization, auto-update, application protocols, external navigation, local service authentication, or platform-specific lifecycle behavior. A resolver must return `partial` for tasks that materially depend on those subjects.
