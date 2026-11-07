import { KcError, type ErrorCode, type ErrorDetail } from "@kc/contracts";

/**
 * Every domain operation that can reject its input returns a `Result` rather
 * than throwing. Invalid capsule data is an ordinary outcome here — it arrives
 * from imported packages, model output and user edits — so callers must be made
 * to handle it, and a lifecycle rejection must be as inspectable as a success.
 *
 * Throwing variants exist as thin `assert*` wrappers, mirroring
 * `SchemaValidator.validate` / `SchemaValidator.assert` in `@kc/contracts`.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KcError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(error: KcError): Result<never> {
  return { ok: false, error };
}

/** Stable rule identifier carried on every domain error detail. */
export interface RuleDetail extends ErrorDetail {
  readonly rule: string;
}

export function fail(
  code: ErrorCode,
  message: string,
  details: readonly ErrorDetail[] = [],
): Result<never> {
  return err(new KcError(code, message, { details }));
}

export function detail(
  rule: string,
  at: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): RuleDetail {
  return { rule, at, message, ...extra };
}

export function isOk<T>(
  result: Result<T>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T>(
  result: Result<T>,
): result is { readonly ok: false; readonly error: KcError } {
  return !result.ok;
}

/** Throws the shared error envelope. Used by the `assert*` constructors. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/**
 * Turns many results into one, keeping every failure detail. Repairing an
 * imported capsule one rejected record at a time is painful, so collection
 * behaves like the validator's `allErrors`.
 */
export function collect<T>(
  results: readonly Result<T>[],
  code: ErrorCode,
  message: string,
): Result<readonly T[]> {
  const values: T[] = [];
  const details: ErrorDetail[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else details.push(...result.error.details);
  }
  if (details.length > 0) return fail(code, message, details);
  return ok(values);
}
