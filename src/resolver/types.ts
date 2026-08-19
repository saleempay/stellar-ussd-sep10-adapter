/**
 * Resolver contracts.
 *
 * ## Design note — why a registry and not derivation
 *
 * The resolver is deliberately **pure bookkeeping**: a persistent mapping
 * from canonical MSISDN to Stellar account ID. There is *no function from a
 * phone number to key material anywhere in this design* — accounts are
 * randomly generated keypairs owned by whatever backend implements the
 * `Signer` interface. Deterministic derivation of key material from phone
 * numbers (hashed, salted, HMAC-keyed, or otherwise) is **excluded as a
 * design class**, not merely discouraged: the MSISDN space is small enough
 * to enumerate, and any secret that makes derivation "safe" becomes an
 * unrotatable master key for every user.
 */

/**
 * Pluggable persistence for the MSISDN → account mapping.
 *
 * The reference implementations are {@link InMemoryAccountStore} (primary;
 * non-persistent, for tests and demos) and {@link JsonFileAccountStore}
 * (file-backed, zero native dependencies). A production adopter supplies
 * their own implementation backed by a real database.
 *
 * Adopter warnings:
 * - The store is **authoritative**. Losing it orphans accounts (funds remain
 *   on-chain but the phone-number linkage is gone). Back it up.
 * - Store contents link phone numbers to on-chain accounts. Treat them as
 *   personal data with the same protection as a KYC database.
 * - Keys passed to the store are already-canonical E.164 MSISDNs.
 */
export interface AccountStore {
  /** Return the account ID mapped to this MSISDN, or undefined if unmapped. */
  get(msisdn: string): Promise<string | undefined>;
  /** Create or replace the mapping for this MSISDN. */
  put(msisdn: string, accountId: string): Promise<void>;
  /** Remove the mapping for this MSISDN. No-op if unmapped. */
  delete(msisdn: string): Promise<void>;
}

/** Result of resolving an MSISDN. */
export interface ResolvedAccount {
  /** The canonical E.164 MSISDN the result is for. */
  msisdn: string;
  /** The Stellar account ID (G...). */
  accountId: string;
  /** True if the account was created during this resolution. */
  created: boolean;
  /**
   * Hash of the account-creation transaction, present only when
   * {@link created} is true.
   */
  creationTxHash?: string;
}
