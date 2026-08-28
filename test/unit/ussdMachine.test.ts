import { describe, expect, it } from 'vitest';

import {
  ChallengeValidationError,
  SignerUnavailableError,
  TransactionFailedError,
  TrustlineMissingError,
  WebAuthRequestFailedError,
} from '../../src/errors.js';
import type { GatewayStep } from '../../src/ussd/gateway/types.js';
import { handleStep, type JourneySeam, type MachineDeps } from '../../src/ussd/menu/machine.js';
import { InMemoryPinStore } from '../../src/ussd/pin/memoryStore.js';
import { establishPin } from '../../src/ussd/pin/policy.js';
import { InMemorySessionStore } from '../../src/ussd/session/memoryStore.js';

const MSISDN = '+999700000001';
const ACCOUNT = 'GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM';
const PIN = '7391';
const WRONG_PIN = '2846';
const T0 = 1_000_000;

interface StubJourney extends JourneySeam {
  createCalls: number;
  authCalls: number;
  trustlineChecks: number;
  mapped: Map<string, string>;
  failAuthWith?: unknown;
  failCreateWith?: unknown;
  failTrustlineWith?: unknown;
}

function stubJourney(prefilled?: string): StubJourney {
  const journey: StubJourney = {
    createCalls: 0,
    authCalls: 0,
    trustlineChecks: 0,
    mapped: new Map(prefilled ? [[MSISDN, prefilled]] : []),
    async lookupAccount(msisdn) {
      return journey.mapped.get(msisdn);
    },
    async checkTrustline() {
      journey.trustlineChecks += 1;
      if (journey.failTrustlineWith !== undefined) throw journey.failTrustlineWith;
    },
    async createAccount(msisdn) {
      journey.createCalls += 1;
      if (journey.failCreateWith !== undefined) throw journey.failCreateWith;
      journey.mapped.set(msisdn, ACCOUNT);
      return { accountId: ACCOUNT, creationTxHash: 'ab'.repeat(32) };
    },
    async authenticateAndDeposit() {
      journey.authCalls += 1;
      if (journey.failAuthWith !== undefined) throw journey.failAuthWith;
      return {
        token: 'header.payload.signature',
        claims: { sub: ACCOUNT, iat: 1, exp: 2 },
        depositRef: 'dep12345',
      };
    },
  };
  return journey;
}

interface Harness {
  deps: MachineDeps;
  journey: StubJourney;
  pins: InMemoryPinStore;
  sessions: InMemorySessionStore;
  logs: string[];
  clock: { value: number };
  send(inputs: string[], sessionId?: string): Promise<{ kind: string; text: string }>;
}

function harness(options: { prefilledAccount?: string; ttlMs?: number } = {}): Harness {
  const sessions = new InMemorySessionStore(options.ttlMs);
  const pins = new InMemoryPinStore();
  const journey = stubJourney(options.prefilledAccount);
  const logs: string[] = [];
  const clock = { value: T0 };
  const deps: MachineDeps = {
    sessions,
    pins,
    journey,
    msisdn: { defaultCountryCode: '999' },
    now: () => clock.value,
    log: (line) => logs.push(line),
  };
  return {
    deps,
    journey,
    pins,
    sessions,
    logs,
    clock,
    async send(inputs: string[], sessionId = 'S1') {
      const step: GatewayStep = {
        sessionId,
        msisdnRaw: MSISDN,
        inputs,
        rawText: inputs.join('*'),
      };
      const screen = await handleStep(deps, step);
      return { kind: screen.kind, text: screen.text };
    },
  };
}

/** Drive a full first-use journey up to (not including) the final PIN. */
async function driveToFinalPin(h: Harness): Promise<void> {
  await h.send([]);
  await h.send(['1']);
  await h.send(['1', PIN]);
  await h.send(['1', PIN, PIN]);
  await h.send(['1', PIN, PIN, '1']);
}

