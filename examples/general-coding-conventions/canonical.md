# General coding conventions

Apply these rules whenever you write, change, test or review code. A repository's own written rules win over them, because they record choices made for that repository.

## Decide what to build

- Before building, ask whether the code needs to exist at all, because code that is not written needs no test, review or upkeep.
- Reuse what the repository, the standard library, the platform or an installed dependency already does before writing new code, and prefer a proven tool over custom infrastructure, because a proven tool has already met the cases you have not thought of.
- Build the smallest complete journey for the person who uses the result, not the smallest diff. Call a feature done when that journey works end to end, not when it compiles, because a working outcome earns more trust than a general mechanism nobody yet needs. Keep reassessing the affected design against the intended outcome and, within the task, replace what does not fit when that brings a concrete benefit, because existing code does not justify an unsuitable model.
- Add no abstraction, dependency or boilerplate nobody asked for. Wait for two real consumers before adding an abstraction, unless safety, authority or interoperability needs it sooner, because an abstraction with one consumer only guesses at the second.
- Prefer deletion to addition, simple to general and boring to clever, because the next reader has to understand every line you keep.
- When you replace something, update its callers, tests and documentation, then delete the old path, so two ways of doing one thing do not drift apart.
- When your change builds a part that a plan describes and that a user or maintainer needs described, write that part's description and its reasons on its documentation page in the same commit, and create the page when none exists, because the page then becomes true together with the code and the why is not left behind in the plan. Before you commit, search the documentation for each name your change touches, such as a path, command, setting or host, and correct each sentence your change makes untrue, because a sentence on another page goes stale without anyone seeing it. Leave other pages as they are, because this rule only stops the documentation from getting worse.
- Keep compatibility only for an identified commitment or a real consumer's constraint, because compatibility kept for nobody is code kept for nobody.

## Write the code

- Name code and tests for their intent, because a name that explains itself saves the reader from tracing a definition.
- Keep functions small and single-purpose, and comment only a reason that the code cannot show, because a comment that repeats the code goes stale and then misleads.
- Keep side effects at the boundary and make them injectable, with mutable state behind explicit seams, because small pure functions are easier to test and to reason about.
- Validate external input, paths and credentials before any effect, so bad input fails before it changes anything.
- Run a child process with an argument list, not a shell string, because a shell string invites quoting mistakes and injection.
- Treat names, error messages and recovery instructions as part of the experience for the next maintainer: an error says what happened and what the reader can do, because they meet it without your context.
- Write shared text files as UTF-8 with LF line ends and use paths relative to the repository, so the files behave the same on every machine.

## Check that it works

- For a behavior change, write a test that fails before the change and passes after it, because a behavior change with no test is a claim nothing will notice when it stops being true. Prose fixes, one-line configuration or manifest edits, and spikes explicitly scoped as throwaway do not need one.
- Reproduce a reported defect before you accept a fix, because a fix for a defect nobody reproduced may fix something else.
- See every new check fail at least once, because a check never seen failing cannot be told from one that cannot fail.
- Prove a claim at the smallest layer that can prove it (unit, integration, contract or end to end), because proving the same behavior again one layer up adds cost without new signal.
- Cover a feature with a positive, a negative and a degraded case, because tests that prove only the happy path have not proven the feature.
- Keep tests hermetic: use fixtures and temporary directories, and no real time, network, shared state, home directory or personal data, because a test that depends on them does not repeat across machines or runs.
- Do not copy the implementation's logic into a test's expected values, because the test then repeats the bug it should catch.
- Prove that the exact candidate works, through a real boundary when the claim depends on one. Treat what you remember about a tool or library as a guess and confirm it from the installed source or current documentation, because what you remember is training data that differs between models and goes stale.
- Report a check you did not run as `NOT_RUN`, and a value nobody observed as `UNKNOWN`, never as a pass, because a reader acts on what the report says was proven.
- Before you change a dependency, check its version, license and install behavior, then pin it and keep the lockfile, so every machine builds the same thing.
- Have someone independent of the author review every change to behavior or an interface, because the author reads what they meant, not what they wrote.

## Use git safely

- Fetch first and work from the latest `origin/main` in your own branch or worktree, never in a checkout someone else is using, because a stale or shared checkout mixes your work with work you cannot see.
- Never use `git stash` in a shared checkout; commit to your own branch instead, because a stash is invisible to everyone else and easy to lose.
- Make each commit one logical change, with a plain imperative subject of at most 72 characters and no AI attribution or session links, because reviewers, bisecting and changelogs all read commits one at a time.
- Integrate into `main` and other shared branches by merge commit only. Do not squash, rebase, cherry-pick or force push there, because each of these rewrites history or copies commits under new identities, so others can no longer trace what they built on.
- Do not push with `--all`, `--branches` or `--mirror`, because they publish branches you did not mean to share.
- Tag, publish, release, deploy or run a destructive data operation only on an explicit instruction, because these steps cannot be taken back.
- Keep secrets, credentials, private machine paths and raw run state out of git. A configuration file holds an opaque reference to a secret, never the secret, because anything committed spreads to every clone.
- Preserve work that is not yours: leave unrelated settings and dirty or unmerged work in place, and clean up only what you created, because another writer may still need it.
