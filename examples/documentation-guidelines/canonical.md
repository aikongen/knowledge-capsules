# General Documentation

## Applicability

Applies to every Markdown document you write or change. Apply the rules on what is
true now, on feature pages, on planned work and links, on reasons and on text that
reads without a lookup to a new page and to each part of an existing page that your
change edits or makes untrue, and do not rewrite the rest of a page only to meet them,
because these rules stop the documentation from getting worse.

## Rules

- Start from the intended reader, their task and the actual source. Read the
  authoritative pointers needed for a claim before making it. Project context is
  useful input when present; its optional fields are not mandatory sections.
- Use extra context only when it changes what helps the reader. More context does not
  require a longer introduction, more headings or a copy of every source.
- On every page except a plan or a product requirements document, describe only what
  is true at the commit that lands the page: the behavior, status and prerequisites
  that exist now, because a reader acts on that page as the truth, while a plan or a
  product requirements document describes planned work. State a limit as what the
  product does not do now, not as what it will do, because a promise stays on the page
  after its plan is dropped. Mark no part of a page as planned, proposed or draft,
  because the mark stays on the page after the plan changes. When sources conflict,
  keep the supporting and the refuting evidence, because a reader needs both to judge.
- Omit absent optional details rather than inventing them. An observed absence comes
  from a successful read or search. A denied, failed or unavailable read leaves the
  fact UNKNOWN; it does not prove absence. An adequate authoritative alternative may
  resolve that uncertainty.
- Keep unexecuted checks NOT_RUN. Source inspection can support a command example, but
  cannot prove that installation, first use, native loading or enforcement succeeded.
  Name the exact candidate and material limits when reporting evidence.
- Continue independent work when a required fact is UNKNOWN. Withhold the dependent
  claim or PASS until adequate evidence resolves it.
- Keep the entry point brief and useful, with reachable detail for the reader's next
  task. Link to one authoritative explanation or reference instead of copying its
  governance, rules or implementation detail into every introduction.
- Change authored sources and regenerate their projections with the project's
  documented tools. Keep durable decisions and explanations beside what they describe;
  live assignments, raw traces and running status belong in private run state or the
  existing task system.
- Verify links, local references and examples relevant to the changed surface. Use the
  consumer's actual corpus, navigation, build and rendered checks for a documentation
  site. Record each impacted page as updated, verified unchanged, or not needed with a
  reason; unavailable change history remains unverified.
- Apply these rules to every Markdown file you write or change. When a repository
  names a different standard for one audience, such as a developer guide or an agent
  instruction file, follow that standard there and these rules everywhere else.
- Give a page one kind, and split and link rather than mix kinds, because a reader
  must know what help to expect: a tutorial teaches by doing, a how-to reaches a goal,
  a reference states facts for lookup, an explanation answers why, and a feature page
  explains one feature to the person who uses it. Write a feature page in this order:
  what the feature solves and for whom, how to use it with one real example, then its
  considerations, because a person reads from the top and stops once they have what
  they need.
- Write to the reader as "you", in the present tense. Name who does what; use the
  passive only when the actor is unknown or beside the point.
- Write an instruction as a command, one per sentence, with its condition or warning
  first: "To delete the page, run ...". Put the common case before the exceptions. Do
  not write "simply", "easy" or "quickly" in a procedure.
- Use the short, everyday word, and cut every word that does no work. Write the real
  symbol, file, flag or command in code font, not a description of it.
- Call each thing by one name and each action by one verb throughout a document.
- Keep "only" and "not" next to the word they change. Make each "it", "this" and
  "they" point at one obvious noun. End a sentence instead of joining clauses with a
  dash, and write "a, b, or both" instead of a slash.
- A heading states its point in sentence case. A page has one level-1 heading and
  skips no level. Use a numbered list for a sequence and bullets otherwise, introduced
  by a full sentence, with parallel items.
- Link text names where the link goes, never "click here".
- Make every count or tree claim true at the commit that lands it, and give the
  command that regenerates it.
- A pull request description is a briefing a reviewer reads in under a minute. Link
  logs, SHA lists and metric tables instead of pasting them.
- Keep planned work in a plan or a product requirements document that names the page
  it will change, because the reference then points from the plan to the page. Link
  from a page to no plan, the product requirements document included, because the page
  must stay true when the plan changes or is dropped. Link from a page to no file that
  exists only in your checkout, such as a git-ignored file, because another clone
  cannot open it.
- Write the reason for each rule and each consideration beside it, on the page that
  states it, because a reason kept elsewhere is not changed with the rule, and the
  reason lets the next reader judge a case nobody foresaw.
- Write a page that a reader understands without looking anything up: leave IDs, rule
  numbers, decision numbers and other codes out of the text, and name each thing by
  what it is, because a reader should not need a dictionary to read the page. Put
  links to sources, evidence, decision records and other material for agents at the
  bottom of the page, because in the text they bury what the reader came for.

## Rationale

A reader needs relevant, trustworthy guidance and a clear next step. A short
introduction and on-demand detail serve that outcome better than repeated rules or
invented completeness. Missing evidence should limit only the claims it affects. A
page that describes only what is true now can be trusted without checking what was
planned. One kind per page lets a reader trust what kind of help they are getting; a
feature page is one kind, written for the person who uses the feature. A reason kept
beside its rule keeps the why for the next reader. Text without codes reads without a
dictionary. Plain, unambiguous sentences are read once; a sentence with two readings
is read twice and sometimes misread.

Applies to `**/*.md`.
