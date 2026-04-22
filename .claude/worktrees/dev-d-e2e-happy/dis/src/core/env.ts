import { ZodError } from 'zod';
import { envSchema, type Env } from './env.schema.js';

export class EnvValidationError extends Error {
  public readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    const body = issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n');
    super(`Environment validation failed:\n${body}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  try {
    return envSchema.parse(source);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw new EnvValidationError(issues);
    }
    throw err;
  }
}

export type { Env } from './env.schema.js';
