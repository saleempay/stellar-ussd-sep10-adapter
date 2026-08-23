import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { PinLockedError, PinRejectedError } from '../../src/errors.js';
import { SCRYPT_PARAMS, hashPin, verifyPin } from '../../src/ussd/pin/hash.js';
import { InMemoryPinStore } from '../../src/ussd/pin/memoryStore.js';
import { JsonFilePinStore } from '../../src/ussd/pin/jsonFileStore.js';
import {
  PIN_POLICY,
  establishPin,
  hasPin,
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
