# Documentation guidelines

## What these are

These are recommendations for writing Markdown documentation, each with its reason. They apply wherever the repository's own documentation convention is silent, including in a repository that has written no convention. Where the convention speaks, it wins, because it records a choice made for that repository. The rules that hold in every repository (the documentation core: only what is true now, the reason beside the rule, the documentation moves with the code, process records stay out) stand above both, and no convention sets them aside.

A repository departs from a recommendation by writing its choice and the reason in its convention. A session never departs silently, because a silent departure looks like a mistake to the next reader and the next session undoes it.

A rule is enforced only when a check fails on it, such as a test or a linter at error level that stops the commit. The rest of a convention, and every recommendation here, is guidance that writers and agents follow and reviewers read for, because nothing stops a change that breaks it.

On an existing page, apply these recommendations to each part your change edits or makes untrue, and do not rewrite the rest only to meet them, because they keep the documentation from getting worse and do not ask for a rewrite. Leave a decision record's status and the record numbers it supersedes in its opening line, because they tell the reader whether the record is in force.

## The unit of a page

- Make a page complete for its unit, so it can be read alone: a reader who lands on it from search, a grep or a link, or receives it on its own, finds everything about its unit there, because a reader who must assemble a fact from several pages misses one of them.
- The unit is the repository's choice: a thing a reader looks for, such as a command, a step or a setting, or a task, such as adding a domain or rotating a password. Choose it by counting a reader's path: take two real tasks, count the pages a reader opens for each with one candidate unit and with the other, and keep the unit with the shorter path. Record the unit and the reason in the repository's convention, because the next writer must cut new pages the same way.
- A worked example. In one repository, adding a step touched four files. For the task "add a step that runs my tests", a short page per thing with a separate page per option took a reader through four to six pages; one complete page per step took one. That repository chose one complete page per thing its user thinks in. Another repository may find that the task is its unit, for example when each task is done by a different person with a different authority.
- Order a page from short to exact, so a reader stops where they have enough: the name and one sentence, what it solves and for whom, how to use it with one real example, every option, how it behaves, what to keep in mind with each reason, and related pages. A page that explains a feature to the person who uses it follows the first part of that order: what the feature solves and for whom, how to use it with one real example, then its considerations, because a person reads from the top and stops once they have what they need.
- Give each fact one owning page: the page of the unit it belongs to. Another page that needs the fact says it in one line and links to the owning page, because nothing keeps repeated prose in agreement, and two copies of a fact drift until one is wrong. The one line keeps a page that is read alone complete enough to act on.
- Splitting pages by kind (a tutorial, a how-to, a reference, an explanation, each on its own page) is not used, because a page complete for its unit holds what, how and why together, and a reader of one thing would otherwise open a page of each kind.

## Evidence and accuracy

- Start from the intended reader, their task and the actual source. Read the authoritative pointers needed for a claim before making it. Project context is useful input when present; its optional fields are not mandatory sections.
- Use extra context only when it changes what helps the reader. More context does not require a longer introduction, more headings or a copy of every source.
- When sources conflict, keep the supporting and the refuting evidence, because a reader needs both to judge.
- Omit absent optional details rather than inventing them. An observed absence comes from a successful read or search. A denied, failed or unavailable read leaves the fact UNKNOWN; it does not prove absence. An adequate authoritative alternative may resolve that uncertainty.
- Keep unexecuted checks NOT_RUN. Source inspection can support a command example, but cannot prove that installation, first use, native loading or enforcement succeeded. Name the exact candidate and material limits when reporting evidence.
- Continue independent work when a required fact is UNKNOWN. Withhold the dependent claim or PASS until adequate evidence resolves it.
- Make every count or tree claim true at the commit that lands it, and give the command that regenerates it.
- Change authored sources and regenerate their projections with the project's documented tools.
- Verify links, local references and examples relevant to the changed surface. Use the consumer's actual corpus, navigation, build and rendered checks for a documentation site. Record each impacted page as updated, verified unchanged, or not needed with a reason; unavailable change history remains unverified.

## Writing the text

- Apply these recommendations to every Markdown file you write or change. When a repository names a different standard for one audience, such as a developer guide or an agent instruction file, follow that standard there and these recommendations everywhere else.
- Keep the entry point brief, with reachable detail for the reader's next task, because a reader decides from the first lines whether they are in the right place.
- Write to the reader as "you", in the present tense. Name who does what; use the passive only when the actor is unknown or beside the point.
- Write an instruction as a command, one per sentence, with its condition or warning first: "To delete the page, run ...". Put the common case before the exceptions. Do not write "simply", "easy" or "quickly" in a procedure.
- Use the short, everyday word, and cut every word that does no work. Write the real symbol, file, flag, command or message in code font, not a description of it, because a reader with grep finds a page by the literal string.
- Call each thing by one name and each action by one verb throughout a document.
- Keep "only" and "not" next to the word they change. Make each "it", "this" and "they" point at one obvious noun. End a sentence instead of joining clauses with a dash, and write "a, b, or both" instead of a slash.
- A heading states its point in sentence case. A page has one level-1 heading and skips no level. Use a numbered list for a sequence and bullets otherwise, introduced by a full sentence, with parallel items.
- Link text names where the link goes, never "click here".
- Link from a page to no file that exists only in your checkout, such as a git-ignored file, because another clone cannot open it.
- Write a page that a reader understands without looking anything up: name each thing by what it is, and leave out of the text every reference the reader would have to look up, such as a rule number, a decision number or the ID of another document, because a reader should not need a dictionary to read the page and such a reference can change while the page does not. Keep a name the reader types or sees, such as a command, a flag, a setting, a host or an error code, in the text in code font, because the reader needs it to act. Put links to sources, evidence, decision records and other material for agents at the bottom of the page, because in the text they bury what the reader came for.
- A pull request description is a briefing a reviewer reads in under a minute. Link logs, SHA lists and metric tables instead of pasting them.

## Writing a repository's own convention

Write a convention only where the repository differs from these recommendations, and only what differs, because a copy of the shared text drifts from it and a later change to the shared text no longer reaches the copy. Make these six decisions and record each with its reason. The recommended answer stands after each.

1. **Who reads the documentation.** Name each reader, such as the person who uses the product, the maintainer and an agent with grep, and the task each one comes with, because every other decision follows from the reader.
2. **How the documentation is browsed.** As a folder in the repository, which works with no menu. Name a site, or pages delivered alone to an agent, only where they exist today, because each way of reading adds layout rules of its own.
3. **The unit of a page.** Count a reader's path on two real tasks, as described above, and record the unit and the reason.
4. **The parts of a page and their order.** From short to exact, as described above.
5. **Where reasons stand.** Beside the rule or choice they explain, on the page that states it.
6. **What a check fails on.** Start with what a test can read from the text: no planned wording on a page, no link to a plan or to a git-ignored file, and links that resolve. Name the test, and call the rest of the convention guidance, because a rule that nothing checks is a recommendation whatever the convention calls it.

## Rationale

A reader needs relevant, trustworthy guidance and a clear next step. A page complete for its unit serves every way of reading, and matters most where there is no menu: a grep finds one page, and a page delivered alone keeps its content. One owning page per fact keeps the copies from disagreeing. Recommendations with reasons let a repository depart where its product needs it, and a convention that records only the departures stays short enough to keep true. Plain, unambiguous sentences are read once; a sentence with two readings is read twice and sometimes misread.

Applies to `**/*.md`.
