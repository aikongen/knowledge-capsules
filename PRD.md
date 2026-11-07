Knowledge Capsules — PRD (redefinition)
7. nov. 2026
Why this document replaces the old PRD
This PRD is a redefinition, not a revision. It starts from the product's intent, not from the old requirement list. Nothing in the old PRD (300+ requirements, 14 open points) binds this one.
The old design stalled because the serving core between the build side and the clients was never built, and because the capsule shape was fixed for research output even where that did not fit. This document keeps what was proven and cuts the rest. The old repository never varied capsule structure by use case; only policy varied through profiles. Varying the structure by kind is new here.
Problem and intent
Knowledge Capsules exists so that knowledge is captured once and reused everywhere, by people and by AI agents. Today the same knowledge is copied between repositories and drifts, or is researched again at full cost with a different answer each time.
The product is a shared, versioned space for knowledge: a vault of capsules. A capsule is a self-contained, versioned bundle that an agent can find by its trigger, pull into context when the task calls for it, and cite back to its sources. The knowledge inside can be anything: design guidelines, documentation rules, fish biology, 3D printing. The product is content-agnostic; only how a capsule is made differs.
Two things the old product got right and this one keeps: resolve before research (ask the vault first), and keep the evidence (results stored, sources kept for provenance, bloat left out).
What the product is not: chat memory, a notes app, a store for raw documents, a vector database, or a web crawler.
Who it is for and the three use cases
The first users are the maintainer and the agents working in the maintainer's repositories. Agents reach the product from Claude Code, Codex, OpenCode, Pi, a plain CLI and CI, on macOS, Linux and Windows.
Three use cases shape the design. Only the first is built now; the other two are kept in view so the format does not block them.
Use case
Who
Knowledge
What they need
1. Shared guidelines across repos
The maintainer; today the guidelines are split between two repositories
Design, UX, brand and documentation guidelines that apply to every company repository
Publish once, list which capsules a repo uses, agents pick the right one by its trigger, no stale copies
2. Versioned distribution inside an organisation
An agency with about a hundred client repositories
One documentation guideline maintained by one team
A served registry: publish, pin, see who is on which version, roll out an update without touching 100 repos
3. Marketplace
An expert selling domain knowledge "like on a bottle"; a buyer whose generic model becomes a specialist
Niche, local, proprietary or fast-changing knowledge the model is thin on
Listing, payment, scoped access; content served into context, never handed over as a file
Research (building a capsule from sources when the knowledge does not exist yet, as with the behaviour of pike for an angling app) is a way of making capsules, not a use case of its own. It is a later layer on the same format.
What a capsule is: thin core, optional layers
A capsule is a folder with a thin required core and optional layers. The capsule declares a kind, and the kind says which layers are required. This replaces the old fixed shape, where every capsule needed knowledge items and verified evidence.
Core (every capsule)
• Identity: namespace and name, such as aikongen/design-guidelines
• Version: semantic version chosen by the publisher; a content digest computed on publish; published versions never change
• Scope: what it covers and excludes
• Trigger: a one-line "use this when" description, written once by the author, shown to agents the way a skill description is
• Kind: which optional layers apply
• Content: markdown files, condensed for an AI to consume
Optional layers
Layer
What it adds
Required by kind
Items
Atomic statements with a kind (claim, procedure, warning, known unknown...), status and confidence
research
Evidence
A record per item pointing to an exact place in a source, with a relation (supports, contradicts, qualifies) and verification status
research
Sources
Fetched copies with licence, rights and fetch outcome
research
Profile
The policy the capsule was built under
research
A guidelines capsule is content plus the core. A research capsule adds items, evidence and sources. Both live in the same vault, version the same way, and are fetched by the same tool.
Two rules on the format that later layers depend on: a capsule is self-contained and portable (export, import into another vault, same digest), and a capsule can be marked serve-only so a registry hands out context slices instead of the file.
The three layers: local, team registry, marketplace
The product is built in three layers, in order. Only layer one is committed. Each later layer reuses the same capsule format and the same agent tools; it changes where the capsules live and who may fetch them.
Layer
What it is
Gate to start it
Pros
Cons
1. Local
Capsule format, local vault, repo manifest, publish and pin, MCP resolve tool. The maintainer's guidelines as the first capsules
Now
Small, finishable, fixes the duplicated-guidelines problem immediately
Proves the format, not the business
2. Team registry
The same tools behind a hosted server, private per organisation: accounts, publish, pin, update notices, served content
Layer one used daily for weeks
Where the agency-type value appears; sellable on its own
You run a service: auth, uptime, support
3. Marketplace
Public listing, payment, scoped tokens, serve-only capsules on top of layer two
Demand shows up
The largest upside
Hardest part; market unproven; copying and quality trust are real problems
Why served, not sold as files: once a capsule is a file, one sale makes it loose. Serving context slices through the resolve tool is the only serious answer to copying, and it is also what a company registry needs. For a maintainer's own guidelines, local files are better: no server in the loop, works offline, nothing to protect.
Layer one scope: what V1 does and does not do
V1 is one binary with a command line and an MCP server, and the maintainer's guidelines as the first capsules. It is done when the repositories that use the design and documentation guidelines pull them from the vault and the maintainer has used it for a week.
In
• Capsule folder format with kind, trigger, versions and digest; the guidelines kind fully, the research kind as format only
• Local vault: drafts and published versions, publish with a chosen version, nothing changes after publish
• Repo manifest: one small file listing the capsules and versions this repo uses; add, update and remove commands; an optional stub written into the repo's instruction file for agents without the tool
• MCP server with four tools: list capsules with triggers, get a capsule, get an exact version by digest, report what was used
• Export and import of a capsule as a package, same digest on both sides, harmful packages refused
• connect command that registers the MCP server in Claude Code, Codex and the other harnesses
Out
• The multi-stage research engine, runtime adapters and research screens
• Resolution scoring, the seven resolution statuses and freshness policies (a capsule is picked by trigger and name)
• Review pipeline, review receipts, independent reviewers
• Desktop app, Pulse, learning candidates
• Any hosted service, accounts, payment
• Cross-capsule conflicts, signatures, archive
What V1 keeps from the old design's rules: published versions are immutable and content-addressed; the vault files are canonical and any index is rebuildable; writes are atomic; imported content is data, never instructions; one language for the whole product.
User journeys for V1
New user, three commands. Download one file or run a one-line installer; no Node, no setup. In a project run kc init, then kc add <name>@<version> from a local folder (later: a registry). Run kc connect claude-code (or codex, opencode, pi), which registers the MCP server in that tool's config. From then on every agent session in that project sees the capsules and their triggers.
Author publishes guidelines. In the repository that holds the guidelines, point the tool at the guideline files and declare them a capsule: name, scope, trigger, kind guidelines. Edit the files, then kc publish with a version. The vault stores the version with its digest; the files in the repo stay the working copy.
Consumer repo uses them. In a consuming repository, kc add aikongen/design-guidelines@2.1. The manifest records name, version and digest. The repo's design.md may say "for layout rules, read the design-guidelines capsule" as a backup pointer; the main trigger is the capsule's own description, seen by the agent through the tool.
Agent in a task. The agent sees "design-guidelines: use when building or changing UI" in its tool list, fetches the capsule when the task matches, works from it, and reports what it used. Nothing is copied into the repo.
Update. The author publishes 2.2. In the consuming repository, kc status shows an update is available; the maintainer moves the pin or leaves it. The old version stays readable.
Share. kc export writes a package; kc import in another vault gives the same digest. A damaged or harmful package is refused with the reason.
Stack decision and trade-offs
Decision: TypeScript everywhere, with the local tool compiled to a standalone executable so nobody installs Node. Go stays as the fallback if the standalone build causes trouble, especially on Windows.
The constraints that drove it: speed matters because an MCP server is spawned per agent session; Node installs across machines have already caused problems and must not be forced on users; the maintainer is a strong front-end developer who can read and inspect TypeScript but would have to trust AI-written Go or Rust fully; and one language across the local tool and the later registry means one implementation of the capsule rules and one set of failure modes to learn.
Option
Startup
Install
Maintainer can inspect
Binary size
Maturity on Windows
TypeScript + Bun compile
~100 ms
One file
Yes
50-90 MB
Younger; test early
TypeScript + Deno compile
~100 ms
One file
Yes
50-90 MB
More mature than Bun
Go
A few ms
One file
No
5-15 MB
Proven
Rust
A few ms
One file
No
3-10 MB
Proven; slow compiles
Storage: the vault is plain files (canonical), with SQLite only as a rebuildable index. Transport: MCP over standard input for agents, a command line for people and CI, HTTP added in layer two with the same code behind it.
First engineering task: a throwaway hello-world MCP server compiled with Bun and Deno, run on macOS, Linux and Windows, to settle the choice before any product code.
What to salvage from the old repository
Done. The record of what was copied is docs/maintainers/history/salvage.md.
Decisions locked now, decisions deferred, open questions
Locked now (because layers two and three depend on them)
1. A capsule has a thin core and optional layers; the kind decides what is required.
2. Every capsule carries its own trigger text; repos list capsules, agents pick by trigger.
3. Published versions are immutable, content-addressed, and chosen by the publisher; the product never bumps a version itself.
4. A capsule is self-contained and portable: export and import keep the digest.
5. Served capsules go through the resolve tool as context slices, never as files; this is a per-capsule flag, off by default.
6. One language, TypeScript, across the local tool and any later service; the local tool ships as a standalone binary.
Deferred (not decided, not blocking)
• The research layer: how a research capsule is built, which checks it must pass, who reviews it
• Resolution scoring and freshness, the seven statuses, context pack sizes
• Registry design: accounts, tokens, update notices
• Marketplace: listing, payment, quality trust, how buyers evaluate before buying
• Archive, cross-capsule conflicts, signatures, a desktop app, Pulse, learning candidates
Open questions
[ ] Does V1 also sync capsule files into the repo for tools that cannot call MCP, or is the instruction-file stub enough?
Evidence so far: a trial showed that the note in the instruction file makes the agent read the capsule, so the stub looks sufficient.
[ ] Which kinds exist in V1 besides guidelines and research? (Candidates: playbook, reference.)
[ ] What does "report what was used" record in V1: items cited, or only which capsule was fetched?
Evidence so far: report_usage records the capsule, its digest and a note.
[ ] Is the writer lease from the old code worth keeping in V1, or is a simple lock file enough for one user?
Evidence so far: the lease was trimmed to the SQLite guard.
[ ] Does an existing tool in Go or Rust set the standard for the binary build?
Evidence so far: Bun was chosen for the build.
Next steps
1. Replace the earlier PRD with this document. (done)
2. Build throwaway: a hello-world MCP server compiled with Bun and with Deno, run on macOS, Linux and Windows. Pick one, or fall back to Go. (done)
3. Salvage: copy the packages in the salvage table from the earlier prototype into this repository, strip the rest, get them compiling and tested under the chosen build. (done)
4. Define the capsule folder format and the repo manifest as files first, with the design and documentation guidelines as the first two capsules. (done)
5. Build the vault, publish, add, connect and the four MCP tools. (done)
6. Wire the repositories that use the guidelines to the vault and use it for a week before deciding anything about layer two.