describe('menu machine: happy paths', () => {
  it('first use: dial, setup, create, PIN, journey, confirmation', async () => {
    const h = harness();
    expect((await h.send([])).text).toContain('1. Sign in and deposit');
    expect((await h.send(['1'])).text).toContain('Create a 4 digit PIN');
    expect((await h.send(['1', PIN])).text).toContain('Enter the PIN again');
    expect((await h.send(['1', PIN, PIN])).text).toContain('1. Create your account');
    const ready = await h.send(['1', PIN, PIN, '1']);
    expect(ready.text).toContain('Account ready');
    expect(h.journey.createCalls).toBe(1);
    const confirm = await h.send(['1', PIN, PIN, '1', PIN]);
    expect(confirm.kind).toBe('end');
    expect(confirm.text).toContain('Signed in as GAA3..EAFM');
    expect(confirm.text).toContain('Ref dep12345');
    expect(h.journey.authCalls).toBe(1);
  });

  it('returning user: dial, PIN, journey, confirmation, no creation', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    expect((await h.send(['1'])).text).toBe('Enter your PIN');
    const confirm = await h.send(['1', PIN]);
    expect(confirm.kind).toBe('end');
    expect(confirm.text).toContain('Verified by the anchor. Test only, no funds move');
    expect(h.journey.createCalls).toBe(0);
    expect(h.journey.authCalls).toBe(1);
  });

  it('about branch ends the session', async () => {
    const h = harness();
    await h.send([]);
    const info = await h.send(['2']);
    expect(info.kind).toBe('end');
    expect(info.text).toContain('No funds move');
  });

  it('divergence path: PIN exists but no mapping routes through creation', async () => {
    const h = harness();
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    expect((await h.send(['1'])).text).toBe('Enter your PIN');
    expect((await h.send(['1', PIN])).text).toContain('1. Create your account');
    expect((await h.send(['1', PIN, '1'])).text).toContain('Account ready');
    const confirm = await h.send(['1', PIN, '1', PIN]);
    expect(confirm.kind).toBe('end');
    expect(h.journey.createCalls).toBe(1);
  });
});

describe('menu machine: input validation', () => {
  it('invalid welcome choice re-prompts', async () => {
    const h = harness();
    await h.send([]);
    const screen = await h.send(['9']);
    expect(screen.kind).toBe('con');
    expect(screen.text).toContain('Invalid choice');
  });

  it('malformed setup PIN re-prompts with the format rule', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    expect((await h.send(['1', '12'])).text).toContain('PIN must be exactly 4 digits');
  });

  it('setup mismatch restarts setup', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    await h.send(['1', PIN]);
    const screen = await h.send(['1', PIN, WRONG_PIN]);
    expect(screen.text).toContain('PINs did not match');
    // And the restart works.
    await h.send(['1', PIN, WRONG_PIN, PIN]);
    const confirm = await h.send(['1', PIN, WRONG_PIN, PIN, PIN]);
    expect(confirm.text).toContain('1. Create your account');
  });

  it('malformed PIN at entry is not counted as an attempt', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    await h.send(['1']);
    expect((await h.send(['1', 'abcd'])).text).toContain('PIN must be exactly 4 digits');
    expect((await h.pins.get(MSISDN))?.failures).toBe(0);
  });
});

describe('menu machine: PIN enforcement', () => {
  it('wrong PIN shows remaining attempts and third failure locks', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    await h.send(['1']);
    expect((await h.send(['1', WRONG_PIN])).text).toContain('2 attempts left');
    expect((await h.send(['1', WRONG_PIN, WRONG_PIN])).text).toContain('1 attempt left');
    const locked = await h.send(['1', WRONG_PIN, WRONG_PIN, WRONG_PIN]);
    expect(locked.kind).toBe('end');
    expect(locked.text).toContain('Too many wrong PINs');
    expect(h.journey.authCalls).toBe(0);
  });

  it('a locked MSISDN is refused in a fresh session even with the right PIN', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    await h.send(['1']);
    await h.send(['1', WRONG_PIN]);
    await h.send(['1', WRONG_PIN, WRONG_PIN]);
    await h.send(['1', WRONG_PIN, WRONG_PIN, WRONG_PIN]);
    // New gateway session, same MSISDN, correct PIN.
    await h.send([], 'S2');
    await h.send(['1'], 'S2');
    const refused = await h.send(['1', PIN], 'S2');
    expect(refused.kind).toBe('end');
    expect(refused.text).toContain('Too many wrong PINs');
    expect(h.journey.authCalls).toBe(0);
  });
});

