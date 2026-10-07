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
  ConfigError,
  createUssdRequestListener,
  InMemoryPinStore,
  InMemorySessionStore,
  SCREENS,
  type GatewayStep,
  type MachineDeps,
  type Screen,
  type UssdHttpDeps,
  type UssdStepHandler,
} from '../../src/index.js';

const CALLBACK_PATH = '/ussd/cb-3f9a7c21e0b84d56';
const T0 = 1_000_000;

interface FixtureOptions {
  /** When given, the listener gets `handle` and no `machine` at all. */
  handle?: UssdStepHandler;
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
  const base = {
    gateway: new AfricasTalkingGateway(),
    sessions,
    callbackPath: CALLBACK_PATH,
    watchdogMs: options.watchdogMs,
    log: (line: string) => logs.push(line),
  };
  // Exactly one step handler: a custom handler needs no MachineDeps.
  const listener = createUssdRequestListener(
    options.handle === undefined
      ? { ...base, machine: machineOver(sessions) }
      : { ...base, handle: options.handle },
  );
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
  const handle: UssdStepHandler = async () => {
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
// Review round 1: `machine` is no longer required when `handle` is supplied.
// UssdHttpDeps is a union of the two shapes and the listener refuses to
// start with neither or both, at construction rather than on the first
// callback.
// ---------------------------------------------------------------------------
describe('exactly one of machine or handle', () => {
  const base = {
    gateway: new AfricasTalkingGateway(),
    sessions: new InMemorySessionStore(),
    callbackPath: CALLBACK_PATH,
  };

  it('machine only: this adapter\'s menu', () => {
    const listener = createUssdRequestListener({ ...base, machine: machineOver(base.sessions) });
    expect(typeof listener).toBe('function');
  });

  it('handle only: no MachineDeps needed', () => {
    const handle: UssdStepHandler = async () => ({ kind: 'end', text: 'x' });
    const listener = createUssdRequestListener({ ...base, handle });
    expect(typeof listener).toBe('function');
  });

  it('neither: a ConfigError at startup naming both options', () => {
    const deps = { ...base } as unknown as UssdHttpDeps;
    expect(() => createUssdRequestListener(deps)).toThrow(ConfigError);
    expect(() => createUssdRequestListener(deps)).toThrow(/machine .* or handle .*neither/);
  });

  it('both: a ConfigError at startup rather than silently preferring one', () => {
    const handle: UssdStepHandler = async () => ({ kind: 'end', text: 'x' });
    const deps = { ...base, machine: machineOver(base.sessions), handle } as unknown as UssdHttpDeps;
    expect(() => createUssdRequestListener(deps)).toThrow(ConfigError);
    expect(() => createUssdRequestListener(deps)).toThrow(/both machine .* and handle/);
  });
});

// ---------------------------------------------------------------------------
// Review round 1: a non-async handler that throws synchronously must take
// the same path as a rejected promise (service screen, machineError event),
// not escape into the last resort unhandledError path.
// ---------------------------------------------------------------------------
describe('a synchronous throw from the handler', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('is mapped to the service screen through the rejected promise path', async () => {
    // Deliberately not async: the throw happens before any promise exists.
    const handle = ((): Promise<Screen> => {
      throw new Error('boom');
    }) as UssdStepHandler;
    const f = await start({ handle });
    server = f.server;
    expect(await f.post('1')).toBe(`END ${SCREENS.endServiceDown().text}`);
    expect(f.logs.join('\n')).toContain('event=machineError');
    expect(f.logs.join('\n')).not.toContain('event=unhandledError');
  });
});

// ---------------------------------------------------------------------------
// Review round 1: the transport guarantees the listener claims for a custom
// handler, each exercised through a custom handler rather than through this
// adapter's machine: the idempotency cache, the watchdog, error mapping.
// ---------------------------------------------------------------------------
describe('transport guarantees through a custom handler', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('an identical callback twice calls the handler once (cache hit)', async () => {
    const { handle, calls } = countingHandler();
    const f = await start({ handle });
    server = f.server;
    expect(await f.post('1')).toBe('END reply 1');
    expect(await f.post('1')).toBe('END reply 1');
    expect(calls()).toBe(1);
    expect(f.logs.join('\n')).toContain('event=cacheHit');
  });

  it('a slow handler gets the busy screen when the watchdog fires, and its real reply lands in the cache', async () => {
    let calls = 0;
    const handle: UssdStepHandler = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 300));
      return { kind: 'end', text: 'slow reply', hop: 'custom' };
    };
    const f = await start({ handle, watchdogMs: 100 });
    server = f.server;
    expect(await f.post('1')).toBe(`END ${SCREENS.endBusy().text}`);
    expect(f.logs.join('\n')).toContain('event=watchdog ms=100');

    // The in-flight work finishes and records its real response; a gateway
    // retry of the same callback gets it without running the handler again.
    await new Promise((r) => setTimeout(r, 400));
    expect(await f.post('1')).toBe('END slow reply');
    expect(calls).toBe(1);
  });

  it('a rejected handler promise is mapped to the service screen', async () => {
    const handle: UssdStepHandler = async () => {
      throw new Error('upstream down');
    };
    const f = await start({ handle });
    server = f.server;
    expect(await f.post('1')).toBe(`END ${SCREENS.endServiceDown().text}`);
    expect(f.logs.join('\n')).toContain('event=machineError');
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
