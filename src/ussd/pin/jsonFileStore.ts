import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { FailureOutcome, PinRecord, PinStore } from './types.js';

/**
 * File-backed reference {@link PinStore} with zero native dependencies,
 * mirroring `JsonFileAccountStore`: atomic write-then-rename per
 * operation, single process only.
 *
 * The file holds scrypt hashes and lockout state, never PIN digits, but
 * it still gates consent to sign: protect and back it up as an
 * authentication database.
 *
 * ## Atomicity, and its single-process limit
 *
 * {@link recordFailure} and {@link clearFailures} do their read, decision,
 * and atomic write-then-rename with no `await` between the read and the
 * rename, so within one Node process the failure counter is race-free, as
 * the interface requires. This is a single-process reference only: two
 * processes sharing the file could still race on the read. A production
 * deployment uses a store with a real atomic increment (see the interface
 * note); this class is for demos and single-node pilots.
 */
export class JsonFilePinStore implements PinStore {
  readonly #path: string;

  /** @param path - Path of the JSON file. Created (with parent dirs) on first write. */
  constructor(path: string) {
    this.#path = path;
  }

  async get(msisdn: string): Promise<PinRecord | undefined> {
    const record = this.#read()[msisdn];
    return record === undefined ? undefined : { ...record };
  }

  async put(msisdn: string, record: PinRecord): Promise<void> {
    const data = this.#read();
    data[msisdn] = { ...record };
    this.#write(data);
  }

  async delete(msisdn: string): Promise<void> {
    const data = this.#read();
    if (msisdn in data) {
      delete data[msisdn];
      this.#write(data);
    }
  }

  async recordFailure(
    msisdn: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<FailureOutcome> {
    // Read, decide, and write with no await between: single-process atomic.
    const data = this.#read();
    const record = data[msisdn];
    if (record === undefined) {
      return { failures: 0, lockedUntil: 0, locked: false };
    }
    if (record.lockedUntil > now) {
      const failures = record.failures + 1;
      data[msisdn] = { ...record, failures };
      this.#write(data);
      return { failures, lockedUntil: record.lockedUntil, locked: true };
    }
    const base = record.lockedUntil > 0 ? 0 : record.failures;
    const failures = base + 1;
    if (failures >= maxAttempts) {
      const lockedUntil = now + lockoutMs;
      data[msisdn] = { ...record, failures, lockedUntil };
      this.#write(data);
      return { failures, lockedUntil, locked: true };
    }
    data[msisdn] = { ...record, failures, lockedUntil: 0 };
    this.#write(data);
    return { failures, lockedUntil: 0, locked: false };
  }

  async clearFailures(msisdn: string): Promise<void> {
    const data = this.#read();
    const record = data[msisdn];
    if (record === undefined) return;
    if (record.failures !== 0 || record.lockedUntil !== 0) {
      data[msisdn] = { ...record, failures: 0, lockedUntil: 0 };
      this.#write(data);
    }
  }

  #read(): Record<string, PinRecord> {
    let text: string;
    try {
      text = readFileSync(this.#path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    return JSON.parse(text) as Record<string, PinRecord>;
  }

  #write(data: Record<string, PinRecord>): void {
    const dir = dirname(this.#path);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.#path);
  }
}
