# Pattern: Secure Renderer Boundary

- Renderer has no direct Node integration.
- Context isolation and sandboxing are enabled.
- Preload exposes narrow domain methods with typed inputs/outputs.
- Main-process handlers validate payload and sender/frame context.
- Renderer code cannot call raw Electron IPC primitives.

This pattern is intentionally incomplete; it exists to exercise package files and retrieval.
