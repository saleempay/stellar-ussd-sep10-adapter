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

/** The result of an atomic {@link PinStore.recordFailure}. */
export interface FailureOutcome {
  /** The failure count after this failure was recorded. */
  failures: number;
  /** Unix ms the lockout runs until; greater than 0 when locked. */
  lockedUntil: number;
  /** True when the record is now locked out. */
  locked: boolean;
}

/**
 * Pluggable persistence for PIN records, keyed by canonical E.164 MSISDN.
 *
 * ## Atomicity of the failure counter (a hard contract)
 *
 * {@link recordFailure} and {@link clearFailures} MUST be atomic: each
 * performs its read, its decision, and its write as one indivisible step,
 * with no observable gap in which a concurrent caller sees the old value.
 * This mirrors the {@link SessionStore.claimSigning} contract: **a
 * get-then-put emulation is not an implementation of this interface.** The
 * lockout counter is a security control, and a read-modify-write gap makes
 * it bypassable: concurrent wrong guesses each read the same count and
 * each write the same increment, so a batch of arbitrary width costs only
 * one recorded failure. A Redis implementation uses `INCR` (with a Lua
 * script or a `WATCH`/`MULTI` transaction for the lock decision); a SQL
 * implementation uses `UPDATE ... SET failures = failures + 1 ... RETURNING`
 * inside a transaction. Do not layer this over `get` then `put`.
 */
export interface PinStore {
  /** Return the record for this MSISDN, or undefined if none exists. */
  get(msisdn: string): Promise<PinRecord | undefined>;
  /** Create or replace the record for this MSISDN. */
  put(msisdn: string, record: PinRecord): Promise<void>;
  /** Remove the record. No-op if absent. */
  delete(msisdn: string): Promise<void>;
  /**
   * Atomically record one failed PIN attempt: increment the failure count
   * and, if it reaches `maxAttempts`, set the lockout, as ONE indivisible
   * step. An expired prior lock (its `lockedUntil` is in the past) starts a
   * fresh count; a lock set concurrently by a sibling attempt is respected,
   * never cleared. Returns the new count and lock state. No-op returning a
   * zeroed, unlocked outcome when no record exists (the caller routes
   * unregistered MSISDNs to setup first, so this indicates a caller bug).
   *
   * MUST be atomic; see the interface note above.
   */
  recordFailure(
    msisdn: string,
    now: number,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<FailureOutcome>;
  /**
   * Atomically clear the failure count and lockout after a successful
   * verification, preserving the hash. No-op when no record exists.
   *
   * MUST be atomic; see the interface note above.
   */
  clearFailures(msisdn: string): Promise<void>;
}
