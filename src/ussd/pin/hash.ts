/**
 * PIN hashing: scrypt via `node:crypto`, zero native dependencies.
 *
 * ## Scheme and parameters
 *
 * `scrypt` with N=2^15, r=8, p=1, a 16 byte random salt per MSISDN, and a
 * 32 byte derived key, encoded as `scrypt$32768$8$1$<salt b64>$<key b64>`.
 *
 * Rationale: a 4 digit PIN carries 10^4 possibilities, so no KDF makes it
 * strong against online guessing; the lockout policy handles that. What
 * the KDF buys is offline cost on a leaked store: at these parameters one
 * verification costs tens of milliseconds (well inside the per callback
 * budget) and a full 10^4 sweep of one record costs minutes per salt.
 * Argon2id would be the first choice cryptographically but requires a
 * native module, which this reference excludes by design; scrypt is the
 * strongest KDF in the Node standard library (memory hard, unlike PBKDF2).
 *
 * ## The maxmem trap (regression guarded)
 *
 * scrypt's memory use is approximately 128 * N * r bytes: at N=2^15, r=8
 * that is exactly 32 MiB, which HITS Node's default `maxmem` limit of
 * 32 MiB and makes `scrypt` throw before doing any work. `maxmem` is
 * therefore passed explicitly (64 MiB) to keep the chosen work factor
 * rather than silently weakening N. A fresh process unit test proves a
 * hash succeeds with exactly the exported parameters, so a future
 * parameter change that re-trips the default limit fails loudly.
 *
 * ## What never happens here
 *
 * No PIN digits are stored, logged, thrown, or returned. Verification is
 * hash comparison via `timingSafeEqual`; the PIN string exists only as an
 * argument on the stack of these two functions.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/** Promise wrapper preserving the options overload (promisify drops it). */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * The scrypt parameters, exported so the fresh process regression test
 * runs exactly what production code runs.
 */
export const SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  /**
   * 128 * N * r is exactly Node's default 32 MiB limit, which `scrypt`
   * refuses; see the module doc. 64 MiB gives the work factor headroom.
   */
  maxmem: 64 * 1024 * 1024,
} as const;

/**
 * Hash a PIN for storage. Generates a fresh random salt.
 *
 * @returns The encoded record value, `scrypt$N$r$p$<salt b64>$<key b64>`.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);
  const key = await scrypt(pin, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return [
    'scrypt',
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * Ceiling on `N * r` accepted from a stored record. The record is
 * untrusted input to {@link verifyPin}: a value carrying a huge `N` would
 * otherwise drive a multi-gigabyte scrypt allocation that stalls or kills
 * the process. Four times the current work factor leaves generous room for
 * an honest parameter bump while rejecting anything abusive. Records
 * beyond it behave like a wrong PIN (return false), never an allocation.
 */
export const SCRYPT_MAX_NR = 4 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r;

/** Ceiling on the `p` parameter accepted from a stored record. */
export const SCRYPT_MAX_P = 4 * SCRYPT_PARAMS.p;

/**
 * Verify a PIN against an encoded hash. Constant time comparison.
 *
 * The stored parameters are honoured (so records survive a future
 * parameter change), with `maxmem` sized to the stored N and r, but they
 * are bounded first: a record whose `N * r` or `p` exceeds the ceilings
 * above is rejected without allocating (see {@link SCRYPT_MAX_NR}).
 *
 * @returns true on match; false on mismatch or on a malformed record
 *   (a malformed record must behave like a wrong PIN, not crash the
 *   session).
 */
export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (saltRaw === undefined || hashRaw === undefined) return false;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N <= 1 || r <= 0 || p <= 0) return false;
  // Bound the work parameters taken from the untrusted record BEFORE any
  // allocation, so an oversized N returns false fast rather than exhausting
  // memory. This restores the module's stated property that a malformed
  // record behaves like a wrong PIN.
  if (N * r > SCRYPT_MAX_NR || p > SCRYPT_MAX_P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64');
    expected = Buffer.from(hashRaw, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let key: Buffer;
  try {
    key = await scrypt(pin, salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(SCRYPT_PARAMS.maxmem, 256 * N * r),
    });
  } catch {
    // Unsatisfiable parameters in a corrupted record: treat as no match.
    return false;
  }
  return timingSafeEqual(key, expected);
}
