/**
 * Issue #9: a returning PIN entry before account creation.
 *
 * Reproduces the Run 1 sequence recorded in EVIDENCE.md ("Demo video
 * recording, 24 September 2026"): session A sets and confirms a PIN, then
 * ends at the "Create your account" prompt without an account being
 * created; session B for the same MSISDN selects sign in and is asked
 * "Enter your PIN". The entered PIN must be verified against the stored
 * hash, never stored in its place, and the screen that follows must not
 * claim the PIN was saved.
 */

import { describe, expect, it } from 'vitest';

import type { GatewayStep } from '../../src/ussd/gateway/types.js';
import { handleStep, type JourneySeam, type MachineDeps } from '../../src/ussd/menu/machine.js';
import { InMemoryPinStore } from '../../src/ussd/pin/memoryStore.js';
import { establishPin, PIN_POLICY } from '../../src/ussd/pin/policy.js';
import { InMemorySessionStore } from '../../src/ussd/session/memoryStore.js';

const MSISDN = '+999700000001';
const ACCOUNT = 'GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM';
const PIN = '7391';
const WRONG_PIN = '2846';
const T0 = 1_000_000;

function harness(prefilledAccount?: string) {
  const sessions = new InMemorySessionStore();
  const pins = new InMemoryPinStore();
  const mapped = new Map<string, string>(prefilledAccount ? [[MSISDN, prefilledAccount]] : []);
  const counts = { create: 0, auth: 0 };
  const journey: JourneySeam = {
    async lookupAccount(msisdn) {
      return mapped.get(msisdn);
    },
    async checkTrustline() {},
    async createAccount(msisdn) {
      counts.create += 1;
      mapped.set(msisdn, ACCOUNT);
      return { accountId: ACCOUNT, creationTxHash: 'ab'.repeat(32) };
    },
    async authenticateAndDeposit() {
      counts.auth += 1;
      return {
        token: 'header.payload.signature',
        claims: { sub: ACCOUNT, iat: 1, exp: 2 },
        depositRef: 'dep12345',
      };
    },
  };
  const deps: MachineDeps = {
    sessions,
    pins,
    journey,
    msisdn: { defaultCountryCode: '999' },
    now: () => T0,
  };
  async function send(inputs: string[], sessionId: string) {
    const step: GatewayStep = { sessionId, msisdnRaw: MSISDN, inputs, rawText: inputs.join('*') };
    const screen = await handleStep(deps, step);
    return { kind: screen.kind, text: screen.text, hop: screen.hop };
  }
  return { pins, counts, send };
}

/**
 * Session A of Run 1: dial, sign in, set the PIN, confirm it, and stop at
 * the "Create your account" prompt. No account is created. Returns the
 * stored hash for later byte comparison.
 */
async function sessionA(h: ReturnType<typeof harness>): Promise<string> {
  await h.send([], 'A');
  await h.send(['1'], 'A');
  await h.send(['1', PIN], 'A');
  const prompt = await h.send(['1', PIN, PIN], 'A');
  expect(prompt.text).toContain('1. Create your account');
  expect(h.counts.create).toBe(0);
  const record = await h.pins.get(MSISDN);
  expect(record).toBeDefined();
  return record!.hash;
}

/** Session B of Run 1 up to the PIN prompt. */
async function sessionBToPin(h: ReturnType<typeof harness>): Promise<void> {
  await h.send([], 'B');
  expect((await h.send(['1'], 'B')).text).toBe('Enter your PIN');
}

