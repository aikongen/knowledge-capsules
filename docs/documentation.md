Draft from PRD.md, 2026-11-07, not yet approved

# How this repository documents

The PRD names no documentation convention (PRD silent). Everything below is convention, not PRD, except where marked.

## Where things go
- PRD.md at the root: the product definition. It is the only source for BOUNDARIES.md and the design guidelines drafts.
- docs/: specs and guides. Today:
  - docs/maintainers/history/stack-spike.md: the Bun and Deno build comparison (PRD next step 2).
  - docs/maintainers/history/salvage.md: what was copied from the old repository (PRD next step 3).
  - docs/capsule-format.md: the capsule folder format (PRD next step 4).
  - docs/maintainers/capsule-format-internals.md: format details for maintainers.
  - docs/cli.md: the command reference. The vault layout is in docs/maintainers.md.
  - docs/maintainers.md: the maintainer guide (set up, build, layout).
  - docs/design-guidelines.md: this product's design guidelines (draft).
- Task records are kept locally by the maintainer and are not in the repository; decisions the public needs go to docs/.

## Decisions
No decision files exist in this repository yet. Private task records are not in the repository. A decision the public needs goes into the document it changes in docs/.

## Public README
The public README is for people who download, never for people who build. It gives download, first use and a link to the maintainer guide. Clone, build and test instructions live in docs/.

## Style (convention, not PRD)
Voice follows the Bro Code voice guide (not in this repository). Use en dashes, never em dashes. A revised document becomes a new version beside the old one when the maintainer has seen the old one.
