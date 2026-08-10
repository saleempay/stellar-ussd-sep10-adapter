import type { AccountStore } from './types.js';

/**
 * In-memory reference {@link AccountStore}. **Primary reference store.**
 *
 * State lives in process memory and is lost on restart. This exists so the
 * repository runs end-to-end from a clean clone with zero infrastructure —
 * it is a demonstration vehicle, not a deployment choice. See
 * {@link JsonFileAccountStore} for a persistent zero-dependency reference,
 * or implement {@link AccountStore} over a real database for production.
 */
export class InMemoryAccountStore implements AccountStore {
  readonly #map = new Map<string, string>();

  async get(msisdn: string): Promise<string | undefined> {
    return this.#map.get(msisdn);
  }

  async put(msisdn: string, accountId: string): Promise<void> {
    this.#map.set(msisdn, accountId);
  }

  async delete(msisdn: string): Promise<void> {
    this.#map.delete(msisdn);
  }

  /** Number of mappings held. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#map.size;
  }
}
