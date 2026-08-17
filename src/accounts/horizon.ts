/**
 * Minimal structural view of a Horizon client.
 *
 * The adapter depends on this narrow interface rather than on the SDK's
 * `Horizon.Server` class so unit tests can stub it offline and adopters can
 * wrap Horizon access however they like. `Horizon.Server` from
 * `@stellar/stellar-sdk` satisfies it as-is.
 */

import type { Transaction } from '@stellar/stellar-sdk';

import { AccountNotFoundError, isHorizonNotFound } from '../errors.js';

/** Account state the adapter reads: sequence (for building) and balances. */
export interface HorizonAccount {
  accountId(): string;
  sequenceNumber(): string;
  incrementSequenceNumber(): void;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
}

/** Result of a successful transaction submission. */
export interface SubmitResult {
  hash: string;
  ledger?: number;
}

/** The subset of Horizon the adapter calls. */
export interface HorizonLike {
  loadAccount(accountId: string): Promise<HorizonAccount>;
  submitTransaction(tx: Transaction): Promise<SubmitResult>;
}

/**
 * Load an account, translating a Horizon 404 into a typed
 * {@link AccountNotFoundError} that names the missing account.
 *
 * Every `loadAccount` call in the adapter goes through this helper so a
 * missing account never reaches a caller as a raw SDK error. Any other
 * failure (network, 5xx, rate limit) is rethrown unchanged.
 */
export async function loadAccountOrThrow(
  horizon: HorizonLike,
  accountId: string,
): Promise<HorizonAccount> {
  try {
    return await horizon.loadAccount(accountId);
  } catch (err) {
    if (isHorizonNotFound(err)) throw new AccountNotFoundError(accountId);
    throw err;
  }
}
