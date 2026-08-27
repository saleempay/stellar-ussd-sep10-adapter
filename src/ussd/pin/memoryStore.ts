import type { FailureOutcome, PinRecord, PinStore } from './types.js';

/**
 * In-memory reference {@link PinStore}. **Primary reference store.**
 *
 * State lives in process memory and is lost on restart, which for a demo
 * is a feature (no PIN hash outlives the run). See
 * {@link JsonFilePinStore} for the persistent zero-dependency reference;
 * production adopters implement {@link PinStore} over a real database.
 *
 * ## Atomicity
 *
 * {@link recordFailure} and {@link clearFailures} perform their
 * read-check-write synchronously, with no `await` between the read and the
 * write, so under Node's single threaded event loop no other callback can
 * interleave, exactly the guarantee the interface requires and the same
 * technique the session store's claim uses. This is what makes the lockout
 * counter race-free: a batch of concurrent wrong guesses is serialized, so
 * each one genuinely increments the count.
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

  async recordFailure(
    msisdn: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<FailureOutcome> {
    // Synchronous read-check-write: no await between read and write, so
    // concurrent callers serialize on the event loop.
    const record = this.#map.get(msisdn);
    if (record === undefined) {
      return { failures: 0, lockedUntil: 0, locked: false };
    }
    if (record.lockedUntil > now) {
      // A sibling attempt already locked the record this window. Count this
      // failure on top but never clear or extend the existing lock.
      const failures = record.failures + 1;
      this.#map.set(msisdn, { ...record, failures });
      return { failures, lockedUntil: record.lockedUntil, locked: true };
    }
    // Not currently locked. An expired prior lock (lockedUntil > 0 but in
    // the past) starts a fresh count.
    const base = record.lockedUntil > 0 ? 0 : record.failures;
    const failures = base + 1;
    if (failures >= maxAttempts) {
      const lockedUntil = now + lockoutMs;
      this.#map.set(msisdn, { ...record, failures, lockedUntil });
      return { failures, lockedUntil, locked: true };
    }
    this.#map.set(msisdn, { ...record, failures, lockedUntil: 0 });
    return { failures, lockedUntil: 0, locked: false };
  }

  async clearFailures(msisdn: string): Promise<void> {
    const record = this.#map.get(msisdn);
    if (record === undefined) return;
    if (record.failures !== 0 || record.lockedUntil !== 0) {
      this.#map.set(msisdn, { ...record, failures: 0, lockedUntil: 0 });
    }
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
