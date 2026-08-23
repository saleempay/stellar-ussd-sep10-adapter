/**
 * Session store contracts.
 *
 * One record per live USSD session, keyed by the gateway's sessionId. The
 * store owns three safety properties:
 *
 * 1. **Expiry.** Sessions die at an absolute TTL (default 120 seconds,
 *    configurable). The TTL is OUR conservative bound; the gateway
 *    enforces its own telco-dependent inactivity timeout underneath,
 *    which this project measures empirically rather than quoting.
 * 2. **Atomic single use signing claim.** `claimSigning` flips a
 *    false-to-true latch exactly once per session. The claim is the
 *    session's right to trigger signing: only the caller that wins the
 *    claim may call `authenticate` (one signature) and the anchor
 *    operation. A duplicated or replayed gateway callback loses the claim
 *    and can never cause a second signature or a second anchor operation.
 * 3. **Response idempotency.** The rendered response for each processed
 *    step is cached by the step's cumulative input key; an identical
 *    repeated callback is answered from the cache without re-running
 *    anything.
 *
 * JWT custody (settled sprint constraint): the anchor JWT lives ONLY in
 * the session record for the session's lifetime and dies with it. The
 * auth module below stays stateless; callers re-check the token with
 * `assertTokenScope` before each use.
 */

import type { Sep10JwtClaims } from '../../auth/token.js';

/** Menu states. Defined here to keep the record type self-contained. */
export type MenuState =
  | 'welcome'
  | 'pinSetup1'
  | 'pinSetup2'
  | 'accountPrompt'
  | 'pinEnter'
  | 'done';

/** One live USSD session. */
export interface UssdSession {
  /** Gateway session id, the record key. */
  sessionId: string;
  /** Canonical E.164 MSISDN, inferred once at session start. */
  msisdn: string;
  /** Current menu state. */
  state: MenuState;
  /**
   * Count of inputs already processed, so a callback carrying fewer or
   * equal inputs is recognized as a duplicate or replay, never re-run.
   */
  processedInputs: number;
  /** True once the PIN was verified in this session. */
  pinVerified: boolean;
  /** True once the one signing claim is spent. */
  signingClaimed: boolean;
  /** Resolved Stellar account, once known. */
  accountId?: string;
  /** The anchor's JWT, held for the session lifetime only. */
  token?: string;
  /** Decoded claims for the scope re-check before each use. */
  claims?: Sep10JwtClaims;
  /** Unix ms when the session record was created. */
  createdAt: number;
  /** Unix ms of the last processed callback. */
  lastSeenAt: number;
}

/** Outcome of a signing claim attempt. */
export type ClaimOutcome = 'claimed' | 'already_claimed' | 'missing';

/**
 * Pluggable session persistence.
 *
 * The in-memory reference is the primary implementation and is what the
 * atomicity contract is written against: `claimSigning` performs its
 * read-check-write with no interleaving point (synchronous under Node's
 * single threaded event loop). A distributed implementation MUST provide
 * the same guarantee with a real compare-and-set (for example Redis
 * SET NX or a conditional UPDATE); a get-then-put emulation is not an
 * implementation of this interface.
 */
export interface SessionStore {
  /** Return the live session, or undefined when absent or expired. */
  get(sessionId: string, now: number): Promise<UssdSession | undefined>;
  /** Create or replace a session record. */
  put(session: UssdSession): Promise<void>;
  /**
   * Atomically spend the session's one signing claim.
   *
   * @returns 'claimed' to exactly one caller per session; then
   *   'already_claimed' forever after; 'missing' when the session is
   *   absent or expired.
   */
  claimSigning(sessionId: string, now: number): Promise<ClaimOutcome>;
  /** Cache the rendered response for one processed step. */
  recordResponse(sessionId: string, stepKey: string, rendered: string): Promise<void>;
  /** Return the cached response for a step, if this exact step was processed. */
  getResponse(sessionId: string, stepKey: string): Promise<string | undefined>;
  /** Remove a session and its cached responses. */
  delete(sessionId: string): Promise<void>;
}
