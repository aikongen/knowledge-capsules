# Writing a capsule

Apply these rules when you write, change or review a knowledge capsule. Each rule
carries one of two marks. **Observed** means it was seen in use: in a six-run trial
with Claude Code on 2026-11-07, or in a decision the owner took on the same day.
**Default** means it is the starting rule and has not yet been tested; keep it
until the usage log says otherwise.

## What a capsule is

- **One subject, complete in itself.** A reader who has nothing but the capsule can
  apply it. Never send the reader to a file, a repository or a site for the
  substance. Observed: the owner's decision of 2026-11-07, "that guideline should
  not just point to somewhere else".
- **Knowledge, not documentation.** How to use a product belongs in that product's
  own documentation. A capsule holds rules that stay true wherever the reader works.
  Observed: owner's decision of 2026-11-07.
- **No personal working rules.** How an assistant behaves towards one person is not
  product knowledge and stays out. Observed: owner's decision of 2026-11-07.
- **Named by author.** The id is `author/name`. The author part says who wrote and
  publishes it, nothing more. An internal-only capsule starts its name with
  `internal-`, for example `aikongen/internal-brand-tokens`. Observed: owner's
  decisions of 2026-11-07.

## Writing the trigger

The trigger is the one line an agent reads in the capsule list. It decides whether
the capsule is opened at all.

- **Start with "Use when" and name the task in the agent's own verbs.** Write
  "Use when writing, changing or reviewing Markdown documentation", not "Guidelines
  for documentation". Observed: with no note in the agent's instruction file, the
  trigger line alone made Claude Code open the design capsule on a settings task.
- **One task per trigger.** When a trigger needs "or" between two different tasks,
  write two capsules. Default.
- **Keep what it is not for in `scope.excludes`, not in the trigger.** Default.
- **Do not name the product, the author or "this repository" in the trigger.** The
  same capsule is pinned in many repositories. Default.
- **Do not list keywords.** An agent matches a task, not a tag cloud. Default.
- **Check it against three tasks** before publishing: one that must open the capsule,
  one that must not, one on the edge. Observed: in the trial a task about neither
  capsule opened nothing, and a documentation task opened the documentation
  capsule only when the instruction file asked for a list first. A trigger is not
  proven until the "must not" task stays closed.

## Writing the content

- **First line: when the rules apply.** Then the rules, most used first. The agent
  reads the whole text in one call, so order by use, not by theme. Default.
- **One rule per sentence, as a command, condition first.** "To rename a capsule,
  publish a new id." Default.
- **Give a do and a don't where a rule is easy to misread**, with the concrete
  words, not a description of them. Default.
- **State what the capsule excludes** in one short list, so a reader stops looking.
  Default.
- **One mode per capsule.** Rules, or a procedure, or a reference table; not all
  three. Default.
- **Short enough for one reading.** Stay under about 2,000 words; split before you
  pass it. Default.
- **One name per thing and one verb per action** throughout. Default.

Do not put in the content: links or "see X"; product names and file paths as the
source of a rule; running status, dates or counts that go stale; a rule you cannot
state without the reader asking someone.

## Changing a capsule

- **Any changed text is a new version.** Readers pin a version; they see your change
  only when they update. Observed: this is how `kc` works.
- **A new name is a new capsule.** Every repository that pinned the old name must
  re-add the new one and the usage log starts over. Choose the name once.
  Observed: renaming two capsules on 2026-11-07 re-pinned two repositories.
- **Split before growing.** When a capsule needs a second trigger, make a second
  capsule. Default.

## Before you publish

1. Read the trigger alone, as the list shows it. Would an agent with no other hint
   open it for the right task, and leave it closed for the wrong one?
2. Search the content for "see", "http", a file path and a product name. Each one is
   a pointer to remove or a sentence to rewrite.
3. Confirm one subject, one mode, the excludes list and one name per thing.
4. Then publish.
