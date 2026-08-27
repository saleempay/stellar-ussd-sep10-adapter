import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { PinLockedError, PinRejectedError } from '../../src/errors.js';
import {
  SCRYPT_MAX_NR,
  SCRYPT_PARAMS,
  hashPin,
  verifyPin,
} from '../../src/ussd/pin/hash.js';
import { InMemoryPinStore } from '../../src/ussd/pin/memoryStore.js';
import { JsonFilePinStore } from '../../src/ussd/pin/jsonFileStore.js';
import {
  PIN_POLICY,
  establishPin,
  hasPin,
  isWeakPin,
  isWellFormedPin,
  verifyPinAttempt,
} from '../../src/ussd/pin/policy.js';
import type { PinStore } from '../../src/ussd/pin/types.js';

// Fixture PINs, also swept for in the no plaintext assertions of the
// simulated gateway suite. Chosen with four distinct digits so a substring
// match is meaningful.
const PIN_A = '7391';
const PIN_B = '2846';
const MSISDN = '+999700000001';

describe('hashPin / verifyPin', () => {
  it('round-trips: a hashed PIN verifies', async () => {
    const encoded = await hashPin(PIN_A);
    expect(await verifyPin(PIN_A, encoded)).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const encoded = await hashPin(PIN_A);
    expect(await verifyPin(PIN_B, encoded)).toBe(false);
  });

  it('encodes parameters and salt, never PIN digits', async () => {
    const encoded = await hashPin(PIN_A);
    const parts = encoded.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toBe(String(SCRYPT_PARAMS.N));
    expect(parts[2]).toBe(String(SCRYPT_PARAMS.r));
    expect(parts[3]).toBe(String(SCRYPT_PARAMS.p));
    expect(encoded).not.toContain(PIN_A);
  });

  it('salts: two hashes of the same PIN differ', async () => {
    expect(await hashPin(PIN_A)).not.toBe(await hashPin(PIN_A));
  });

  it.each([
    ['empty string', ''],
    ['wrong scheme', 'bcrypt$10$x$y'],
    ['too few segments', 'scrypt$32768$8$1$c2FsdA=='],
    ['non-numeric N', 'scrypt$big$8$1$c2FsdA==$aGFzaA=='],
    ['zero r', 'scrypt$32768$0$1$c2FsdA==$aGFzaA=='],
    ['empty salt', 'scrypt$32768$8$1$$aGFzaA=='],
    ['empty hash', 'scrypt$32768$8$1$c2FsdA==$'],
  ])('treats a malformed record (%s) as non-matching, not a crash', async (_l, bad) => {
    expect(await verifyPin(PIN_A, bad)).toBe(false);
  });

  it('honours stored parameters from older records', async () => {
    // A record written at lower cost still verifies (forward compatibility
    // for future parameter bumps).
    const { scryptSync } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef');
    const key = scryptSync(PIN_A, salt, 32, { N: 16384, r: 8, p: 1 });
    const legacy = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPin(PIN_A, legacy)).toBe(true);
    expect(await verifyPin(PIN_B, legacy)).toBe(false);
  });

  it('production parameters exceed the default maxmem, so maxmem is explicit', () => {
    // Documents the trap this module guards against: 128 * N * r equals
    // Node's default 32 MiB limit exactly, and scrypt refuses at the limit.
    expect(128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r).toBeGreaterThanOrEqual(32 * 1024 * 1024);
    expect(SCRYPT_PARAMS.maxmem).toBeGreaterThan(128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r);
  });

  it('fresh process regression: a hash at the exported parameters succeeds', () => {
    // Runs the exact production parameters in a brand new Node process with
    // default settings. Guards against the scrypt maxmem trap: if a future
    // parameter change re-trips Node's default 32 MiB limit without
    // adjusting maxmem, this exits non-zero and fails here.
    const script = [
      "const { scryptSync } = require('node:crypto');",
      `const p = ${JSON.stringify(SCRYPT_PARAMS)};`,
      "const key = scryptSync('0000', Buffer.alloc(p.saltLength), p.keyLength,",
      '  { N: p.N, r: p.r, p: p.p, maxmem: p.maxmem });',
      'if (key.length !== p.keyLength) process.exit(1);',
    ].join('\n');
    expect(() =>
      execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 30_000 }),
    ).not.toThrow();
  });

  it('fresh process counterexample: the same N and r without maxmem throw', () => {
    // Proves the trap is real (and that the regression test above is
    // actually exercising it): default maxmem refuses these parameters.
    const script = [
      "const { scryptSync } = require('node:crypto');",
      `const p = ${JSON.stringify(SCRYPT_PARAMS)};`,
      "try { scryptSync('0000', Buffer.alloc(p.saltLength), p.keyLength,",
      '  { N: p.N, r: p.r, p: p.p }); process.exit(1); } catch { process.exit(0); }',
    ].join('\n');
    expect(() =>
      execFileSync(process.execPath, ['-e', script], { stdio: 'pipe', timeout: 30_000 }),
    ).not.toThrow();
  });
});