describe('menu machine: session expiry', () => {
  it('a callback after the TTL gets the timeout screen', async () => {
    const h = harness({ prefilledAccount: ACCOUNT, ttlMs: 120_000 });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    await h.send(['1']);
    h.clock.value += 120_000;
    const screen = await h.send(['1', PIN]);
    expect(screen.kind).toBe('end');
    expect(screen.text).toContain('Session expired');
    expect(h.journey.authCalls).toBe(0);
  });

  it('an unknown session with inputs gets the timeout screen', async () => {
    const h = harness();
    const screen = await h.send(['1']);
    expect(screen.text).toContain('Session expired');
  });
});

describe('menu machine: replay and duplicates', () => {
  it('replaying the completed final callback is rejected without a second journey', async () => {
    const h = harness();
    await driveToFinalPin(h);
    const confirm = await h.send(['1', PIN, PIN, '1', PIN]);
    expect(confirm.kind).toBe('end');
    expect(h.journey.authCalls).toBe(1);
    // The machine level replay: same session, same cumulative inputs.
    const replay = await h.send(['1', PIN, PIN, '1', PIN]);
    expect(replay.kind).toBe('end');
    expect(replay.text).toContain('already completed');
    expect(h.journey.authCalls).toBe(1);
  });

  it('a shorter (stale) callback after completion is rejected', async () => {
    const h = harness();
    await driveToFinalPin(h);
    await h.send(['1', PIN, PIN, '1', PIN]);
    const stale = await h.send(['1', PIN, PIN]);
    expect(stale.text).toContain('already completed');
    expect(h.journey.authCalls).toBe(1);
  });

  it('a duplicate mid-flow callback re-prompts harmlessly without side effects', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    const dup = await h.send(['1']);
    expect(dup.kind).toBe('con');
    expect(dup.text).toBe('Create a 4 digit PIN');
    expect(h.journey.createCalls).toBe(0);
  });

  it('an extended callback after an END screen is rejected', async () => {
    const h = harness();
    await driveToFinalPin(h);
    await h.send(['1', PIN, PIN, '1', PIN]);
    const after = await h.send(['1', PIN, PIN, '1', PIN, '1']);
    expect(after.text).toContain('already completed');
    expect(h.journey.authCalls).toBe(1);
  });

  it('concurrent final callbacks trigger exactly one journey', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    await h.send([]);
    await h.send(['1']);
    const [a, b] = await Promise.all([h.send(['1', PIN]), h.send(['1', PIN])]);
    const texts = [a.text, b.text].sort();
    expect(h.journey.authCalls).toBe(1);
    expect(texts.filter((t) => t.includes('Verified by the anchor. Test only, no funds move'))).toHaveLength(1);
  });
});

describe('menu machine: trustline preflight (returning user)', () => {
  it('missing trustline ends the session on the welcome callback', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    h.journey.failTrustlineWith = new TrustlineMissingError(ACCOUNT, 'SRT', ACCOUNT);
    await h.send([]);
    const screen = await h.send(['1']);
    expect(screen.kind).toBe('end');
    expect(screen.text).toContain('cannot hold this asset yet');
    expect(h.journey.authCalls).toBe(0);
  });

  it('a non-trustline preflight failure maps to the service down screen', async () => {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    h.journey.failTrustlineWith = new Error('horizon unreachable');
    await h.send([]);
    const screen = await h.send(['1']);
    expect(screen.kind).toBe('end');
    expect(screen.text).toContain('Service temporarily unavailable');
  });

  it('new users skip the preflight (their account is created with the trustline)', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    expect(h.journey.trustlineChecks).toBe(0);
  });
});

