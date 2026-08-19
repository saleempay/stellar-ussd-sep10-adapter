import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { AccountStore } from './types.js';

/**
 * File-backed reference {@link AccountStore} with **zero native
 * dependencies** (plain JSON via `node:fs`).
 *
 * Suitable for demos and single-process pilots where the mapping must
 * survive a restart. Writes are atomic per operation (write to a temp file
 * in the same directory, then rename), so a crash never leaves a
 * half-written file. It is **not** safe for concurrent writers across
 * processes and does not scale beyond a single node — production adopters
 * should implement {@link AccountStore} over a real database.
 *
 * The file contents link phone numbers to on-chain accounts: protect and
 * back up the file as you would a customer database.
 */
export class JsonFileAccountStore implements AccountStore {
  readonly #path: string;

  /** @param path - Path of the JSON file. Created (with parent dirs) on first write. */
  constructor(path: string) {
    this.#path = path;
  }

  async get(msisdn: string): Promise<string | undefined> {
    return this.#read()[msisdn];
  }

  async put(msisdn: string, accountId: string): Promise<void> {
    const data = this.#read();
    data[msisdn] = accountId;
    this.#write(data);
  }

  async delete(msisdn: string): Promise<void> {
    const data = this.#read();
    if (msisdn in data) {
      delete data[msisdn];
      this.#write(data);
    }
  }

  #read(): Record<string, string> {
    let text: string;
    try {
      text = readFileSync(this.#path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    return JSON.parse(text) as Record<string, string>;
  }

  #write(data: Record<string, string>): void {
    const dir = dirname(this.#path);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.#path);
  }
}
