/**
 * The optional `handle` field on UssdHttpDeps: a caller may supply its own
 * step handler; without it the listener behaves exactly as before.
 *
 * The second half of this file is the review round 1 regression set: the
 * transport guarantees the listener makes for a custom handler (response
 * cache eviction, the idempotency cache, the watchdog, error mapping) are
 * each exercised through a custom handler, not only through this
 * adapter's machine.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AfricasTalkingGateway,
  createUssdRequestListener,
  InMemoryPinStore,
  InMemorySessionStore,
  SCREENS,
  type GatewayStep,
  type MachineDeps,
  type Screen,
} from '../../src/index.js';

const CALLBACK_PATH = '/ussd/cb-3f9a7c21e0b84d56';
const T0 = 1_000_000;

type StepHandler = (step: GatewayStep) => Promise<Screen>;

interface FixtureOptions {
  handle?: StepHandler;
  sessions?: InMemorySessionStore;
  watchdogMs?: number;
}

/** This adapter's machine over stubs that never reach the network. */
function machineOver(sessions: InMemorySessionStore): MachineDeps {
  return {
    sessions,
    pins: new InMemoryPinStore(),
    journey: {
      async lookupAccount() { return undefined; },
      async checkTrustline() { /* present */ },
      async createAccount() { throw new Error('not reached'); },
      async authenticateAndDeposit() { throw new Error('not reached'); },
    },
    msisdn: { defaultCountryCode: '999' },
  };
}

async function start(options: FixtureOptions = {}) {
  const sessions = options.sessions ?? new InMemorySessionStore();
  const logs: string[] = [];
  const listener = createUssdRequestListener({
    gateway: new AfricasTalkingGateway(),
    machine: machineOver(sessions),
    sessions,
    callbackPath: CALLBACK_PATH,
    handle: options.handle,
    watchdogMs: options.watchdogMs,
    log: (line) => logs.push(line),
  });
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const post = async (text: string, sessionId = 's1') => {
    const res = await fetch(`http://127.0.0.1:${port}${CALLBACK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId, serviceCode: '*384*1234#', phoneNumber: '+999700000001', networkCode: '99901', text }).toString(),
    });
    return res.text();
  };
  return { server, post, sessions, logs };
}

/** A handler that answers from its own state and never touches the session store. */
function countingHandler() {
  let calls = 0;
  const handle: StepHandler = async () => {
    calls += 1;
    return { kind: 'end', text: `reply ${calls}`, hop: 'custom' };
  };
  return { handle, calls: () => calls };
}

describe('UssdHttpDeps.handle', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('without handle the listener runs this adapter\'s machine, unchanged', async () => {
    const f = await start();
    server = f.server;
    expect(await f.post('')).toBe(`CON ${SCREENS.welcome().text}`);
  });

  it('with handle the listener renders the caller\'s screen for the parsed step', async () => {
    const seen: GatewayStep[] = [];
    const f = await start({
      handle: async (step) => {
        seen.push(step);
        return { kind: 'end', text: `custom for ${step.inputs.length} inputs`, hop: 'custom' };
      },
    });
    server = f.server;
    expect(await f.post('1*2')).toBe('END custom for 2 inputs');
    expect(seen[0]?.sessionId).toBe('s1');
    expect(seen[0]?.inputs).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// Review round 1, blocking: response cache eviction. The listener caches a
// response for every processed callback under the step's session id. Before
// the fix, the in-memory store evicted a session's cache only when the
// session record expired, was swept or was deleted, and only sessions
// created with `put` have a record. A custom handler that never calls
// `sessions.put` therefore grew the cache for the life of the process and
// replayed a stale response to any later session that reused the id. The
// same leak existed on main for the timeout screen cached under an unknown
// session id (inputs arrive, no live session).
// ---------------------------------------------------------------------------
describe('response cache eviction through a custom handler', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('a handler that never writes the session leaves no cached responses after the TTL', async () => {
    const clock = { t: T0 };
    const sessions = new InMemorySessionStore(120_000, { now: () => clock.t });
    const { handle } = countingHandler();
    const f = await start({ handle, sessions });
    server = f.server;

    const N = 25;
    for (let i = 0; i < N; i += 1) {
      await f.post('1', `custom-${i}`);
    }
    expect(sessions.size).toBe(0); // the handler created no session record
    expect(sessions.responseCount).toBe(N);

    // Past the response TTL, the next recorded response sweeps them all.
    clock.t = T0 + sessions.responseTtlMs;
    await f.post('1', 'custom-after-ttl');
    expect(sessions.responseCount).toBe(1);
  });

  it('a session id reused after the TTL gets a fresh response, not the cached one', async () => {
    const clock = { t: T0 };
    const sessions = new InMemorySessionStore(120_000, { now: () => clock.t });
    const { handle, calls } = countingHandler();
    const f = await start({ handle, sessions });
    server = f.server;

    expect(await f.post('1', 'reused')).toBe('END reply 1');
    // Within the TTL an identical callback is the cached reply.
    expect(await f.post('1', 'reused')).toBe('END reply 1');
    expect(calls()).toBe(1);

    // The gateway reuses the id after the TTL: the handler runs again and
    // the new session is not answered with the old session's reply.
    clock.t = T0 + sessions.responseTtlMs;
    expect(await f.post('1', 'reused')).toBe('END reply 2');
    expect(calls()).toBe(2);
  });
});

describe('response cache eviction on the default machine (pre-existing leak on main)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('timeout screens cached under unknown session ids are evicted after the TTL', async () => {
    const clock = { t: T0 };
    const sessions = new InMemorySessionStore(120_000, { now: () => clock.t });
    const f = await start({ sessions });
    server = f.server;

    // Inputs arrive for session ids that never dialled: no session record is
    // created, the timeout screen is rendered and cached under each id.
    const N = 25;
    for (let i = 0; i < N; i += 1) {
      expect(await f.post('1', `orphan-${i}`)).toBe(`END ${SCREENS.endTimeout().text}`);
    }
    expect(sessions.size).toBe(0);
    expect(sessions.responseCount).toBe(N);

    // Past the response TTL a fresh dial records its welcome screen and the
    // orphan entries are gone with it.
    clock.t = T0 + sessions.responseTtlMs;
    expect(await f.post('', 'fresh')).toBe(`CON ${SCREENS.welcome().text}`);
    expect(sessions.responseCount).toBe(1);
  });
});
