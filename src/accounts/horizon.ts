/**
 * Minimal structural view of a Horizon client.
 *
 * The adapter depends on this narrow interface rather than on the SDK's
 * `Horizon.Server` class so unit tests can stub it offline and adopters can
 * wrap Horizon access however they like. `Horizon.Server` from
 * `@stellar/stellar-sdk` satisfies it as-is.
 */

import type { Transaction } from '@stellar/stellar-sdk';

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
