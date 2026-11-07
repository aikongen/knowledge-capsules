import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import { KcError, type ErrorDetail } from "./errors.ts";
import { SCHEMAS, type SchemaName } from "./schemas.ts";

export interface ValidationFailure {
  readonly at: string;
  readonly message: string;
  readonly keyword: string;
  /** For `required` failures: the property that is absent. */
  readonly missing?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ValidationFailure[] };

function toFailure(error: ErrorObject): ValidationFailure {
  const missing = (error.params as { missingProperty?: unknown }).missingProperty;
  return {
    at: error.instancePath === "" ? "/" : error.instancePath,
    message: error.message ?? "failed validation",
    keyword: error.keyword,
    ...(error.keyword === "required" && typeof missing === "string" ? { missing } : {}),
  };
}

/**
 * Runtime validation for every external artifact: imported packages, request
 * bodies, MCP tool arguments, and anything a model produced.
 *
 * Ajv is kept behind this adapter so the rest of the product never sees an Ajv
 * type. `allErrors` is on because an import that rejects one field at a time
 * makes a malformed capsule painful to repair.
 */
export class SchemaValidator {
  readonly #ajv: Ajv2020;
  readonly #compiled = new Map<SchemaName, ValidateFunction>();

  constructor() {
    this.#ajv = new Ajv2020({
      allErrors: true,
      // Strict mode catches real authoring mistakes (unknown keywords, self
      // contradicting types) and is worth keeping on. Two of its opinions are
      // relaxed because the frozen contracts use the idioms they reject:
      // `strictRequired` refuses conditional `if/then/required` (used to demand
      // a digest only once a capsule is published) and `not/required` (used to
      // make a knowledge item's `body` and `bodyPath` mutually exclusive), and
      // union-typed values are legal JSON Schema that scope selectors rely on.
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
      // Formats are advisory in JSON Schema; we opt into checking them because
      // a malformed timestamp in a published capsule is a data-integrity bug.
      validateFormats: true,
    });
    addFormats(this.#ajv);
  }

  #validatorFor(name: SchemaName): ValidateFunction {
    const existing = this.#compiled.get(name);
    if (existing) return existing;
    const compiled = this.#ajv.compile(SCHEMAS[name]);
    this.#compiled.set(name, compiled);
    return compiled;
  }

  validate<T>(name: SchemaName, value: unknown): ValidationResult<T> {
    const validate = this.#validatorFor(name);
    if (validate(value)) return { ok: true, value: value as T };
    return {
      ok: false,
      errors: (validate.errors ?? []).map(toFailure),
    };
  }

  /** Same as {@link validate} but throws the shared error envelope. */
  assert<T>(name: SchemaName, value: unknown, subject: string): T {
    const result = this.validate<T>(name, value);
    if (result.ok) return result.value;
    const details: ErrorDetail[] = result.errors.map((failure) => ({
      at: failure.at,
      message: failure.message,
      keyword: failure.keyword,
    }));
    throw new KcError(
      "validation_failed",
      `${subject} is not valid`,
      { details },
    );
  }
}

/** Compiling schemas is not free; callers share one validator per process. */
let shared: SchemaValidator | undefined;

export function sharedValidator(): SchemaValidator {
  shared ??= new SchemaValidator();
  return shared;
}