describe('isWellFormedPin', () => {
  it.each(['7391', '0000', '9999'])('accepts %s', (pin) => {
    expect(isWellFormedPin(pin)).toBe(true);
  });

  it.each(['123', '12345', '12a4', '', ' 1234', '12 4'])('rejects %j', (pin) => {
    expect(isWellFormedPin(pin)).toBe(false);
  });
});

function policyDeps(store: PinStore, nowRef: { value: number }) {
  return { store, now: () => nowRef.value };
}

describe('PIN policy', () => {
  it('hasPin reflects establishment', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    expect(await hasPin(policyDeps(store, now), MSISDN)).toBe(false);
    await establishPin(policyDeps(store, now), MSISDN, PIN_A);
    expect(await hasPin(policyDeps(store, now), MSISDN)).toBe(true);
  });

  it('verifies a correct PIN silently', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    await establishPin(policyDeps(store, now), MSISDN, PIN_A);
    await expect(verifyPinAttempt(policyDeps(store, now), MSISDN, PIN_A)).resolves.toBeUndefined();
  });

  it('rejects a wrong PIN with the remaining attempt count', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    await establishPin(policyDeps(store, now), MSISDN, PIN_A);
    const err = await verifyPinAttempt(policyDeps(store, now), MSISDN, PIN_B).catch((e) => e);
    expect(err).toBeInstanceOf(PinRejectedError);
    expect((err as PinRejectedError).attemptsLeft).toBe(PIN_POLICY.maxAttempts - 1);
  });

  it('locks out on the third consecutive failure', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = policyDeps(store, now);
    await establishPin(deps, MSISDN, PIN_A);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).rejects.toBeInstanceOf(PinRejectedError);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).rejects.toBeInstanceOf(PinRejectedError);
    const err = await verifyPinAttempt(deps, MSISDN, PIN_B).catch((e) => e);
    expect(err).toBeInstanceOf(PinLockedError);
    expect((err as PinLockedError).lockedUntil).toBe(now.value + PIN_POLICY.lockoutMs);
  });

  it('refuses a locked MSISDN before any hashing, even with the right PIN', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = policyDeps(store, now);
    await establishPin(deps, MSISDN, PIN_A);
    for (let i = 0; i < PIN_POLICY.maxAttempts; i++) {
      await verifyPinAttempt(deps, MSISDN, PIN_B).catch(() => undefined);
    }
    await expect(verifyPinAttempt(deps, MSISDN, PIN_A)).rejects.toBeInstanceOf(PinLockedError);
  });

  it('lockout expires after its TTL and counting restarts', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = policyDeps(store, now);
    await establishPin(deps, MSISDN, PIN_A);
    for (let i = 0; i < PIN_POLICY.maxAttempts; i++) {
      await verifyPinAttempt(deps, MSISDN, PIN_B).catch(() => undefined);
    }
    now.value += PIN_POLICY.lockoutMs + 1;
    // First failure after expiry is failure 1 of a fresh count, not lockout.
    const err = await verifyPinAttempt(deps, MSISDN, PIN_B).catch((e) => e);
    expect(err).toBeInstanceOf(PinRejectedError);
    expect((err as PinRejectedError).attemptsLeft).toBe(PIN_POLICY.maxAttempts - 1);
    // And the right PIN now succeeds and clears the counter.
    await expect(verifyPinAttempt(deps, MSISDN, PIN_A)).resolves.toBeUndefined();
    expect((await store.get(MSISDN))?.failures).toBe(0);
  });

  it('success clears an accumulated failure count', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = policyDeps(store, now);
    await establishPin(deps, MSISDN, PIN_A);
    await verifyPinAttempt(deps, MSISDN, PIN_B).catch(() => undefined);
    await verifyPinAttempt(deps, MSISDN, PIN_A);
    expect((await store.get(MSISDN))?.failures).toBe(0);
  });

  it('throws plainly when no record exists (state machine bug guard)', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    await expect(verifyPinAttempt(policyDeps(store, now), MSISDN, PIN_A)).rejects.toThrow(
      /setup flow/,
    );
  });

  it('re-establishing a PIN resets lockout state', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = policyDeps(store, now);
    await establishPin(deps, MSISDN, PIN_A);
    for (let i = 0; i < PIN_POLICY.maxAttempts; i++) {
      await verifyPinAttempt(deps, MSISDN, PIN_B).catch(() => undefined);
    }
    await establishPin(deps, MSISDN, PIN_B);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).resolves.toBeUndefined();
  });
});

