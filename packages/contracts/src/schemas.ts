/**
 * Salvage note: the old file imported 22 frozen contract schemas from the
 * repository root `contracts/`. Only the seven schemas that the salvaged
 * packages validate against or read patterns from are kept, as copies in
 * `packages/contracts/schemas/`.
 */
import capsuleManifest from "../schemas/capsule-manifest.schema.json" with { type: "json" };
import evidence from "../schemas/evidence.schema.json" with { type: "json" };
import knowledgeItem from "../schemas/knowledge-item.schema.json" with { type: "json" };
import profile from "../schemas/profile.schema.json" with { type: "json" };
import source from "../schemas/source.schema.json" with { type: "json" };
import sourceAcquisition from "../schemas/source-acquisition.schema.json" with { type: "json" };
import traceEvent from "../schemas/trace-event.schema.json" with { type: "json" };

export const SCHEMAS = {
  capsuleManifest,
  evidence,
  knowledgeItem,
  profile,
  source,
  sourceAcquisition,
  traceEvent,
} as const;

export type SchemaName = keyof typeof SCHEMAS;

export const SCHEMA_NAMES = Object.keys(SCHEMAS) as SchemaName[];

/** The `schemaVersion` every v0.1 artifact pins. */
export const SCHEMA_VERSION = "0.1" as const;
