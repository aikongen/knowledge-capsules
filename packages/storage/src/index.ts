export {
  resolveArtifactRunDir,
  resolveCapsuleDir,
  resolveCapsuleDraftDir,
  resolveCapsuleDraftsDir,
  resolveCapsuleVersionDir,
  resolveCapsuleVersionsDir,
  resolveSourceDir,
  isSafePathSegment,
  vaultLayout,
  type VaultLayout,
} from "./vault-layout.ts";

export {
  publishDirectoryAtomic,
  recoverStaleStaging,
  writeFileAtomic,
  writeFileCreateOnlyAtomic,
  writeJsonAtomic,
} from "./atomic.ts";

export { withWriteGuard } from "./lease.ts";

export {
  CURRENT_STORAGE_SCHEMA_VERSION,
  CATALOG_TRUST_LEVELS,
  openSqliteStorage,
  type AppliedMigration,
  type CatalogEntryProjection,
  type CatalogFacetProjection,
  type CatalogFtsMatch,
  type CatalogItemProjection,
  type CatalogItemFtsMatch,
  type CatalogScopeProjection,
  type CatalogTrust,
  type SqliteRuntimeInfo,
  type SqliteStorage,
} from "./sqlite.ts";

export type {
  AppendTraceEventResult,
  ItemUsageCounts,
  TraceCounts,
  TraceEvent,
} from "./trace-types.ts";

export {
  rebuildCatalogFromCanonicalVault,
  type CatalogRebuildOptions,
  type CatalogRebuildResult,
} from "./catalog-rebuild.ts";

export {
  PUBLISHED_LIFECYCLE_STATUSES,
  parseCapsuleRegistry,
  registerPublishedVersion,
  type CapsuleRegistry,
  type CapsuleRegistryVersion,
  type PublishedLifecycleStatus,
} from "./capsule-registry.ts";
