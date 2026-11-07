# Capsule format internals

For maintainers; the user page is [capsule-format.md](../capsule-format.md). Source: PRD.md, "What a capsule is". Code: `packages/capsule-format`, schema `packages/contracts/schemas/capsule-manifest.schema.json`. Two real capsules: `examples/design-guidelines/`, `examples/documentation-guidelines/` (capsule.json + canonical.md each).

A capsule is a folder with a thin required core and optional layers. The `kind` says which layers are required.

## Folder layout

A guidelines capsule is two files:

```
<capsule>/
  capsule.json              manifest, the one fixed path
  canonical.md              the content, condensed markdown for an AI
```

Research capsules (and any capsule that chooses to carry them) add more, all listed in `capsule.json#/contents`:

```
  scope.json  changelog.md  provenance/build.json  provenance/ledger.jsonl   research kind
  patterns/*.md  examples/*.md  checks/*  attachments/*                      optional extra content
  knowledge/items.jsonl  evidence/index.jsonl  sources/index.jsonl           research layers
  evaluations/manifest.json                                                  optional
```

`capsule.json#/contents` lists every file. A file in the folder that `contents` does not list is invalid (PKG-02); a listed file that is missing is invalid (PKG-01). Paths follow PATH-01..13 (relative, no `..`, no backslash, NFC, at most 512 bytes). Text files use LF only and end with exactly one LF (publication check).

## Core (every capsule)

| PRD word | Manifest field | Rule |
| --- | --- | --- |
| Identity | `id` | `namespace/name`, lowercase letters, digits, `.`, `_`, `-`, e.g. `surfaces/design-guidelines` |
| Version | `version` | semantic version chosen by the publisher |
| Content digest | `digest` | `sha256:<64 hex>`, computed on publish, required once `status` is `published` |
| Scope | `scope` | inline: `includes` and `excludes` (string lists); `assumptions` optional for guidelines |
| Trigger | `trigger` | one line (no line break, at most 300 characters): "use this when". Required for every capsule |
| Kind | `kind` | required: `guidelines` or `research`; a manifest without it is refused |
| Content | `contents.canonical` | the markdown file |

Also in every manifest, not named by the PRD: `schemaVersion` ("0.1", the format version), `status` and `publishedAt` (the vault's lifecycle fields).

## Optional layers and which kind requires them

Kind `guidelines` needs only the core and is the only kind the user page documents. Kind `research` also requires everything below. `schemaVersion` and `status` default when absent; `kc publish` computes `digest` and `publishedAt`.

| Field | Required by `research` | Required by `guidelines` |
| --- | --- | --- |
| `contents.knowledgeItems`, `evidence`, `sources` and the matching `inventory` counts | yes | no |
| `profile` (`id`, `version`) | yes | no |
| `title`, `summary`, `classification`, `maintainers`, `freshness`, `provenance`, `minimumResolverVersion` | yes | no |
| `contents.scope`, `provenance`, `provenanceLedger`, `changelog`; `scope.assumptions`; the lifecycle states draft, in_review, approved, superseded, archived | yes | no |

These are research-kind legacy. A guidelines capsule that carries any of them still has it checked: records against their schemas, references (PKG-03..06), inventory counts (PKG-07), the scope copy (PKG-10).

## Immutability and digest

- A published version never changes. Its files and manifest are fixed; a change is a new version chosen by the publisher. The product never bumps a version itself.
- The digest is one SHA-256 over every file record in path order, `path-length || path || byte-length || bytes` (lengths unsigned 64-bit big-endian), the files being `capsule.json` plus each file listed in `contents` (`digest.ts`, `computeContentDigest`).
- `capsule.json` enters the hash as canonical JSON (RFC 8785, `jcs.ts`) with `status`, `digest` and `signatures` removed, so lifecycle changes after publish do not change the digest (`manifest.ts`, `manifestEntryBytes`).
- Validation recomputes the digest and compares it to the manifest's (PKG-12). The same digest on export and import is the portability test.
- `status` values: draft, in_review, approved, published, superseded, archived; published and later need `digest` and `publishedAt`.

## Serve-only

The PRD makes serve-only a per-capsule flag, off by default: a registry hands out context slices through the resolve tool, never the files. Open: the schema has no such field and the PRD gives no name.

## Differences from the old code

- Old: every capsule had items, evidence, sources, a profile and the fields above. PRD: only kind `research` does.
- Old: no `kind`, no `trigger`. Both are new and required.
- Old catalog projection (`storage/catalog-rebuild`) required profile and items; it now indexes what exists. Capsules without a profile are listed but not offered to the resolver.

## Open

- Which kinds exist besides `guidelines` and `research` (PRD open question).
- Serve-only: no schema field, because the PRD gives no name.
