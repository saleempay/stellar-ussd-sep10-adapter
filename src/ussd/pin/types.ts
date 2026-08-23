/**
 * PIN store contracts.
 *
 * The store holds one record per MSISDN: the scrypt hash of the PIN and
 * the lockout bookkeeping. It NEVER holds a PIN in any form other than the
 * salted hash; nothing in this interface can carry PIN digits.
 *
 * Reference implementations mirror the resolver store pair: in-memory
 * primary, JSON file secondary, both zero native dependencies. A
 * production adopter implements this over a real database. Store contents
 * gate consent to sign for on-chain accounts: protect and back up the
 * store as you would an authentication database.
 */

/** One MSISDN's PIN record. */
export interface PinRecord {
  /** Encoded scrypt hash, `scrypt$N$r$p$<salt b64>$<hash b64>`. */
  hash: string;
  /** Consecutive failed attempts since the last success. */
  failures: number;
  /** Unix milliseconds until which the MSISDN is locked out; 0 if not. */
  lockedUntil: number;
}

/** Pluggable persistence for PIN records, keyed by canonical E.164 MSISDN. */
export interface PinStore {
  /** Return the record for this MSISDN, or undefined if none exists. */
  get(msisdn: string): Promise<PinRecord | undefined>;
  /** Create or replace the record for this MSISDN. */
  put(msisdn: string, record: PinRecord): Promise<void>;
  /** Remove the record. No-op if absent. */
  delete(msisdn: string): Promise<void>;
}
