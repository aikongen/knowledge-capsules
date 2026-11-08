# Make a capsule

A capsule is a folder with two files:

```
design-guidelines/
  capsule.json    who it is and when to use it
  canonical.md    the content your agent reads
```

Four finished examples: [design-guidelines](https://github.com/aikongen/knowledge-capsules/tree/main/examples/design-guidelines), [design-evidence-guidelines](https://github.com/aikongen/knowledge-capsules/tree/main/examples/design-evidence-guidelines), [documentation-guidelines](https://github.com/aikongen/knowledge-capsules/tree/main/examples/documentation-guidelines) and [capsule-writing-guidelines](https://github.com/aikongen/knowledge-capsules/tree/main/examples/capsule-writing-guidelines), which says how to write a trigger and content.

## What you write in capsule.json

| Field | Meaning |
| --- | --- |
| `id` | `namespace/name`, lowercase, e.g. `aikongen/design-guidelines` |
| `version` | your choice, e.g. `1.0.0`; a changed capsule needs a new version |
| `kind` | `"guidelines"` |
| `trigger` | one line, up to 300 characters; best started with "Use when…" |
| `scope` | `includes` and `excludes`: lists of short phrases |
| `contents.canonical` | the content file, `canonical.md` |

`kc publish` adds a fingerprint and the publish time; do not write them.

## Rules for the files

- Files are UTF-8 with LF line ends and one newline at the end.
- Keep `canonical.md` self-contained: kc does not follow or check links, so a link to another file or the web may be dead for the reader.

Then run `kc publish ./design-guidelines`. See [Every command](cli.md).
