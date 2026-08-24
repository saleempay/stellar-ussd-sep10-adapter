/**
 * PIN attempt policy: setup, verification, lockout.
 *
 * This module is the ONLY code that receives PIN digits. The digits arrive
 * as arguments, go into `hashPin`/`verifyPin`, and are never stored,
 * logged, thrown, or passed to any other interface. "Never transmitted
 * onward" (SOW) means exactly this: the PIN exists between the gateway
 * callback body and these functions, in process memory, and nowhere else.
 */

import { PinLockedError, PinRejectedError } from '../../errors.js';
import { hashPin, verifyPin } from './hash.js';
import type { PinStore } from './types.js';

/** Lockout policy defaults: 3 strikes, 15 minutes. */
export const PIN_POLICY = {
  maxAttempts: 3,
  lockoutMs: 15 * 60 * 1000,
} as const;

/** PIN format accepted by the reference: exactly 4 digits. */
export const PIN_PATTERN = /^\d{4}$/;

/** True when the input is a well-formed PIN for this reference. */
export function isWellFormedPin(input: string): boolean {
  return PIN_PATTERN.test(input);
}

/**
 * Weak PINs refused at SETUP only (never at verification, where refusing
 * by pattern would leak which pattern a stored PIN matches). This is UX
 * hardening, not the security control: the atomic three strike lockout is.
 * Explicit common choices plus the structural rules below.
 */
const WEAK_PIN_DENYLIST: ReadonlySet<string> = new Set([
  '0000',
  '1111',
  '1234',
  '1212',
]);

/**
 * True when a well-formed PIN is too easily guessed to allow at setup:
 * a denylisted value, a single repeated digit (`aaaa`), or a trivially
 * sequential run ascending or descending (`1234`, `4321`).
 *
 * Callers must confirm {@link isWellFormedPin} first; behaviour on
 * malformed input is unspecified. Never call this on a verification
 * attempt: it must gate creation only.
 */
export function isWeakPin(pin: string): boolean {
  if (WEAK_PIN_DENYLIST.has(pin)) return true;
  const d = pin.split('').map(Number);
  // Single repeated digit: 0000, 7777, ...
  if (d.every((n) => n === d[0])) return true;
  // Trivially sequential, ascending or descending by one.
  const ascending = d.every((n, i) => i === 0 || n === (d[i - 1] ?? 0) + 1);
  const descending = d.every((n, i) => i === 0 || n === (d[i - 1] ?? 0) - 1);
  return ascending || descending;
}

/** Dependencies for the policy functions. `now` is injectable for tests. */
export interface PinPolicyDeps {
  store: PinStore;
  now?: () => number;
}

/** True when a PIN record exists for the MSISDN. */
export async function hasPin(deps: PinPolicyDeps, msisdn: string): Promise<boolean> {
  return (await deps.store.get(msisdn)) !== undefined;
}

/**
 * Store the hash of a newly established PIN, resetting any lockout state.
 * The caller has already confirmed the PIN (two matching entries).
 */
export async function establishPin(
  deps: PinPolicyDeps,
  msisdn: string,
  pin: string,
): Promise<void> {
  const hash = await hashPin(pin);
  await deps.store.put(msisdn, { hash, failures: 0, lockedUntil: 0 });
}

/**
 * Verify a PIN attempt against the stored record, enforcing lockout.
 *
 * Order matters for cost and for information leaks:
 * 1. An active lockout is refused BEFORE any hashing, so a locked MSISDN
 *    costs nothing and reveals nothing about the stored PIN.
 * 2. A failed attempt increments the counter through the store's ATOMIC
 *    {@link PinStore.recordFailure}; the attempt that reaches `maxAttempts`
 *    locks. Because the increment is indivisible, concurrent wrong guesses
 *    each cost a real failure instead of collapsing to one.
 * 3. Success clears the counter atomically.
 *
 * @throws PinLockedError when locked out (existing or newly triggered).
 * @throws PinRejectedError on a wrong PIN below the lockout threshold,
 *   carrying the remaining attempt count.
 * @throws Error when no record exists; callers route unregistered MSISDNs
 *   to the setup flow first, so this indicates a state machine bug.
 */
export async function verifyPinAttempt(
  deps: PinPolicyDeps,
  msisdn: string,
  pin: string,
): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const record = await deps.store.get(msisdn);
  if (record === undefined) {
    throw new Error('No PIN record exists; the setup flow must run first.');
  }

  // Lock check before any scrypt work: a locked MSISDN costs nothing and
  // reveals nothing about the stored PIN.
  if (record.lockedUntil > now) {
    throw new PinLockedError(record.lockedUntil);
  }

  if (await verifyPin(pin, record.hash)) {
    await deps.store.clearFailures(msisdn);
    return;
  }

  // Wrong PIN: record the failure ATOMICALLY. The store increments and,
  // if the threshold is reached, locks, as one indivisible step, so a
  // batch of concurrent wrong guesses each cost a genuine failure instead
  // of collapsing to one (the finding-1 race).
  const outcome = await deps.store.recordFailure(
    msisdn,
    now,
    PIN_POLICY.maxAttempts,
    PIN_POLICY.lockoutMs,
  );
  if (outcome.locked) {
    throw new PinLockedError(outcome.lockedUntil);
  }
  throw new PinRejectedError(PIN_POLICY.maxAttempts - outcome.failures);
}
