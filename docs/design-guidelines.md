Draft from PRD.md, 2026-11-07, not yet approved

# Design guidelines for Knowledge Capsules

V1 has no graphical interface: "V1 is one binary with a command line and an MCP server" (PRD, Layer one scope). "Desktop app" and "research screens" are out of V1 (PRD, V1 Out). These guidelines cover command output and wording only.

## Command output and wording (convention, not PRD)
- Name every command, message and error for what it solves for the user, in plain words. Example: "capsules add" rather than a name for the mechanism.
- Offer the fewest options a moment needs. Cut the rest.
- No invented names. Use the PRD's own words: capsule, vault, trigger, kind, version, digest, manifest, publish, pin.
- An error says what happened and what to do next, in one or two lines. The PRD asks for "one error shape with a closed code list" (PRD, salvage table, contracts errors; the table is now in docs/maintainers/history/salvage.md); the user-facing wording of each code is convention, not PRD.
- A refused package says why: "A damaged or harmful package is refused with the reason" (PRD, User journeys, Share).
- Plain English for readers whose first language is not English. No idiom, no metaphor.
- A completed command answers in one or two lines: what is now true.
- Tool descriptions the agent sees are the capsule's one-line "use this when" trigger (PRD, What a capsule is). Keep them to one line.

## Future UI (convention, not PRD)
The PRD defers any UI. If one appears, it follows the Aikongen design system and brand tokens (not in this repository).
