import { KcError, SCHEMAS, type SchemaName } from "@kc/contracts";

/**
 * Identifier syntax has exactly one definition: the shared `$defs` block the
 * frozen contracts already carry. Retyping those regexes here would let the
 * domain accept an identifier the schema rejects (or worse, the reverse), and
 * the divergence would only surface at import time on someone else's machine.
 *
 * Reading them at module load also makes contract drift loud: removing a `$defs`
 * entry fails the first `import` rather than silently disabling a check.
 */
interface SchemaWithDefs {
  readonly $defs?: Readonly<Record<string, { readonly pattern?: unknown }>>;
}

function patternFrom(schema: SchemaName, def: string): RegExp {
  const defs = (SCHEMAS[schema] as unknown as SchemaWithDefs).$defs;
  const pattern = defs?.[def]?.pattern;
  if (typeof pattern !== "string") {
    throw new KcError(
      "internal",
      `@kc/contracts no longer exposes ${schema}#/$defs/${def}/pattern`,
      {
        details: [
          {
            at: `${schema}#/$defs/${def}`,
            message: "shared identifier pattern is missing or is not a string",
          },
        ],
      },
    );
  }
  // Ajv compiles schema patterns with the unicode flag; matching it keeps
  // escape semantics identical between validation and branding.
  return new RegExp(pattern, "u");
}

export const CAPSULE_ID_PATTERN = patternFrom("capsuleManifest", "capsuleId");
export const LOCAL_ID_PATTERN = patternFrom("capsuleManifest", "localId");
export const SEMVER_PATTERN = patternFrom("capsuleManifest", "semver");
export const DIGEST_PATTERN = patternFrom("capsuleManifest", "digest");
export const TIMESTAMP_PATTERN = patternFrom("capsuleManifest", "timestamp");
export const PACKAGE_PATH_PATTERN = patternFrom("capsuleManifest", "filePath");
export const PROFILE_ID_PATTERN = patternFrom("profile", "profileId");
