import { KcError, type ErrorDetail } from "@kc/contracts";

import {
  CAPSULE_ID_PATTERN,
  DIGEST_PATTERN,
  LOCAL_ID_PATTERN,
  PACKAGE_PATH_PATTERN,
  PROFILE_ID_PATTERN,
} from "./patterns.ts";
import { detail, err, ok, unwrap, type Result } from "./result.ts";

declare const brand: unique symbol;

/**
 * Opaque string types. `Brand` is erased at runtime, so a branded value is a
 * plain string in JSON — but a raw string can only become one by passing the
 * contract pattern, which is what stops a capsule slug being used where an
 * evidence ID belongs.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** `namespace/slug`, stable across every version of a capsule. */
export type CapsuleId = Brand<string, "CapsuleId">;

/** An ID scoped to one capsule lineage: knowledge items, sources, evidence. */
export type LocalId = Brand<string, "LocalId">;

/** `sha256:<64 lowercase hex>` over a canonical content stream. */
export type Digest = Brand<string, "Digest">;

/** A capsule profile identifier, without its version. */
export type ProfileId = Brand<string, "ProfileId">;

/** A relative POSIX path inside a `.kcap` package. */
export type PackagePath = Brand<string, "PackagePath">;

export interface CapsuleIdParts {
  readonly namespace: string;
  readonly slug: string;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

export function parseBranded<T extends string>(
  value: unknown,
  pattern: RegExp,
  kind: string,
  at = "/",
): Result<T> {
  if (typeof value !== "string") {
    return brandFailure(kind, at, `expected a string, received ${describe(value)}`, {
      received: value === undefined ? null : describe(value),
    });
  }
  if (!pattern.test(value)) {
    if (kind === "capsuleId") {
      const sentence = `${JSON.stringify(value)} is not a capsule id; use namespace/name in lowercase, for example aikongen/design-guidelines`;
      return err(
        new KcError("validation_failed", sentence, {
          details: [detail("DOM-ID-01", at, sentence, { kind, pattern: pattern.source })],
        }),
      );
    }
    return brandFailure(
      kind,
      at,
      `${JSON.stringify(value)} does not match the ${kind} pattern ${pattern.source}`,
      { pattern: pattern.source },
    );
  }
  return ok(value as T);
}

function brandFailure(
  kind: string,
  at: string,
  message: string,
  extra: Readonly<Record<string, unknown>>,
): Result<never> {
  const details: ErrorDetail[] = [
    detail("DOM-ID-01", at, message, { kind, ...extra }),
  ];
  return err(
    new KcError("validation_failed", `invalid ${kind}`, { details }),
  );
}

export function parseCapsuleId(value: unknown, at = "/"): Result<CapsuleId> {
  return parseBranded<CapsuleId>(value, CAPSULE_ID_PATTERN, "capsuleId", at);
}

export function parseLocalId(value: unknown, at = "/"): Result<LocalId> {
  return parseBranded<LocalId>(value, LOCAL_ID_PATTERN, "localId", at);
}

export function parseDigest(value: unknown, at = "/"): Result<Digest> {
  return parseBranded<Digest>(value, DIGEST_PATTERN, "digest", at);
}

export function parseProfileId(value: unknown, at = "/"): Result<ProfileId> {
  return parseBranded<ProfileId>(value, PROFILE_ID_PATTERN, "profileId", at);
}

export function parsePackagePath(value: unknown, at = "/"): Result<PackagePath> {
  return parseBranded<PackagePath>(
    value,
    PACKAGE_PATH_PATTERN,
    "packagePath",
    at,
  );
}

export function assertCapsuleId(value: unknown, at = "/"): CapsuleId {
  return unwrap(parseCapsuleId(value, at));
}

export function assertLocalId(value: unknown, at = "/"): LocalId {
  return unwrap(parseLocalId(value, at));
}

export function assertDigest(value: unknown, at = "/"): Digest {
  return unwrap(parseDigest(value, at));
}

export function assertProfileId(value: unknown, at = "/"): ProfileId {
  return unwrap(parseProfileId(value, at));
}

export function assertPackagePath(value: unknown, at = "/"): PackagePath {
  return unwrap(parsePackagePath(value, at));
}

export function isCapsuleId(value: unknown): value is CapsuleId {
  return parseCapsuleId(value).ok;
}

export function isLocalId(value: unknown): value is LocalId {
  return parseLocalId(value).ok;
}

export function isDigest(value: unknown): value is Digest {
  return parseDigest(value).ok;
}

/** The pattern permits exactly one separator, so the split is total. */
export function capsuleIdParts(id: CapsuleId): CapsuleIdParts {
  const separator = id.indexOf("/");
  return {
    namespace: id.slice(0, separator),
    slug: id.slice(separator + 1),
  };
}

export function formatCapsuleId(parts: CapsuleIdParts): Result<CapsuleId> {
  return parseCapsuleId(`${parts.namespace}/${parts.slug}`);
}

/** The hex payload of a digest, without the `sha256:` algorithm prefix. */
export function digestHex(digest: Digest): string {
  return digest.slice("sha256:".length);
}
