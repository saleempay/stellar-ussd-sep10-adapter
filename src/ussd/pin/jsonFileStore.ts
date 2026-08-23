import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { PinRecord, PinStore } from './types.js';

/**
 * File-backed reference {@link PinStore} with zero native dependencies,
 * mirroring `JsonFileAccountStore`: atomic write-then-rename per
 * operation, single process only.
 *
 * The file holds scrypt hashes and lockout state, never PIN digits, but
 * it still gates consent to sign: protect and back it up as an
 * authentication database.
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
