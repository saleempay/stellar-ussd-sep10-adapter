/**
 * Simulated gateway integration test: real HTTP handler, real gateway
 * adapter, recorded callback sequences in Africa's Talking's documented
 * wire format, stub journey. Proves the full state machine over the wire,
 * including duplicate deliveries, replays, the watchdog, and the
 * no plaintext PIN guarantee across every observable surface.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { Sep10JwtClaims } from '../../src/auth/token.js';
import {
  AfricasTalkingGateway,
  createUssdRequestListener,
  InMemoryPinStore,
  InMemorySessionStore,
  establishPin,
  handleStep,
  type JourneySeam,
  type MachineDeps,
} from '../../src/index.js';

const MSISDN = '+999700000001';
const ACCOUNT = 'GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM';
const PIN = '7391';
const WRONG_PIN = '2846';

interface Fixture {
  url: string;
  server: Server;
  sessions: InMemorySessionStore;
  pins: InMemoryPinStore;
  logs: string[];
  journey: {
    createCalls: number;
    authCalls: number;
    authDelayMs: number;
    seam: JourneySeam;
  };
  post(fields: Record<string, string>): Promise<{ status: number; body: string; hop?: string }>;
  close(): Promise<void>;
}

async function startFixture(options: { watchdogMs?: number } = {}): Promise<Fixture> {
  const sessions = new InMemorySessionStore();
  const pins = new InMemoryPinStore();
  const logs: string[] = [];
  const mapped = new Map<string, string>();

  const journey = {
    createCalls: 0,
    authCalls: 0,
    authDelayMs: 0,
    seam: {
      async lookupAccount(msisdn: string) {
        return mapped.get(msisdn);
      },
      async checkTrustline() {
        /* trustline present in the simulated world */
      },
      async createAccount(msisdn: string) {
        journey.createCalls += 1;
        mapped.set(msisdn, ACCOUNT);
        return { accountId: ACCOUNT, creationTxHash: 'ab'.repeat(32) };
      },
      async authenticateAndDeposit() {
        journey.authCalls += 1;
        if (journey.authDelayMs > 0) {
          await new Promise((r) => setTimeout(r, journey.authDelayMs));
        }
        const claims: Sep10JwtClaims = { sub: ACCOUNT, iat: 1, exp: 2 };
        return { token: 'header.payload.signature', claims, depositRef: 'dep12345' };
      },
    } satisfies JourneySeam,
  };

  const machine: MachineDeps = {
    sessions,
    pins,
    journey: journey.seam,
    msisdn: { defaultCountryCode: '999' },
    log: (line) => logs.push(line),
  };

  const listener = createUssdRequestListener({
    gateway: new AfricasTalkingGateway(),
    machine,
    sessions,
    callbackPath: '/ussd/callback',
    watchdogMs: options.watchdogMs,
    log: (line) => logs.push(line),
  });

  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/ussd/callback`;

  return {
    url,
    server,
    sessions,
    pins,
    logs,
    journey,
    async post(fields) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
      return {
        status: res.status,
        body: await res.text(),
        hop: res.headers.get('at-ussd-hop-metadata') ?? undefined,
      };
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

function atFields(sessionId: string, text: string): Record<string, string> {
  return {
    sessionId,
    serviceCode: '*384*1234#',
    phoneNumber: MSISDN,
    networkCode: '99901',
    text,
  };
}

describe('simulated gateway over HTTP', () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it('drives the full first-use journey in the documented wire format', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_1';

    const dial = await fixture.post(atFields(S, ''));
    expect(dial.status).toBe(200);
    expect(dial.body).toBe('CON Saleem Stellar test\n1. Sign in and deposit\n2. About');
    expect(dial.hop).toBe('welcome');

    expect((await fixture.post(atFields(S, '1'))).body).toBe('CON Create a 4 digit PIN');
    expect((await fixture.post(atFields(S, `1*${PIN}`))).body).toBe('CON Enter the PIN again');
    expect((await fixture.post(atFields(S, `1*${PIN}*${PIN}`))).body).toBe(
      'CON PIN saved\n1. Create your account and continue',
    );
    expect((await fixture.post(atFields(S, `1*${PIN}*${PIN}*1`))).body).toBe(
      'CON Account ready\nEnter your PIN',
    );
    const confirm = await fixture.post(atFields(S, `1*${PIN}*${PIN}*1*${PIN}`));
    expect(confirm.body).toBe('END Signed in as GAA3..EAFM\nDeposit started\nRef dep12345');
    expect(confirm.hop).toBe('confirm');
    expect(fixture.journey.createCalls).toBe(1);
    expect(fixture.journey.authCalls).toBe(1);
  });

  it('rejects a byte-identical replay of the completed final callback from the cache', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_replay';
    await fixture.post(atFields(S, ''));
    await fixture.post(atFields(S, '1'));
    await fixture.post(atFields(S, `1*${PIN}`));
    await fixture.post(atFields(S, `1*${PIN}*${PIN}`));
    await fixture.post(atFields(S, `1*${PIN}*${PIN}*1`));
    const first = await fixture.post(atFields(S, `1*${PIN}*${PIN}*1*${PIN}`));
    expect(first.body).toContain('Deposit started');

    // The replay: same session id, same cumulative text, re-POSTed.
    const replay = await fixture.post(atFields(S, `1*${PIN}*${PIN}*1*${PIN}`));
    expect(replay.status).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(fixture.journey.authCalls).toBe(1);
    expect(fixture.logs.join('\n')).toContain('event=cacheHit');
  });

  it('rejects a variant replay (different PIN guess after completion) without a journey', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_variant';
    await fixture.post(atFields(S, ''));
    await fixture.post(atFields(S, '1'));
    await fixture.post(atFields(S, `1*${PIN}`));
    await fixture.post(atFields(S, `1*${PIN}*${PIN}`));
    await fixture.post(atFields(S, `1*${PIN}*${PIN}*1`));
    await fixture.post(atFields(S, `1*${PIN}*${PIN}*1*${PIN}`));

    // A forged final step with a different last input misses the cache but
    // hits the machine's replay rejection: claim already spent.
    const forged = await fixture.post(atFields(S, `1*${PIN}*${PIN}*1*${WRONG_PIN}`));
    expect(forged.body).toBe('END This step was already completed');
    expect(fixture.journey.authCalls).toBe(1);
  });

  it('duplicate mid-flow delivery is answered from the cache without side effects', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_dup';
    await fixture.post(atFields(S, ''));
    const first = await fixture.post(atFields(S, '1'));
    const dup = await fixture.post(atFields(S, '1'));
    expect(dup.body).toBe(first.body);
    expect(fixture.journey.createCalls).toBe(0);
  });

  it('a wrong PIN sequence locks out on the third attempt', async () => {
    fixture = await startFixture();
    await establishPin({ store: fixture.pins }, MSISDN, PIN);
    const S = 'ATUid_sim_lock';
    await fixture.post(atFields(S, ''));
    // Registered PIN but unmapped account: welcome routes to pinEnter.
    expect((await fixture.post(atFields(S, '1'))).body).toBe('CON Enter your PIN');
    expect((await fixture.post(atFields(S, `1*${WRONG_PIN}`))).body).toContain('2 attempts left');
    expect(
      (await fixture.post(atFields(S, `1*${WRONG_PIN}*${WRONG_PIN}`))).body,
    ).toContain('1 attempt left');
    const locked = await fixture.post(atFields(S, `1*${WRONG_PIN}*${WRONG_PIN}*${WRONG_PIN}`));
    expect(locked.body).toBe('END Too many wrong PINs. Try again in 15 minutes');
  });

  it('an expired session gets the timeout screen', async () => {
    fixture = await startFixture();
    // No dial callback ever arrived for this session id.
    const orphan = await fixture.post(atFields('ATUid_sim_orphan', '1'));
    expect(orphan.body).toBe('END Session expired. Dial again to start over');
  });

  it('the watchdog answers busy while slow work completes into the cache', async () => {
    fixture = await startFixture({ watchdogMs: 200 });
    fixture.journey.authDelayMs = 600;
    await establishPin({ store: fixture.pins }, MSISDN, PIN);
    const S = 'ATUid_sim_slow';
    await fixture.post(atFields(S, ''));
    await fixture.post(atFields(S, '1'));
    await fixture.post(atFields(S, `1*${PIN}`)); // divergence: accountPrompt
    const busy = await fixture.post(atFields(S, `1*${PIN}*1`)); // creation is fast; pin again
    expect(busy.body).toBe('CON Account ready\nEnter your PIN');
    const slow = await fixture.post(atFields(S, `1*${PIN}*1*${PIN}`));
    expect(slow.body).toBe('END Still processing your last request');

    // The in-flight journey finishes and its REAL response lands in the
    // cache; a gateway retry of the same callback gets the true outcome.
    await new Promise((r) => setTimeout(r, 800));
    const retry = await fixture.post(atFields(S, `1*${PIN}*1*${PIN}`));
    expect(retry.body).toContain('Deposit started');
    expect(fixture.journey.authCalls).toBe(1);
  });

  it('malformed callbacks get a 400 and the gateway grammar is never violated', async () => {
    fixture = await startFixture();
    const missing = await fetch(fixture.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'text=1',
    });
    expect(missing.status).toBe(400);

    const wrongPath = await fetch(fixture.url.replace('/ussd/callback', '/other'), {
      method: 'POST',
      body: '',
    });
    expect(wrongPath.status).toBe(404);
  });

  it('every 200 response begins with CON or END (gateway grammar)', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_grammar';
    const bodies = [
      (await fixture.post(atFields(S, ''))).body,
      (await fixture.post(atFields(S, '9'))).body,
      (await fixture.post(atFields(S, '9*1'))).body,
      (await fixture.post(atFields(S, '9*1*12'))).body,
    ];
    for (const body of bodies) {
      expect(body).toMatch(/^(CON|END) /);
    }
  });

  it('no observable surface ever contains fixture PIN digits', async () => {
    fixture = await startFixture();
    const S = 'ATUid_sim_sweep';
    const transcript: string[] = [];
    for (const text of [
      '',
      '1',
      `1*${PIN}`,
      `1*${PIN}*${WRONG_PIN}`, // mismatch
      `1*${PIN}*${WRONG_PIN}*${PIN}`,
      `1*${PIN}*${WRONG_PIN}*${PIN}*${PIN}`,
      `1*${PIN}*${WRONG_PIN}*${PIN}*${PIN}*1`,
      `1*${PIN}*${WRONG_PIN}*${PIN}*${PIN}*1*${PIN}`,
    ]) {
      const res = await fixture.post(atFields(S, text));
      // The captured transcript records what a gateway-side observer may
      // keep: the response bodies and hop headers (requests are masked
      // before they land in any committed evidence file).
      transcript.push(`${res.status} ${res.hop ?? ''} ${res.body}`);
    }

    const session = await fixture.sessions.get(S, Date.now());
    const observable = [
      transcript.join('\n'),
      fixture.logs.join('\n'),
      JSON.stringify(session),
      JSON.stringify(fixture.pins.dump()),
    ].join('\n');
    expect(observable).not.toContain(PIN);
    expect(observable).not.toContain(WRONG_PIN);
  });

  it('the machine level replay rejection also holds without the HTTP cache', async () => {
    // Belt and braces: drive handleStep directly with a replayed step to
    // show rejection is not an artifact of the response cache.
    const sessions = new InMemorySessionStore();
    const pins = new InMemoryPinStore();
    let authCalls = 0;
    const deps: MachineDeps = {
      sessions,
      pins,
      msisdn: { defaultCountryCode: '999' },
      journey: {
        async lookupAccount() {
          return ACCOUNT;
        },
        async checkTrustline() {},
        async createAccount() {
          return { accountId: ACCOUNT };
        },
        async authenticateAndDeposit() {
          authCalls += 1;
          return {
            token: 't.t.t',
            claims: { sub: ACCOUNT },
            depositRef: 'dep12345',
          };
        },
      },
    };
    await establishPin({ store: pins }, MSISDN, PIN);
    const step = (text: string) => ({
      sessionId: 'S_direct',
      msisdnRaw: MSISDN,
      inputs: text === '' ? [] : text.split('*'),
      rawText: text,
    });
    await handleStep(deps, step(''));
    await handleStep(deps, step('1'));
    const confirm = await handleStep(deps, step(`1*${PIN}`));
    expect(confirm.kind).toBe('end');
    const replay = await handleStep(deps, step(`1*${PIN}`));
    expect(replay.text).toBe('This step was already completed');
    expect(authCalls).toBe(1);
  });
});
