# Writing a capsule

Apply these rules when you write, change or review a knowledge capsule. Each rule
carries one of two marks, so you know how far to trust it. **Observed** means it was
seen in use: in a trial with a coding agent, or in a decision the owner of this
capsule took. **Default** means it is the starting rule and has not been tested yet;
keep it until use shows otherwise.

## What a capsule is

- **One subject, complete in itself.** A reader who has nothing but the capsule can
  apply it, because a capsule travels alone: whoever reads it may not have your
  files, your repository or your site. Never send the reader elsewhere for the
  substance. Observed, owner's decision.
- **Knowledge, not documentation.** How to use a product belongs in that product's
  own documentation, because it changes with the product. A capsule holds rules
  that stay true wherever the reader works. Observed, owner's decision.
- **No personal working rules.** How an assistant behaves towards one person is
  not knowledge about a subject, so it stays out. Observed, owner's decision.
- **Named by author.** The id is `author/name`. The author part says who wrote and
  publishes it, nothing more, because every author may hold their own design or
  documentation rules and none of them is the global one. An internal-only
  capsule starts its name with `internal-`, for example `aikongen/internal-brand-tokens`,
  so the word is visible in every list without any tooling. Observed, owner's
  decisions.

## Writing the trigger

The trigger is the one line an agent reads in the capsule list, next to the "not
for" list from `scope.excludes`. It alone decides whether the capsule is opened,
because the content is read only after that decision.

- **Start with "Use when" and name the task in the agent's own verbs.** Write
  "Use when writing, changing or reviewing Markdown documentation", not
  "Guidelines for documentation", because the agent matches its task against the
  line, not a title. Observed: with no note in the agent's instruction file, the
  trigger line alone made a coding agent open the design capsule on a settings task.
- **Carry the case the agent would not think of.** An agent fixing a label does not
  think it is doing design, so a trigger that only says "designing" stays closed.
  Add the unasked case: "even when the request does not mention design". Default,
  taken from the makers of coding-agent skills, who report that agents open skills
  too seldom rather than too often.
- **One task per trigger.** When a trigger needs "or" between two different tasks,
  write two capsules, because a reader of the second task would otherwise carry
  the text of the first. Default.
- **Put what it is not for in `scope.excludes`.** The agent sees that list beside
  the trigger, so the trigger itself stays one positive line. Default.
- **Name the task, not the place.** Do not write the product, the author or "this
  repository" in the trigger, because the same capsule is pinned in many
  repositories. Default.
- **Do not list keywords.** An agent matches a task, not a tag cloud, so a list of
  nouns reads as noise. Default.

## Testing the trigger

A trigger is proven only on tasks it was not written for, because you can always
word a trigger to fit the three tasks you have in mind.

- **Write 10 to 20 realistic queries**, half that must open the capsule and half
  near-misses that share words with it but need something else. Realistic means
  the way a person types: a concrete task with a file name, a bit of backstory, a
  typo. Near-misses are what make the test worth running; "write a sorting function"
  as a negative for a design capsule tests nothing. Default, taken from the same
  makers.
- **Make each query a multi-step task.** An agent does not open a capsule for a
  task it can finish in one step, whatever the trigger says. Observed: a one-line
  control task opened nothing.
- **Run each query three times** and count how often the capsule opened, because a
  single run can go either way. A must-open query counts when it opened at least
  twice; a near-miss counts when it stayed closed at least twice. Default.
- **Keep the queries beside the capsule folder, never inside it.** They are your
  test material, not knowledge, and they may describe your own work. Default,
  following the owner's rule that a capsule holds only its knowledge.

## Writing the content

- **First line: when the rules apply.** Then the rules, most used first, because the
  agent reads the whole text in one call and acts on what it meets first. Default.
- **One rule per sentence, as a command, with its reason in the same sentence.**
  "Split before 2,000 words, because the agent reads the whole text in one call."
  A reason lets the agent apply the rule to a case you did not foresee; a bare
  "never" only tells it to stop. Default, taken from the makers of coding-agent
  skills, who treat ALWAYS and NEVER in capitals as a warning sign.
- **Give a do and a don't where a rule is easy to misread**, with the concrete
  words, not a description of them. Default.
- **State what the capsule excludes** in one short list, so a reader stops
  looking for what is not there. Default.
- **One mode per capsule.** Rules, or a procedure, or a reference table; not all
  three, because a reader must know what kind of help to expect. Default.
- **Short enough for one reading.** Stay under about 2,000 words; split before you
  pass it, because the whole text lands in the agent's context at once. Default.
- **One name per thing and one verb per action** throughout, because a second
  name reads as a second thing. Default.

Leave out of the content: links and "see X"; product names and file paths as the
source of a rule; running status, dates and counts that go stale; a rule you cannot
state without the reader asking someone.

## Changing a capsule

- **A new name is a new capsule.** Every reader who uses the old name must switch,
  and the record of its use starts over, so choose the name once. Observed: renaming
  two capsules meant re-adding them in every repository that used them.
- **Split before growing.** When a capsule needs a second trigger, make a second
  capsule, because one trigger can only name one task. Default.

## Before you publish

1. Read the trigger alone, as the list shows it. Would an agent with no other hint
   open it for the right task, and leave it closed for a near-miss?
2. Search the content for "see", "http", a file path, a date and a product name.
   Each one is a pointer to remove or a sentence to rewrite.
3. Read each "must", "never" and "always": does the sentence say why?
4. Confirm one subject, one mode, the excludes list and one name per thing.
5. Then publish, and test the trigger with the queries when it matters.
