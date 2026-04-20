/**
 * SupabaseStorageAdapter — StoragePort implementation over Supabase Storage REST.
 *
 * Not yet implemented (TDD RED phase).
 */

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class StorageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageProviderError';
  }
}

export class SupabaseStorageAdapter {
  constructor(_config: unknown) {
    throw new Error('not implemented');
  }
}
