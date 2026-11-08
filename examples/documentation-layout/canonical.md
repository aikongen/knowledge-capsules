# Documentation layout

Apply these rules when you add, move or name a documentation file, or decide where a repository's documents live. They say where a document goes and what opens it; how its text is written is a separate subject. A repository's own recorded layout wins over these rules, because it records a choice made for that repository.

## Where a document goes

- Keep each product's documentation in that product's own repository, because the documentation then changes in the same commit as what it describes.
- Put each page under `docs/` in the folder that matches its kind: `tutorials/` teaches by doing, `how-to/` solves one task, `reference/` lists facts and `explanation/` says why. The folder tells the reader what kind of help to expect before they open the page. Split a page that mixes two kinds into one page per kind.
- Keep the README of a package, app or tool beside its manifest, such as its `package.json`, and write it for someone who uses that package. Put instructions for someone who changes the package in a `CONTRIBUTING.md` beside it, because the user and the maintainer need different pages.
- Write a public repository's root `README.md` for the end user: the problem, the value, how to get it, how to open and use it the first time. Leave clone, build and test commands, project files and module names out of it, and end it with one line that links the maintainer guide, because the root README is the first page a newcomer sees.

## Decision records

- Record each decision set in `docs/decisions/` as one file named `NNNN-slug.md` with a four-digit number, and never reuse a number, because other pages and commits cite records by number.
- Open each record, after any front matter, with a heading and a line that gives the date, the status, what it supersedes and its source. The status is `proposed`, `accepted by the owner` with the date and where, or `superseded by NNNN`, so a reader can tell at once whether the record is in force.
- Let the newest record win. A record that reverses an earlier one names it, as in `Supersedes: NNNN item N`, and changes the older file's status line in the same commit. Keep the older text, so the history stays readable and nothing is deleted. Only the owner reverses a decision; an agent writes the superseding record when the owner asks, never on its own, because a reversal is itself a decision.
- Treat a record that is not yet accepted as `proposed`, and nothing in the repository acts on it as approved, because only the owner's acceptance makes a decision.

## Front matter

Apply this section when the repository builds a documentation site from its Markdown.

- Open every page that the site renders with front matter of plain `key: value` lines, because the site sorts pages by these keys and not by their text.
- Give every page `audience: consumer` or `audience: maintainer`. A consumer uses the product; a maintainer changes the repository. Without the key a reader building with the product has to find their pages among the maintainer's.
- Add `target` only on a consumer page, naming the one platform the page is for, so the page is listed with that platform's other pages.
- Add `order` as an integer when pages in one group need a fixed sequence, because the site otherwise sorts by title. Pages sort lowest first, and a page without it sorts last.
- Mark the one page that opens a category with `landing: true`. A category has at most one such page, because a second would compete for the same place.
- Make a test and the site build both fail on a page with no front matter, a wrong value or an unknown key, so a page that passes no check cannot be published.

## Navigation and generated pages

- Build the site's navigation from the pages and their front matter, never as a hand-written list, so a new file under `docs/` appears without a second edit that someone forgets.
- Open a package page with facts read from its manifest rather than typed by hand. For a private package, say it is private and used from a checkout or a packed build. For a public one, name the registry and say that the page cannot tell whether a release exists, because the manifest cannot.
- Make a check fail when a package README leaves out a runtime value the package exports or a stylesheet or data file it ships, so the README cannot fall behind the code it describes.

## What stays out

- On a documentation site written for consumers, publish only consumer pages. Maintainer pages and decision records stay in the repository and are read there. Leave them out of the site's navigation, its search index and any export written for AI agents, because hiding a page from the menu alone still leaks it through search and exports.
- Keep process records out of the repository: implementation notes, plans, reviews, audits, run accounts, evidence, prototypes and session handovers go in the checkout's git-ignored `.local/records/` folder and are never committed or pushed. The repository holds only what describes the product for its users and maintainers, such as the README, requirements, boundaries, design, guides, the maintainer guide and the owner's decisions, because process records describe the work, not the product, and go stale as soon as the work ends.
