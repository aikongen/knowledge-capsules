# Documentation layout

## What these are

These are recommendations for where a document goes and how readers reach it, each with its reason. Apply them when you add, move or name a documentation file, or decide where a repository's documents live. A repository's own recorded layout, written in its documentation convention, wins over them, because it records a choice made for that repository; they apply where it is silent, including in a repository that has recorded no layout. The rules that hold in every repository, in the capsule `aikongen/documentation-core` (such as keeping process records out of the repository and `docs/README.md` as the index), stand above both. When you update to these recommendations, add that capsule too, because the rules it holds are no longer here.

A repository departs from a recommendation by writing its choice and the reason in that convention, never by a session deciding silently, because a silent departure looks like a mistake to the next reader and the next session undoes it. Do not move or rename an existing page, or a section of one, only to meet these recommendations, because moving it breaks its links.

## Lay out for each way the documentation is read

The same files can be read in several ways, and each way needs something different. Apply the part for each way your documentation is read today.

- **As a folder in the repository**, in the GitHub view, an editor, a clone or by an agent with grep. The file tree is the only menu, so make the folder work with no menu: name each folder and file for what a reader finds inside, keep the index page current, and link between pages by relative file path. The file name is the only label this reader sees, and a relative file link works in every clone and in the GitHub view.
- **On a site.** Give the site its menu, its order and its page addresses through front matter and the site's own configuration, never by moving or renaming files, because the same files must keep working as a folder and every move breaks a link.
- **As a page delivered alone**, such as a page an agent receives by name, an export or a pasted page. Keep its relative links for the folder reader, but make its text depend on none of them: the page says what the reader needs, and each link is extra, with link text that names what it points to, because a relative link leads nowhere outside the folder.

## Where a document goes

- Keep each product's documentation in that product's own repository, because the documentation then changes in the same commit as what it describes.
- Name a page after its unit, the thing or task the repository's convention makes one page, and put it directly in `docs/` until a group of pages shares one reader or one part of the product. Then give the group a folder named after that reader or part, such as `maintainers/` or `cli/`. Make a folder when its first page is written, because an empty folder promises pages nobody wrote. The folder that holds the repository's own documentation convention is the one exception, because its path is fixed for every repository.
- Keep a page that explains a feature to the person who uses it out of a folder of lookup facts, such as `reference/`, because a person looking for how to use a feature does not look among lookup facts.
- Sorting pages into folders by kind (`tutorials/`, `how-to/`, `reference/`, `explanation/`) as the main tree is not used, because a page complete for its unit mixes those kinds and the folder name then misleads.
- Keep a product's requirements document (PRD) in the repository where the repository's own layout puts it, as the committed plan that every checkout shares. It is the plan, so it describes planned work.
- Keep the README of a package, app or tool beside its manifest, such as its `package.json`, and write it for someone who uses that package. Put instructions for someone who changes the package in a `CONTRIBUTING.md` beside it, because the user and the maintainer need different pages.
- Write a public repository's root `README.md` for the end user: the problem, the value, how to get it, how to open and use it the first time. Leave clone, build and test commands, project files and module names out of it, and end it with one line that links the maintainer guide, because the root README is the first page a newcomer sees.

## Decision records

- Record each decision set in `docs/decisions/` as one file named `NNNN-slug.md` with a four-digit number, and never reuse a number, because other pages and commits cite records by number.
- Write a record into `docs/decisions/` only once the owner has accepted the decision. A decision not yet taken is planned work and lives in a plan, because a page in the repository describes only what is true now.
- Open each record, after any front matter, with a heading and a line that gives the date, the status, what it supersedes and its source. The status is `accepted by the owner` with the date and where, or `superseded by NNNN`, so a reader can tell at once whether the record is in force. An existing record with the status `proposed` keeps it until the owner decides, and nothing in the repository acts on it as approved.
- Let the newest record win. A record that reverses an earlier one names it, as in `Supersedes: NNNN item N`, and changes the older file's status line in the same commit. Keep the older text, so the history stays readable and nothing is deleted. Only the owner reverses a decision; an agent writes the superseding record when the owner asks, never on its own, because a reversal is itself a decision.

## Front matter

Apply this section when the repository builds a documentation site from its Markdown.

- Open every page that the site renders with front matter of plain `key: value` lines, because the site sorts pages by these keys and not by their text.
- Give every page `audience: consumer` or `audience: maintainer`. A consumer uses the product; a maintainer changes the repository. Without the key a reader building with the product has to find their pages among the maintainer's.
- Add `target` only on a consumer page, naming the one platform the page is for, so the page is listed with that platform's other pages.
- Add `order` as an integer when pages in one group need a fixed sequence, because the site otherwise sorts by title. Pages sort lowest first, and a page without it sorts last.
- Mark the one page that opens a category with `landing: true`. A category has at most one such page, because a second would compete for the same place.
- Set a page's address with a front matter key, such as `slug`, when the address must differ from the file path, because the file then stays where the folder reader expects it.
- Make a test and the site build both fail on a page with no front matter, a wrong value or an unknown key, so a page that passes no check cannot be published.

## Navigation and generated pages

- Build the site's navigation from the pages and their front matter, never as a hand-written list, so a new file under `docs/` appears without a second edit that someone forgets.
- Open a package page with facts read from its manifest rather than typed by hand. For a private package, say it is private and used from a checkout or a packed build. For a public one, name the registry and say that the page cannot tell whether a release exists, because the manifest cannot.
- Make a check fail when a package README leaves out a runtime value the package exports or a stylesheet or data file it ships, so the README cannot fall behind the code it describes.

## What stays out of a site

On a documentation site written for consumers, publish only consumer pages. Maintainer pages and decision records stay in the repository and are read there. Leave them out of the site's navigation, its search index and any export written for AI agents, because hiding a page from the menu alone still leaks it through search and exports.
