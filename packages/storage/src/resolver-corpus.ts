/**
 * SQLite- and framework-independent read contract consumed by the resolver.
 * Implementations suppress non-published and non-highest versions before
 * returning a snapshot. Administrative lifecycle/history APIs are separate.
 */

export const RESOLVER_TRUST_LEVELS = [
  "local-authored",
  "trusted-publisher",
  "verified-signature",
  "unverified",
  "quarantined",
] as const;

export type ResolverTrust = (typeof RESOLVER_TRUST_LEVELS)[number];

export type ResolverScopeValue =
  | string
  | number
  | boolean
  | readonly ResolverScopeValue[];

export interface ResolverCapsuleRef {
  readonly capsuleId: string;
  readonly version: string;
  readonly digest: string;
}

export interface ResolverCapsuleScope {
  readonly audiences?: readonly string[];
  readonly platforms?: readonly string[];
  readonly technologies?: Readonly<Record<string, string>>;
  readonly jurisdictions?: readonly string[];
  readonly contexts?: Readonly<Record<string, ResolverScopeValue>>;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly assumptions: readonly string[];
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface ResolverCapsuleFreshness {
  readonly assessedAt: string;
  readonly policy: "manual" | "max_age" | "source_version" | "effective_date" | "custom";
  readonly maxAgeDays?: number;
  readonly updateTriggers: readonly string[];
  readonly notes?: string;
}

export interface ResolverCapsuleDependency {
  readonly capsuleId: string;
  readonly versionRange: string;
  readonly policy: "required" | "optional" | "development";
  readonly digest?: string;
  readonly reason?: string;
}

export interface ResolverItemApplicability {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly selectors?: Readonly<Record<string, ResolverScopeValue>>;
}

export interface ResolverItemConfidence {
  readonly level: "low" | "medium" | "high" | "very_high";
  readonly value: number;
  readonly rationale: string;
  readonly meaning?: string;
}

export interface ResolverItemEvidence {
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly qualifies: readonly string[];
  readonly contextualizes: readonly string[];
}

export interface ResolverItemRelationships {
  readonly dependsOn: readonly string[];
  readonly relatedTo: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly supersedes: readonly string[];
}

export interface ResolverItemFreshness {
  readonly assessedAt: string;
  readonly state: "current" | "aging" | "stale" | "unknown";
  readonly validUntil?: string;
  readonly updateTriggers: readonly string[];
}

export interface ResolverItemRetrievalHints {
  readonly queries: readonly string[];
  readonly taskTypes: readonly string[];
  readonly priority?: number;
}

export interface ResolverCorpusItem {
  readonly id: string;
  readonly kind:
    | "definition"
    | "claim"
    | "guidance"
    | "decision_rule"
    | "procedure"
    | "pattern"
    | "anti_pattern"
    | "warning"
    | "example"
    | "check"
    | "known_unknown";
  readonly title: string;
  readonly statement: string;
  readonly body: string;
  readonly applicability: ResolverItemApplicability;
  readonly confidence: ResolverItemConfidence;
  readonly evidence: ResolverItemEvidence;
  readonly relationships: ResolverItemRelationships;
  readonly freshness: ResolverItemFreshness;
  readonly tags: readonly string[];
  readonly retrievalHints: ResolverItemRetrievalHints;
}

export interface ResolverCorpusCapsule {
  readonly ref: ResolverCapsuleRef;
  readonly profile: { readonly id: string; readonly version: string };
  readonly classification: "public" | "internal" | "confidential" | "restricted";
  readonly trust: ResolverTrust;
  readonly title: string;
  readonly summary: string;
  readonly scope: ResolverCapsuleScope;
  readonly facets: {
    readonly tags: readonly string[];
    readonly taskTypes: readonly string[];
    readonly audiences: readonly string[];
  };
  readonly freshness: ResolverCapsuleFreshness;
  readonly minimumResolverVersion: string;
  readonly dependencies: readonly ResolverCapsuleDependency[];
  readonly items: readonly ResolverCorpusItem[];
}

export interface ResolverCapsuleLexicalMatch {
  readonly ref: ResolverCapsuleRef;
  readonly bm25: number;
}

export interface ResolverItemLexicalMatch {
  readonly ref: ResolverCapsuleRef;
  readonly itemId: string;
  readonly bm25: number;
}

export interface ResolverCorpusRequest {
  readonly tokens: readonly string[];
  readonly capsuleMatchLimit?: number;
  readonly itemMatchLimitPerCapsule?: number;
}

/** A coherent, deeply immutable view for one resolver invocation. */
export interface ResolverCorpusSnapshot {
  readonly capsules: readonly ResolverCorpusCapsule[];
  readonly capsuleMatches: readonly ResolverCapsuleLexicalMatch[];
  readonly itemMatches: readonly ResolverItemLexicalMatch[];
}

export interface ResolverCorpusPort {
  readResolverCorpus(request: ResolverCorpusRequest): ResolverCorpusSnapshot;
}
