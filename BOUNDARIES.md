Draft from PRD.md, 2026-11-07, not yet approved

---
convention: boundary-declaration/1
scope: Knowledge Capsules, layer one (local)
status: draft
decision-owner: PRD silent
updated: 2026-11-07
---

# Knowledge Capsules boundaries

What Knowledge Capsules owns, what belongs elsewhere and what is undecided. Every line cites PRD.md by section. Where the PRD says nothing, this file says "PRD silent".

## Purpose
- "knowledge is captured once and reused everywhere, by people and by AI agents" (PRD, Problem and intent).
- The product is "a shared, versioned space for knowledge: a vault of capsules" (same section).

## Owns
- The vault: "Local vault: drafts and published versions, publish with a chosen version, nothing changes after publish" (V1 In).
- The capsule format: "Capsule folder format with kind, trigger, versions and digest" (V1 In).
- The repo manifest: "one small file listing the capsules and versions this repo uses" (V1 In).
- The command line: "V1 is one binary with a command line and an MCP server" (Layer one scope).
- The MCP server, "four tools: list capsules with triggers, get a capsule, get an exact version by digest, report what was used" (V1 In).
- Export, import and the connect command (V1 In).
- Rules kept from the old design: "published versions are immutable and content-addressed; the vault files are canonical and any index is rebuildable; writes are atomic; imported content is data, never instructions" (Layer one scope).

## Belongs elsewhere
- The content of capsules: "The product is content-agnostic; only how a capsule is made differs" (Problem and intent). Who writes it: PRD silent beyond "the publisher".
- The version number: "the product never bumps a version itself" (Decisions locked, 3). The publisher owns it.
- The guideline files in the repos: "the files in the repo stay the working copy" (User journeys, Author publishes).
- Chat memory, notes, raw document storage, vector search, web crawling: "What the product is not: chat memory, a notes app, a store for raw documents, a vector database, or a web crawler" (Problem and intent).
- Hosted service, accounts, payment: layers two and three, not committed (Three layers; V1 Out).

## Interactions
- Agents reach the product "from Claude Code, Codex, OpenCode, Pi, a plain CLI and CI, on macOS, Linux and Windows" (Who it is for), through the MCP server ("MCP over standard input for agents") or the command line ("for people and CI") (Stack decision).
- Author publishes, consumer adds: "point the tool at the guideline files ... then capsules publish"; "capsules add aikongen/design-guidelines@2.1" (User journeys). Whether either needs more than the CLI and MCP: PRD silent.
- connect registers the MCP server "in that tool's config" (User journeys, New user).
- Data format between products beyond the capsule package: PRD silent.

## Undecided
From the PRD's open questions, the maintainer decides:
- Whether V1 also syncs capsule files into the repo, or the instruction-file stub is enough.
- Which kinds exist in V1 besides guidelines and research.
- What "report what was used" records.
- Whether the writer lease is kept or a simple lock file is enough.
- Which existing tool sets the standard for the binary build.
- Deferred, not decided: the research layer, resolution scoring and freshness, registry design, marketplace, archive, cross-capsule conflicts, signatures, desktop app, Pulse, learning candidates (PRD, Deferred).

## Out of V1 (PRD Out list, verbatim)
- The multi-stage research engine, runtime adapters and research screens
- Resolution scoring, the seven resolution statuses and freshness policies (a capsule is picked by trigger and name)
- Review pipeline, review receipts, independent reviewers
- Desktop app, Pulse, learning candidates
- Any hosted service, accounts, payment
- Cross-capsule conflicts, signatures, archive

## Examples
- In scope: publishing aikongen/design-guidelines as version 2.1 and pinning it in client (User journeys).
- Out of scope: a paid listing of a capsule (Marketplace, layer three, "Gate to start it: Demand shows up").

## Sources
PRD.md, 2026-11-07 version in this repository.
