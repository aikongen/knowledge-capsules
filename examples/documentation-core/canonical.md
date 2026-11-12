# Documentation core

Apply these rules whenever you write, change, move or review documentation in a repository, or decide where a document goes. They hold in every repository. A repository's own documentation convention adds to them and does not set them aside, and the documentation recommendations (how a page is written and where it goes) apply only where that convention is silent. So when two texts disagree, follow this order: these rules, then the repository's own convention, then the recommendations. They are the owner's rules for every product, so when you find a reason to depart from one, ask the owner instead of departing.

## What a page says

- **Describe only what is true now.** A page describes the behaviour, status and prerequisites that exist at the commit that lands it, and marks no part as planned, proposed or draft, because a reader acts on the page as the truth and a mark stays on the page after the plan changes. In the owner's words: "Docs should only describe the "current state". So the truth." State a limit as what the product does not do now, not as what it will do, because a promise stays on the page after its plan is dropped.
- **Keep planned work in a plan that names the page it will change, never the other way.** A plan or a product requirements document describes planned work and is the one place for it. A page links to no plan, the product requirements document included, because the page must stay true when the plan changes or is dropped. In the owner's words: "Planned should be in a plan (or similar) with a reference back to the docs. Not the other way around."
- **Write the reason beside the rule.** Every rule, choice and consideration on a page carries its reason on the same page, because a reason kept elsewhere is not changed with the rule, and the reason lets the next reader judge a case nobody foresaw. In the owner's words: "It is very important that our "arguments"/"reasons" are also added and stored; so we keep the "why" for later reference." When you find a rule with no recorded reason, do not invent one: say so in your report, because an invented reason reads as the owner's.

## When a page changes

- **Update the documentation in the same commit as the code.** When a change alters what a user or maintainer would read, such as behaviour, setup, structure, an interface or a command, update every affected page in that commit, because a page that lags the code is untrue from that commit on. The owner's reason: "so the documentation is always up-to-date". Before you commit, search the documentation for each name your change touches, such as a path, a command, a setting or a host, because a sentence on another page goes stale without anyone seeing it.
- **On an existing page, apply these rules to each part your change edits or makes untrue,** and leave the rest as it is, because these rules stop the documentation from getting worse and do not ask for a rewrite.

## Where documents live

- **Keep process records out of the product repository.** Implementation notes, plans, reviews, audits, run accounts, evidence, prototypes and session handovers go in the checkout's git-ignored `.local/records/` folder and are never committed or pushed, because they describe the work, not the product, and go stale as soon as the work ends. The repository holds what describes the product for its users and maintainers: the README, the requirements, the boundaries, the design, the guides, the maintainer guide and the owner's decisions.
- **Make `docs/README.md` the index of the documentation.** It lists the pages and folders under `docs/`, each with one line on what a reader finds there, because a reader or an agent that arrives in any repository then finds the way in at the same place.
- **Keep the repository's own documentation convention at `docs/conventions/documentation.md`.** It holds only where the repository departs from or adds to the recommendations, each with its reason, and names the checks that fail on it. One fixed path lets every reader find the convention without a search, and a copy of the shared text would drift from it. A repository with nothing to add has no such file.

## What these rules leave out

- How the text of a page is written and which folder it goes in: those are recommendations, and the repository's convention may change them.
- Agent instruction files, changelogs and capsule content, which follow their own standards.