describe('menu machine: journey error mapping', () => {
  async function failWith(err: unknown): Promise<{ kind: string; text: string; h: Harness }> {
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, PIN);
    h.journey.failAuthWith = err;
    await h.send([]);
    await h.send(['1']);
    const screen = await h.send(['1', PIN]);
    return { ...screen, h };
  }

  it('a challenge refusal maps to the auth refused screen, failedCheck in the log only', async () => {
    const { kind, text, h } = await failWith(
      new ChallengeValidationError('timebounds_window_too_wide', 'window is 9000 seconds'),
    );
    expect(kind).toBe('end');
    expect(text).toContain('Sign in refused by the anchor');
    expect(text).not.toContain('timebounds');
    expect(h.logs.join('\n')).toContain('failedCheck=timebounds_window_too_wide');
  });

  it('a network failure maps to the anchor down screen', async () => {
    const { text } = await failWith(
      new WebAuthRequestFailedError('challenge', 0, 'timed out', true),
    );
    expect(text).toContain('Anchor not reachable');
  });

  it('a missing trustline maps to its screen', async () => {
    const { text } = await failWith(new TrustlineMissingError(ACCOUNT, 'SRT', ACCOUNT));
    expect(text).toContain('cannot hold this asset yet');
  });

  it('an unavailable signer maps to its screen', async () => {
    const { text } = await failWith(new SignerUnavailableError(ACCOUNT));
    expect(text).toContain('Signing service unavailable');
  });

  it('a failed account creation maps to its screen', async () => {
    const h = harness();
    h.journey.failCreateWith = new TransactionFailedError('tx_failed');
    await h.send([]);
    await h.send(['1']);
    await h.send(['1', PIN]);
    await h.send(['1', PIN, PIN]);
    const screen = await h.send(['1', PIN, PIN, '1']);
    expect(screen.kind).toBe('end');
    expect(screen.text).toContain('Could not create your account');
  });
});

describe('menu machine: no plaintext PIN anywhere', () => {
  it('logs, session dumps, and masked history never contain fixture PIN digits', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    await h.send(['1', PIN]);
    await h.send(['1', PIN, WRONG_PIN]); // mismatch, restart
    await h.send(['1', PIN, WRONG_PIN, PIN]);
    await h.send(['1', PIN, WRONG_PIN, PIN, PIN]);
    await h.send(['1', PIN, WRONG_PIN, PIN, PIN, '1']);
    await h.send(['1', PIN, WRONG_PIN, PIN, PIN, '1', WRONG_PIN]); // wrong attempt
    await h.send(['1', PIN, WRONG_PIN, PIN, PIN, '1', WRONG_PIN, PIN]); // success

    const session = await h.sessions.get('S1', h.clock.value);
    const observable = [
      h.logs.join('\n'),
      JSON.stringify(session),
      session!.maskedHistory.join('*'),
      JSON.stringify(h.pins.dump()),
    ].join('\n');
    expect(observable).not.toContain(PIN);
    expect(observable).not.toContain(WRONG_PIN);
    // The masked history marks the PIN positions.
    expect(session!.maskedHistory).toEqual(['1', '####', '####', '####', '####', '1', '####', '####']);
  });
});

describe('menu machine: weak PIN rejection at setup (F4)', () => {
  it.each(['1234', '0000', '1111', '2345'])(
    'rejects the weak setup PIN %s with generic wording and no leaked digit',
    async (weak) => {
      const h = harness();
      await h.send([]);
      await h.send(['1']);
      const screen = await h.send(['1', weak]);
      expect(screen.kind).toBe('con');
      expect(screen.text).toContain('too easy to guess');
      // Information-leak guard: the rejection names no attempted digit and
      // no pattern.
      for (const digit of new Set(weak.split(''))) {
        expect(screen.text).not.toContain(digit);
      }
    },
  );

  it('a weak PIN is not stored and setup can continue with a strong one', async () => {
    const h = harness();
    await h.send([]);
    await h.send(['1']);
    await h.send(['1', '1234']); // rejected, stays at pinSetup1
    // No PIN record was created by the weak attempt.
    expect(await h.pins.get(MSISDN)).toBeUndefined();
    // A strong PIN now proceeds to confirmation.
    expect((await h.send(['1', '1234', PIN])).text).toContain('Enter the PIN again');
    expect((await h.send(['1', '1234', PIN, PIN])).text).toContain('1. Create your account');
  });

  it('weak-PIN rejection applies at setup only, never at verification', async () => {
    // A returning user whose stored PIN happens to be weak still verifies:
    // the denylist gates creation, not verification (which would leak the
    // pattern of a stored PIN).
    const h = harness({ prefilledAccount: ACCOUNT });
    await establishPin({ store: h.pins }, MSISDN, '1234');
    await h.send([]);
    await h.send(['1']);
    const confirm = await h.send(['1', '1234']);
    expect(confirm.kind).toBe('end');
    expect(confirm.text).toContain('Verified by the anchor. Test only, no funds move');
    expect(h.journey.authCalls).toBe(1);
  });
});
