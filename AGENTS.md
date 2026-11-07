# Agent guidance for Knowledge Capsules

## Purpose and status

This is the product repository for Knowledge Capsules. Start with PRD.md. Historical notes (the stack comparison, what was copied from the old code, what was extracted from the old documents) are under docs/maintainers/history/. Rely on the files, not on memory of earlier chats.

## Foundation

Six references. A reference marked "missing, to be added" has no file yet; do not invent one.

1. **How to document.** docs/documentation.md (draft). Modelled on a numbered-decision-file convention and the Bro Code voice guide (neither is in this repository).
2. **UX method.** Bro Code skills (local installation, see item 6): bro-discover, bro-prototype, bro-design-guidelines, bro-design-critique, bro-verify. Prototype before build (HTML scenes, one file per scene, a PNG each, new versions never overwrite old ones) and blind UX rounds per page.
3. **Branding and design guidelines.** Brand values: the Aikongen brand tokens (not in this repository). Design system: the Aikongen design guidelines (not in this repository). This product's own design guidelines: docs/design-guidelines.md (draft).
4. **Boundaries.** BOUNDARIES.md at the root, in the Bro Code boundaries format. Present (draft).
5. **Apple agentic tooling.** Applies only if Apple-platform work appears. Then, at the start of each such task, inspect and use Apple's agentic Xcode tools and skills and record which ran; if unavailable, report a blocker. This repository has no reference text or Xcode MCP registration yet: missing, to be added if needed.
6. **Bro Code.** Bro Code is installed locally on the maintainer's machine from the private aikongen/bro-code package and is not part of this repository. Where it is installed, every development request enters through the bro router. Bro Code grants no authority for agents, model calls, installs or trials.

## Rules

- Task records are kept locally by the maintainer and are not in the repository. Decisions the public needs go to docs/.
- Do not push anywhere without the maintainer's instruction.
