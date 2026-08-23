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
 * 2. A failed attempt increments the counter; the attempt that reaches
 *    `maxAttempts` sets `lockedUntil` and reports the lockout.
 * 3. Success clears the counter.
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

  if (record.lockedUntil > now) {
    throw new PinLockedError(record.lockedUntil);
  }

  if (await verifyPin(pin, record.hash)) {
    if (record.failures !== 0 || record.lockedUntil !== 0) {
      await deps.store.put(msisdn, { ...record, failures: 0, lockedUntil: 0 });
    }
    return;
  }

  const failures = (record.lockedUntil > 0 ? 0 : record.failures) + 1;
  if (failures >= PIN_POLICY.maxAttempts) {
    const lockedUntil = now + PIN_POLICY.lockoutMs;
    await deps.store.put(msisdn, { ...record, failures, lockedUntil });
    throw new PinLockedError(lockedUntil);
  }
  await deps.store.put(msisdn, { ...record, failures, lockedUntil: 0 });
  throw new PinRejectedError(PIN_POLICY.maxAttempts - failures);
}