describe('PIN stores', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function jsonStore(): JsonFilePinStore {
    const dir = mkdtempSync(join(tmpdir(), 'pinstore-'));
    dirs.push(dir);
    return new JsonFilePinStore(join(dir, 'pins.json'));
  }

  it.each([
    ['InMemoryPinStore', () => new InMemoryPinStore() as PinStore],
    ['JsonFilePinStore', () => jsonStore() as PinStore],
  ])('%s: put, get, delete round-trip', async (_name, make) => {
    const store = make();
    const record = { hash: 'scrypt$1$1$1$c2FsdA==$aGFzaA==', failures: 1, lockedUntil: 5 };
    expect(await store.get(MSISDN)).toBeUndefined();
    await store.put(MSISDN, record);
    expect(await store.get(MSISDN)).toEqual(record);
    await store.delete(MSISDN);
    expect(await store.get(MSISDN)).toBeUndefined();
  });

  it('returned records are copies, not live references', async () => {
    const store = new InMemoryPinStore();
    await store.put(MSISDN, { hash: 'h', failures: 0, lockedUntil: 0 });
    const record = await store.get(MSISDN);
    record!.failures = 99;
    expect((await store.get(MSISDN))?.failures).toBe(0);
  });

  it('JsonFilePinStore persists across instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pinstore-'));
    dirs.push(dir);
    const path = join(dir, 'pins.json');
    await new JsonFilePinStore(path).put(MSISDN, { hash: 'h', failures: 0, lockedUntil: 0 });
    expect((await new JsonFilePinStore(path).get(MSISDN))?.hash).toBe('h');
  });
});

// ---------------------------------------------------------------------------
// F1 (blocking): the lockout counter must be atomic. These reproduce the
// reviewer's measured probe: concurrent wrong guesses each cost a real
// failure instead of collapsing to one, so a batch of arbitrary width no
// longer buys unlimited guesses per lock window.
// ---------------------------------------------------------------------------

