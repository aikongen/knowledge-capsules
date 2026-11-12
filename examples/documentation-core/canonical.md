# Documentation core

Apply these rules whenever you write, change, move or review documentation in a repository, or decide where a document goes. This capsule holds in every repository that pins it. A repository's own written conventions add to it and do not set it aside, and the documentation recommendations (`aikongen/documentation-guidelines` for how a page is written, `aikongen/documentation-layout` for where it goes) apply only where those conventions are silent. So when two texts disagree, follow this order: this capsule, then the repository's own written conventions, then the recommendations. These rules hold whether or not a check enforces them. The first four are the author's own rules for every product, quoted in the author's words; the last two give every repository the same entry point and the same place for its convention, so that a reader moving between repositories finds both without a search.

## What a page says

- **Describe only what is true now.** Every page except the product requirements document describes the behaviour, status and prerequisites that exist at the commit that lands it, and marks no part as planned or proposed, because a reader acts on the page as the truth and a mark stays on the page after the plan changes. In the author's words: "Docs should only describe the "current state". So the truth."
- **Keep planned work in a plan that names the page it will change, never the other way.** Planned work lives only in a plan, kept with the process records, or in the product requirements document, kept in the repository. A page links to no plan, the product requirements document included, because the page must stay true when the plan changes or is dropped. In the author's words: "Planned should be in a plan (or similar) with a reference back to the docs. Not the other way around."
- **Keep the reason with the rule.** Every rule, choice and consideration on a page has its reason written down, on that page or in a file the page links to, because a rule without its reason cannot be judged in a case nobody foresaw. In the author's words: "It is very important that our "arguments"/"reasons" are also added and stored; so we keep the "why" for later reference."

## When a page changes

- **Update the documentation in the same commit as the code.** When a change alters what a user or maintainer would read, such as behaviour, setup, structure, an interface or a command, update every affected page in that commit, because a page that lags the code is untrue from that commit on. The author's reason: "so the documentation is always up-to-date".
- **On an existing page, apply these rules to each part your change edits or makes untrue,** and leave the rest as it is, because these rules stop the documentation from getting worse and do not ask for a rewrite.

## Where documents live

- **Keep process records out of the product repository.** Implementation notes, plans other than the product requirements document, reviews, audits, run accounts, evidence, prototypes and session handovers go in the checkout's git-ignored `.local/records/` folder and are never committed or pushed, because they describe the work, not the product, and go stale as soon as the work ends. The repository holds what describes the product for its users and maintainers: the README, the requirements, the boundaries, the design, the guides, the maintainer guide and the owner's decisions.
- **Make `docs/README.md` the index of the documentation.** It lists the pages and folders under `docs/`, each with one line on what a reader finds there, because a reader or an agent that arrives in any repository then finds the way in at the same place.
- **Keep the repository's own documentation convention at `docs/conventions/documentation.md`.** It holds only where the repository departs from or adds to the recommendations, each with its reason, and names the checks that fail on it. One fixed path lets every reader find the convention without a search, and a copy of the shared text would drift from it. A repository with nothing to add has no such file.

## What these rules leave out

- How the text of a page is written and which folder it goes in: those are recommendations, and the repository's convention may change them.
- Agent instruction files, changelogs and capsule content, which follow their own standards.
