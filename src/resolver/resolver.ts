/**
 * MSISDN normalization and store-backed resolution.
 */

import { InvalidMsisdnError } from '../errors.js';
import type { AccountStore } from './types.js';

/**
 * Normalize an MSISDN to canonical E.164.
 *
 * Accepts common formatting noise (spaces, dashes, dots, parentheses) around
 * an otherwise-canonical international number, e.g. `"+971 50-123 4567"`.
 * The result must match `+` followed by 8–15 digits with no leading zero.
 *
 * This boundary is **strict by design**: input in national format (for
 * example `0501234567`) is rejected rather than guessed at, because
 * converting national format to E.164 requires knowing the country, and
 * country-code inference is the caller's responsibility. A USSD session
 * layer knows which network a session arrived from; a library does not.
 *
 * @throws InvalidMsisdnError when the input cannot be canonicalized.
 */
export function normalizeMsisdn(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(stripped)) {
    throw new InvalidMsisdnError(raw);
  }
  return stripped;
}

/**
 * Store-backed MSISDN → Stellar account resolver.
 *
 * The resolver holds no key material and performs no on-chain operations.
 * Account creation is injected by the caller (see `resolveOrCreateAccount`
 * in the package root), keeping this class pure bookkeeping.
 */
export class MsisdnResolver {
  readonly #store: AccountStore;

  constructor(store: AccountStore) {
    this.#store = store;
  }

  /**
   * Look up the account mapped to an MSISDN.
   *
   * @returns The account ID, or undefined when no mapping exists.
   * @throws InvalidMsisdnError when the input is not canonical E.164.
   */
  async lookup(rawMsisdn: string): Promise<string | undefined> {
    return this.#store.get(normalizeMsisdn(rawMsisdn));
  }

  /**
   * Record a mapping from an MSISDN to an account ID.
   *
   * Note for adopters: the reference flow calls this after on-chain account
   * creation succeeds. If two sessions race to create an account for the
   * same MSISDN, last-write-wins here; a production store should implement
   * put-if-absent semantics if that race matters in your deployment.
   */
  async register(rawMsisdn: string, accountId: string): Promise<void> {
    await this.#store.put(normalizeMsisdn(rawMsisdn), accountId);
  }

  /** Remove the mapping for an MSISDN, if any. */
  async unregister(rawMsisdn: string): Promise<void> {
    await this.#store.delete(normalizeMsisdn(rawMsisdn));
  }
}