describe("F1 regression: atomic PIN lockout (reviewer's concurrency probe)", () => {
  it('20 concurrent wrong guesses record real failures and lock the account', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = { store, now: () => now.value };
    await establishPin(deps, MSISDN, PIN_A);

    // The reviewer's probe: fire 20 wrong attempts concurrently.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => verifyPinAttempt(deps, MSISDN, PIN_B)),
    );

    // The bug recorded exactly 1 failure and did not lock. The fix records
    // one failure per attempt (well past the threshold) and locks.
    const record = await store.get(MSISDN);
    expect(record?.failures).toBeGreaterThanOrEqual(PIN_POLICY.maxAttempts);
    expect(record?.failures).toBe(20);
    expect(record?.lockedUntil).toBe(now.value + PIN_POLICY.lockoutMs);

    // Every attempt was rejected; none authenticated.
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const locked = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof PinLockedError,
    );
    expect(locked.length).toBeGreaterThan(0);
  });

  it('sequential control: 3 wrong attempts lock (documents both paths)', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = { store, now: () => now.value };
    await establishPin(deps, MSISDN, PIN_A);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).rejects.toBeInstanceOf(PinRejectedError);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).rejects.toBeInstanceOf(PinRejectedError);
    await expect(verifyPinAttempt(deps, MSISDN, PIN_B)).rejects.toBeInstanceOf(PinLockedError);
    expect((await store.get(MSISDN))?.failures).toBe(PIN_POLICY.maxAttempts);
  });

  it('once locked, a concurrent batch containing the correct PIN does not authenticate', async () => {
    const store = new InMemoryPinStore();
    const now = { value: 1_000_000 };
    const deps = { store, now: () => now.value };
    await establishPin(deps, MSISDN, PIN_A);

    // Lock it first.
    await Promise.allSettled(
      Array.from({ length: 20 }, () => verifyPinAttempt(deps, MSISDN, PIN_B)),
    );
    expect((await store.get(MSISDN))?.lockedUntil).toBeGreaterThan(now.value);

    // Now fire a batch where one attempt carries the CORRECT PIN. The
    // reviewer's attack relied on the correct guess authenticating inside a
    // batch; with the lock in place, the pre-scrypt lock check refuses it.
    const batch = [PIN_A, PIN_B, PIN_B, PIN_A, PIN_B];
    const results = await Promise.allSettled(
      batch.map((p) => verifyPinAttempt(deps, MSISDN, p)),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(
      results.every((r) => r.status === 'rejected' && r.reason instanceof PinLockedError),
    ).toBe(true);
  });

  it.each([
    ['InMemoryPinStore', () => new InMemoryPinStore() as PinStore],
  ])(
    '%s: recordFailure is atomic under 20 concurrent calls (store-level)',
    async (_name, make) => {
      const store = make();
      await store.put(MSISDN, { hash: 'h', failures: 0, lockedUntil: 0 });
      const now = 1_000_000;
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () =>
          store.recordFailure(MSISDN, now, PIN_POLICY.maxAttempts, PIN_POLICY.lockoutMs),
        ),
      );
      // Every failure counted: the final record shows 20, not 1.
      expect((await store.get(MSISDN))?.failures).toBe(20);
      expect((await store.get(MSISDN))?.lockedUntil).toBe(now + PIN_POLICY.lockoutMs);
      expect(outcomes.filter((o) => o.locked).length).toBeGreaterThan(0);
    },
  );

  it('recordFailure never clears a lock set by a concurrent sibling', async () => {
    // The subtle race: attempt A locks at the threshold; attempt B, already
    // past its own pre-check, must count on top of the lock, not reset it.
    const store = new InMemoryPinStore();
    await store.put(MSISDN, { hash: 'h', failures: 0, lockedUntil: 0 });
    const now = 1_000_000;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        store.recordFailure(MSISDN, now, PIN_POLICY.maxAttempts, PIN_POLICY.lockoutMs),
      ),
    );
    const rec = await store.get(MSISDN);
    expect(rec?.lockedUntil).toBe(now + PIN_POLICY.lockoutMs);
    expect(rec?.failures).toBe(10);
  });

  it('an expired prior lock starts a fresh count on the next failure', async () => {
    const store = new InMemoryPinStore();
    await store.put(MSISDN, { hash: 'h', failures: PIN_POLICY.maxAttempts, lockedUntil: 500 });
    // now is past the old lock: recordFailure resets to a fresh count of 1.
    const outcome = await store.recordFailure(
      MSISDN,
      1_000_000,
      PIN_POLICY.maxAttempts,
      PIN_POLICY.lockoutMs,
    );
    expect(outcome.failures).toBe(1);
    expect(outcome.locked).toBe(false);
  });

  it('clearFailures resets count and lock atomically, preserving the hash', async () => {
    const store = new InMemoryPinStore();
    await store.put(MSISDN, { hash: 'keep-me', failures: 2, lockedUntil: 999 });
    await store.clearFailures(MSISDN);
    const rec = await store.get(MSISDN);
    expect(rec).toEqual({ hash: 'keep-me', failures: 0, lockedUntil: 0 });
  });
});