describe('issue #9: PIN entry for an MSISDN with a stored PIN and no account', () => {
  it('the correct PIN continues to account creation without claiming the PIN was saved', async () => {
    const h = harness();
    const hashBefore = await sessionA(h);
    await sessionBToPin(h);

    const next = await h.send(['1', PIN], 'B');
    expect(next.kind).toBe('con');
    expect(next.text).toContain('1. Create your account');
    expect(next.text).not.toContain('PIN saved');

    // Verification, not storage: the record is the one session A wrote.
    expect((await h.pins.get(MSISDN))?.hash).toBe(hashBefore);

    // And the journey completes from here as before.
    expect((await h.send(['1', PIN, '1'], 'B')).text).toContain('Account ready');
    const confirm = await h.send(['1', PIN, '1', PIN], 'B');
    expect(confirm.kind).toBe('end');
    expect(confirm.text).toContain('Verified by the anchor. Test only, no funds move');
    expect(h.counts.create).toBe(1);
    expect(h.counts.auth).toBe(1);
  });

  it('a wrong PIN is refused and the stored hash is unchanged, byte for byte', async () => {
    const h = harness();
    const hashBefore = await sessionA(h);
    await sessionBToPin(h);

    const refused = await h.send(['1', WRONG_PIN], 'B');
    expect(refused.kind).toBe('con');
    expect(refused.text).toContain('Wrong PIN');
    expect(refused.text).not.toContain('PIN saved');
    expect(refused.text).not.toContain('Create your account');

    const after = await h.pins.get(MSISDN);
    expect(Buffer.from(after!.hash, 'utf8').equals(Buffer.from(hashBefore, 'utf8'))).toBe(true);
    expect(after!.failures).toBe(1);

    // The wrong PIN did not become the PIN: the original still verifies.
    const next = await h.send(['1', WRONG_PIN, PIN], 'B');
    expect(next.text).toContain('1. Create your account');
    expect(h.counts.create).toBe(0);
    expect(h.counts.auth).toBe(0);
  });

  it('repeated wrong PINs trigger the existing lockout', async () => {
    const h = harness();
    const hashBefore = await sessionA(h);
    await sessionBToPin(h);

    const inputs = ['1'];
    let last = { kind: '', text: '' };
    for (let i = 0; i < PIN_POLICY.maxAttempts; i += 1) {
      inputs.push(WRONG_PIN);
      last = await h.send([...inputs], 'B');
    }
    expect(last.kind).toBe('end');
    expect(last.text).toContain('Too many wrong PINs');

    const after = await h.pins.get(MSISDN);
    expect(after!.hash).toBe(hashBefore);
    expect(after!.lockedUntil).toBeGreaterThan(T0);

    // A fresh session with the correct PIN is still refused while locked,
    // and no account is created.
    await h.send([], 'C');
    await h.send(['1'], 'C');
    const locked = await h.send(['1', PIN], 'C');
    expect(locked.kind).toBe('end');
    expect(locked.text).toContain('Too many wrong PINs');
    expect(h.counts.create).toBe(0);
  });

  it('a duplicate callback or an invalid choice after verification never says "PIN saved"', async () => {
    const h = harness();
    await sessionA(h);
    await sessionBToPin(h);
    expect((await h.send(['1', PIN], 'B')).text).toContain('PIN accepted');

    // Gateway retry of the same callback: harmless re-prompt, same wording.
    const duplicate = await h.send(['1', PIN], 'B');
    expect(duplicate.text).toContain('1. Create your account');
    expect(duplicate.text).not.toContain('PIN saved');

    // Invalid choice at the prompt: re-prompt, same wording.
    const invalid = await h.send(['1', PIN, '9'], 'B');
    expect(invalid.text).toContain('Invalid choice');
    expect(invalid.text).not.toContain('PIN saved');
  });

  it('the setup path still says "PIN saved", where a PIN really was stored', async () => {
    const h = harness();
    await h.send([], 'A');
    await h.send(['1'], 'A');
    await h.send(['1', PIN], 'A');
    expect((await h.send(['1', PIN, PIN], 'A')).text).toBe(
      'PIN saved\n1. Create your account and continue',
    );
    expect((await h.send(['1', PIN, PIN, '9'], 'A')).text).toContain('PIN saved');
  });

  it('the returning user with an account path is unchanged', async () => {
    const h = harness(ACCOUNT);
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([], 'R');
    expect((await h.send(['1'], 'R')).text).toBe('Enter your PIN');
    const confirm = await h.send(['1', PIN], 'R');
    expect(confirm.kind).toBe('end');
    expect(confirm.text).toContain('Verified by the anchor. Test only, no funds move');
    expect(h.counts.create).toBe(0);
    expect(h.counts.auth).toBe(1);
  });
});
