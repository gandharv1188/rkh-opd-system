import type { SecretsPort } from '../../ports/secrets.js';

export class FakeSecrets implements SecretsPort {
  constructor(private readonly store: Readonly<Record<string, string>> = {}) {}

  async get(name: string): Promise<string> {
    const v = this.store[name];
    if (v === undefined) throw new Error(`secret not set: ${name}`);
    return v;
  }
}
