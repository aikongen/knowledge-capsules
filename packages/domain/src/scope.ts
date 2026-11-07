/**
 * Applicability, at two levels. A capsule declares the scope of the whole
 * version; a knowledge item narrows it further. Both keep `includes` and
 * `excludes` as separate lists because the resolver must be able to say
 * `inapplicable` — "a candidate exists but its scope excludes the task" — which
 * is not expressible if exclusions are folded into a score.
 */
export type ScopeValue = string | number | boolean | readonly ScopeValue[];

export interface CapsuleScope {
  readonly audiences?: readonly string[];
  readonly platforms?: readonly string[];
  /** Technology name to version range, for example `{ electron: ">=44 <45" }`. */
  readonly technologies?: Readonly<Record<string, string>>;
  readonly jurisdictions?: readonly string[];
  readonly contexts?: Readonly<Record<string, ScopeValue>>;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly assumptions: readonly string[];
  /** Calendar dates (`YYYY-MM-DD`), not instants. */
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface ItemApplicability {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly selectors?: Readonly<Record<string, ScopeValue>>;
}

export interface ProfileRef {
  readonly id: string;
  readonly version: string;
}

export const CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface Maintainer {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string;
  readonly role?: string;
}
