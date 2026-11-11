# General Documentation

## Applicability

Applies to every Markdown document you write or change. Apply R3, R11, R21, R22 and R23
to a new page and to each part of an existing page that your change edits or makes
untrue, and do not rewrite the rest of a page only to meet them, because these rules
stop the documentation from getting worse.

## Rules

- R1. Start from the intended reader, their task and the actual source. Read the
  authoritative pointers needed for a claim before making it. Project context is
  useful input when present; its optional fields are not mandatory sections.
- R2. Use extra context only when it changes what helps the reader. More context does
  not require a longer introduction, more headings or a copy of every source.
- R3. On every page except a plan or a product requirements document, describe only
  what is true at the commit that lands the page: the behavior, status and
  prerequisites that exist now, because a reader acts on that page as the truth,
  while a plan or a product requirements document describes planned work. State a
  limit as what the product does not do now, not as what it will do,
  because a promise stays on the page after its plan is dropped. Mark no part of a
  page as planned, proposed or draft, because the mark stays on the page after the
  plan changes. When sources
  conflict, keep the supporting and the refuting evidence, because a reader needs
  both to judge.
- R4. Omit absent optional details rather than inventing them. An observed absence
  comes from a successful read or search. A denied, failed or unavailable read
  leaves the fact UNKNOWN; it does not prove absence. An adequate authoritative
  alternative may resolve that uncertainty.
- R5. Keep unexecuted checks NOT_RUN. Source inspection can support a command example,
  but cannot prove that installation, first use, native loading or enforcement
  succeeded. Name the exact candidate and material limits when reporting evidence.
- R6. Continue independent work when a required fact is UNKNOWN. Withhold the dependent
  claim or PASS until adequate evidence resolves it.
- R7. Keep the entry point brief and useful, with reachable detail for the reader's
  next task. Link to one authoritative explanation or reference instead of copying
  its governance, rules or implementation detail into every introduction.
- R8. Change authored sources and regenerate their projections with the project's
  documented tools. Keep durable decisions and explanations beside what they
  describe; live assignments, raw traces and running status belong in private run
  state or the existing task system.
- R9. Verify links, local references and examples relevant to the changed surface.
  Use the consumer's actual corpus, navigation, build and rendered checks for a
  documentation site. Record each impacted page as updated, verified unchanged,
  or not needed with a reason; unavailable change history remains unverified.
- R10. Apply these rules to every Markdown file you write or change. When a repository
  names a different standard for one audience, such as a developer guide or an agent
  instruction file, follow that standard there and these rules everywhere else.
- R11. Give a page one kind, and split and link rather than mix kinds, because a
  reader must know what help to expect: a tutorial teaches by doing, a how-to reaches
  a goal, a reference states facts for lookup, an explanation answers why, and a
  feature page explains one feature to the person who uses it. Write a feature page
  in this order: what the feature solves and for whom, how to use it with one real
  example, then its considerations, because a person reads from the top and stops
  once they have what they need.
- R12. Write to the reader as "you", in the present tense. Name who does what; use
  the passive only when the actor is unknown or beside the point.
- R13. Write an instruction as a command, one per sentence, with its condition or
  warning first: "To delete the page, run ...". Put the common case before the
  exceptions. Do not write "simply", "easy" or "quickly" in a procedure.
- R14. Use the short, everyday word, and cut every word that does no work. Write the
  real symbol, file, flag or command in code font, not a description of it.
- R15. Call each thing by one name and each action by one verb throughout a document.
- R16. Keep "only" and "not" next to the word they change. Make each "it", "this" and
  "they" point at one obvious noun. End a sentence instead of joining clauses
  with a dash, and write "a, b, or both" instead of a slash.
- R17. A heading states its point in sentence case. A page has one level-1 heading
  and skips no level. Use a numbered list for a sequence and bullets otherwise,
  introduced by a full sentence, with parallel items.
- R18. Link text names where the link goes, never "click here".
- R19. Make every count or tree claim true at the commit that lands it, and give the
  command that regenerates it.
- R20. A pull request description is a briefing a reviewer reads in under a minute.
  Link logs, SHA lists and metric tables instead of pasting them.
- R21. Keep planned work in a plan or a product requirements document that names the
  page it will change, because the reference then points from the plan to the page.
  Link from a page to no plan, the product requirements document included, because
  the page must stay true when the plan changes or is dropped. Link from a page to no
  file that exists only in your checkout, such as a git-ignored file, because another
  clone cannot open it.
- R22. Write the reason for each rule and each consideration beside it, on the page
  that states it, because a reason kept elsewhere is not changed with the rule, and
  the reason lets the next reader judge a case nobody foresaw.
- R23. Leave decision references, exact rule lists and other material for agents out
  of the text of a feature page, and link to that material at the end of the page,
  because a person reads for what matters to their use.

## Rationale

A reader needs relevant, trustworthy guidance and a clear next step. A short
introduction and on-demand detail serve that outcome better than repeated rules or
invented completeness. Missing evidence should limit only the claims it affects.
A page that describes only what is true now can be trusted without checking what
was planned. One kind per page lets a reader trust what kind of help they are
getting; a feature page is one kind, written for the person who uses the feature.
A reason kept beside its rule keeps the why for the next reader. Plain,
unambiguous sentences are read once; a sentence with two readings is read twice
and sometimes misread.

Applies to `**/*.md`.
