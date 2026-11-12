# Every command

`kc` keeps your capsules in a vault on your machine and tells your coding agent what is there.

## Commands

| Command | What it does | Example |
| --- | --- | --- |
| `kc init` | Create the vault. Other commands do this for you. | |
| `kc publish <folder>` | Save a capsule folder as a new version. The folder is not changed. A version that already exists with different content is refused. When `kc check` would have advice, one more line says how many pieces and which command to run. | `kc publish ./design-guidelines` |
| `kc check [folder]` | Advice on a capsule folder, without publishing. Without a folder, advice on each capsule this repository uses, and which triggers share many words. It never blocks and never fails for advice. | `kc check ./design-guidelines` |
| `kc add <id[@version]\|folder\|file.zip>` | Use a capsule in this repository. A folder is published first, a zip imported first. Without a version, the newest. | `kc add aikongen/design-guidelines@1.1.0` |
| `kc connect <claude-code\|codex\|opencode\|pi>` | Let that coding agent find your capsules. Safe to run again. | `kc connect claude-code` |
| `kc status` | Show the vault and this repository's capsules. | |
| `kc update [id]` | Use the newest versions from the vault. | `kc update aikongen/design-guidelines` |
| `kc remove <id>` | Stop using a capsule in this repository. The vault keeps it. | `kc remove aikongen/design-guidelines` |
| `kc export <id>[@version] <file.zip>` | Save a capsule as a zip file to share. | `kc export aikongen/design-guidelines@1.1.0 design.zip` |
| `kc import <file.zip>` | Add a shared zip file to the vault. Damaged or unsafe zips are refused. | `kc import design.zip` |

To make a capsule folder, see [Make a capsule](capsule-format.md).

## kc.json: the capsules this repository uses

`kc add` writes `kc.json` in the repository. Commit it so everyone uses the same versions.

```json
{
  "schemaVersion": "0.1",
  "capsules": [
    { "id": "aikongen/design-guidelines", "version": "1.1.0", "digest": "sha256:..." }
  ]
}
```

`digest` is the fingerprint of the version this repository uses; `kc status` tells you when the vault has a newer one.

## Where the vault is

`$KC_VAULT`, else `$XDG_DATA_HOME/kc/vault`, else `~/.local/share/kc/vault`.

## What connect writes

`kc connect` writes `kc mcp` into the agent's config; that is how the agent starts kc. You never run `kc mcp` yourself.

| Agent | File | Where it applies |
| --- | --- | --- |
| claude-code | `.mcp.json` in the current directory | this repository |
| codex | `~/.codex/config.toml`, or `$CODEX_HOME/config.toml` when that is set | every repository on this machine |
| opencode | `opencode.json` in the current directory | this repository |
| pi | `.pi/mcp.json` in the current directory | this repository |

`kc connect` also leaves a note for the agent in the repository's instruction file: `CLAUDE.md` for claude-code, `AGENTS.md` for codex, opencode and pi. Without it, agents were seen never to call kc. The note is a block between `<!-- kc:start -->` and `<!-- kc:end -->`. It is added after your own text, replaced in place on a second run, and never written twice. `--no-note` skips it. `kc remove` leaves it alone.

```text
<!-- kc:start -->
This repository uses Knowledge Capsules. Before any task, call list_capsules and read every capsule whose "use when" line matches the task. When texts disagree, follow this order: a capsule that says it holds in every repository, then this repository's own written conventions, then the other capsules, which apply where those conventions are silent. After a capsule shaped your work, call report_usage once.
<!-- kc:end -->
```

A repository's own written conventions win over a shared capsule because they record choices made for that repository, and a capsule that says it holds in every repository stays first because a repository cannot set it aside.

Pi also needs the pi-mcp-adapter extension; kc is not yet tested with Pi. Other content in these files is kept. If $KC_VAULT is set, the entry uses that vault. More detail: [maintainer guide](maintainers.md).
