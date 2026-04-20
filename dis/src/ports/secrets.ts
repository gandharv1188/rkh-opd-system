/**
 * Secrets port — abstracts secret retrieval behind a single `get` method.
 *
 * Caching is an adapter concern (not part of the port contract): production
 * adapters cache each resolved secret for five minutes to bound blast radius
 * on rotation while avoiding per-call round-trips. The port itself makes no
 * caching guarantees.
 *
 * @see portability.md §Secrets portability
 */

/**
 * Provider-agnostic secrets port.
 *
 * Implementations MUST throw if the named secret is not configured.
 *
 * @see portability.md §Secrets portability
 */
export interface SecretsPort {
  /**
   * Resolve a secret by name.
   *
   * @throws if the secret is not set.
   */
  get(name: string): Promise<string>;
}