// ---------------------------------------------------------------------------
// F3 (defect): verifyPin must bound scrypt memory taken from the stored
// record, so a record with a huge N returns false without allocating.
// ---------------------------------------------------------------------------

describe('F3 regression: verifyPin bounds scrypt parameters from the record', () => {
  it('a record with an oversized N returns false quickly and does not allocate', async () => {
    // 2^30 * 8 is far beyond the ceiling; the unbounded code would have
    // asked scrypt for gigabytes. The guard returns false before scrypt.
    const salt = Buffer.from('0123456789abcdef').toString('base64');
    const hash = Buffer.alloc(32).toString('base64');
    const hostile = `scrypt$${2 ** 30}$8$1$${salt}$${hash}`;
    const before = process.memoryUsage().rss;
    const started = Date.now();
    const result = await verifyPin(PIN_A, hostile);
    const elapsed = Date.now() - started;
    const grewMb = (process.memoryUsage().rss - before) / (1024 * 1024);
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
    // Nowhere near the multi-gigabyte allocation the unbounded path invited.
    expect(grewMb).toBeLessThan(256);
  });

  it('a record exactly at the N*r ceiling is still evaluated (not falsely rejected)', async () => {
    // At the ceiling with a genuine hash for these params, the right PIN
    // still verifies: the guard rejects beyond the ceiling, not at it.
    const { scryptSync } = await import('node:crypto');
    const N = SCRYPT_MAX_NR / SCRYPT_PARAMS.r;
    const salt = Buffer.from('ceiling-salt-16b');
    const key = scryptSync(PIN_A, salt, 32, {
      N,
      r: SCRYPT_PARAMS.r,
      p: 1,
      maxmem: 256 * N * SCRYPT_PARAMS.r,
    });
    const encoded = `scrypt$${N}$${SCRYPT_PARAMS.r}$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPin(PIN_A, encoded)).toBe(true);
    expect(await verifyPin(PIN_B, encoded)).toBe(false);
  });

  it('just beyond the ceiling returns false', async () => {
    const salt = Buffer.from('0123456789abcdef').toString('base64');
    const hash = Buffer.alloc(32).toString('base64');
    const N = (SCRYPT_MAX_NR / SCRYPT_PARAMS.r) * 2;
    const beyond = `scrypt$${N}$${SCRYPT_PARAMS.r}$1$${salt}$${hash}`;
    expect(await verifyPin(PIN_A, beyond)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F4 (suggestion): weak PINs rejected at setup, no information leak.
// ---------------------------------------------------------------------------

describe('F4: weak PIN denylist (setup only)', () => {
  it.each(['0000', '1111', '1234', '1212', '7777', '2345', '5432', '9876'])(
    'rejects the easily guessed PIN %s',
    (pin) => {
      expect(isWeakPin(pin)).toBe(true);
    },
  );

  it.each([PIN_A, PIN_B, '9137', '4820', '3607'])('accepts the normal PIN %s', (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });
});
