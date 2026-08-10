import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv as AjvClass } from 'ajv';
import type { ValidateFunction, ErrorObject } from 'ajv';

export class SchemaValidationError extends Error {
  public readonly schemaId: string;
  public readonly errors: readonly ErrorObject[];

  constructor(schemaId: string, errors: readonly ErrorObject[] | undefined, message?: string) {
    const errs = errors ?? [];
    const summary =
      message ??
      (errs.length > 0
        ? errs
            .map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`)
            .join('; ')
        : `schema '${schemaId}' not found`);
    super(`[${schemaId}] ${summary}`);
    this.name = 'SchemaValidationError';
    this.schemaId = schemaId;
    this.errors = errs;
  }
}

const ajv = new AjvClass({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();

const here = dirname(fileURLToPath(import.meta.url));

const SCHEMA_FILES: Record<string, string> = {
  'clinical_extraction.v1': 'clinical_extraction.v1.json',
};

export function compileSchema(schemaId: string): ValidateFunction {
  const cached = validators.get(schemaId);
  if (cached) return cached;

  const filename = SCHEMA_FILES[schemaId];
  if (!filename) {
    throw new SchemaValidationError(schemaId, undefined);
  }

  const schema: unknown = JSON.parse(readFileSync(join(here, filename), 'utf8'));
  const validator = ajv.compile(schema as object);
  validators.set(schemaId, validator);
  return validator;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly ErrorObject[];
}

export function validate(schemaId: string, data: unknown): ValidationResult {
  const v = compileSchema(schemaId);
  const ok = v(data);
  if (ok) return { valid: true };
  return { valid: false, errors: v.errors ?? [] };
}

export function assertValid(schemaId: string, data: unknown): void {
  const result = validate(schemaId, data);
  if (!result.valid) {
    throw new SchemaValidationError(schemaId, result.errors);
  }
}
