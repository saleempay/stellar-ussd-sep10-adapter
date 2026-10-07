/**
 * The optional `handle` field on UssdHttpDeps: a caller may supply its own
 * step handler; without it the listener behaves exactly as before.
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

async function start(handle?: (step: GatewayStep) => Promise<Screen>) {
  const sessions = new InMemorySessionStore();
  const machine: MachineDeps = {
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
  const listener = createUssdRequestListener({ gateway: new AfricasTalkingGateway(), machine, sessions, callbackPath: CALLBACK_PATH, handle });
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const post = async (text: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${CALLBACK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId: 's1', serviceCode: '*384*1234#', phoneNumber: '+999700000001', networkCode: '99901', text }).toString(),
    });
    return res.text();
  };
  return { server, post };
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
    const f = await start(async (step) => {
      seen.push(step);
      return { kind: 'end', text: `custom for ${step.inputs.length} inputs`, hop: 'custom' };
    });
    server = f.server;
    expect(await f.post('1*2')).toBe('END custom for 2 inputs');
    expect(seen[0]?.sessionId).toBe('s1');
    expect(seen[0]?.inputs).toEqual(['1', '2']);
  });
});
