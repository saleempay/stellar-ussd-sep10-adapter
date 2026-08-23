import type { PinRecord, PinStore } from './types.js';

/**
 * In-memory reference {@link PinStore}. **Primary reference store.**
 *
 * State lives in process memory and is lost on restart, which for a demo
 * is a feature (no PIN hash outlives the run). See
 * {@link JsonFilePinStore} for the persistent zero-dependency reference;
 * production adopters implement {@link PinStore} over a real database.
 */
export class InMemoryPinStore implements PinStore {
  readonly #map = new Map<string, PinRecord>();

  async get(msisdn: string): Promise<PinRecord | undefined> {
    const record = this.#map.get(msisdn);
    return record === undefined ? undefined : { ...record };
  }

  async put(msisdn: string, record: PinRecord): Promise<void> {
    this.#map.set(msisdn, { ...record });
  }

  async delete(msisdn: string): Promise<void> {
    this.#map.delete(msisdn);
  }

  /** Number of records held. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#map.size;
  }

  /**
   * A snapshot of the store contents for test assertions (for example the
   * no plaintext PIN sweep). Hashes only, by construction.
   */
  dump(): Record<string, PinRecord> {
    return Object.fromEntries([...this.#map.entries()].map(([k, v]) => [k, { ...v }]));
  }
}
