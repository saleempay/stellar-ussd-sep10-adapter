import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SESSION_TTL_MS,
  InMemorySessionStore,
} from '../../src/ussd/session/memoryStore.js';
import type { UssdSession } from '../../src/ussd/session/types.js';

const T0 = 1_000_000;

function makeSession(overrides: Partial<UssdSession> = {}): UssdSession {
  return {
    sessionId: 'ATUid_1',
    msisdn: '+999700000001',
    state: 'welcome',
    processedInputs: 0,
    maskedHistory: [],
    pinVerified: false,
    signingClaimed: false,
    createdAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

describe('InMemorySessionStore', () => {
  it('round-trips a session', async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession());
    const got = await store.get('ATUid_1', T0 + 1);
    expect(got?.msisdn).toBe('+999700000001');
    expect(got?.state).toBe('welcome');
  });

  it('returns copies, not live references', async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession());
    const got = await store.get('ATUid_1', T0 + 1);
    got!.state = 'done';
    expect((await store.get('ATUid_1', T0 + 2))?.state).toBe('welcome');
  });

  it('expires a session at the absolute TTL', async () => {
    const store = new InMemorySessionStore();
    await store.put(makeSession());
    expect(await store.get('ATUid_1', T0 + DEFAULT_SESSION_TTL_MS - 1)).toBeDefined();
    expect(await store.get('ATUid_1', T0 + DEFAULT_SESSION_TTL_MS)).toBeUndefined();
  });

  it('honours a configured TTL', async () => {
    const store = new InMemorySessionStore(5_000);
    await store.put(makeSession());
    expect(await store.get('ATUid_1', T0 + 4_999)).toBeDefined();
    expect(await store.get('ATUid_1', T0 + 5_000)).toBeUndefined();
  });

  it('sweeps expired sessions on writes of other sessions', async () => {
    const store = new InMemorySessionStore(5_000);
    await store.put(makeSession({ sessionId: 'old' }));
    await store.put(
      makeSession({ sessionId: 'new', createdAt: T0 + 10_000, lastSeenAt: T0 + 10_000 }),
    );
    expect(store.size).toBe(1);
  });

  describe('claimSigning', () => {
    it('grants the claim exactly once, then reports already_claimed', async () => {
      const store = new InMemorySessionStore();
      await store.put(makeSession());
      expect(await store.claimSigning('ATUid_1', T0 + 1)).toBe('claimed');
      expect(await store.claimSigning('ATUid_1', T0 + 2)).toBe('already_claimed');
      expect(await store.claimSigning('ATUid_1', T0 + 3)).toBe('already_claimed');
    });

    it('reports missing for an unknown session', async () => {
      const store = new InMemorySessionStore();
      expect(await store.claimSigning('nope', T0)).toBe('missing');
    });

    it('reports missing for an expired session', async () => {
      const store = new InMemorySessionStore(5_000);
      await store.put(makeSession());
      expect(await store.claimSigning('ATUid_1', T0 + 5_000)).toBe('missing');
    });

    it('grants exactly one claim under 50 concurrent attempts', async () => {
      const store = new InMemorySessionStore();
      await store.put(makeSession());
      const results = await Promise.all(
        Array.from({ length: 50 }, () => store.claimSigning('ATUid_1', T0 + 1)),
      );
      expect(results.filter((r) => r === 'claimed')).toHaveLength(1);
      expect(results.filter((r) => r === 'already_claimed')).toHaveLength(49);
    });

    it('the claim survives a subsequent put of the mutated record', async () => {
      // The handler pattern: claim, then persist other progress. A put of
      // the claimed record must not resurrect the claim.
      const store = new InMemorySessionStore();
      await store.put(makeSession());
      await store.claimSigning('ATUid_1', T0 + 1);
      const session = await store.get('ATUid_1', T0 + 2);
      await store.put({ ...session!, state: 'done' });
      expect(await store.claimSigning('ATUid_1', T0 + 3)).toBe('already_claimed');
    });
  });

  describe('response idempotency cache', () => {
    it('returns the cached response for an identical step key', async () => {
      const store = new InMemorySessionStore();
      await store.put(makeSession());
      await store.recordResponse('ATUid_1', '2:abc', 'CON Enter your PIN');
      expect(await store.getResponse('ATUid_1', '2:abc')).toBe('CON Enter your PIN');
    });

    it('misses for a different step key', async () => {
      const store = new InMemorySessionStore();
      await store.recordResponse('ATUid_1', '2:abc', 'CON x');
      expect(await store.getResponse('ATUid_1', '2:def')).toBeUndefined();
    });

    it('scopes the cache per session', async () => {
      const store = new InMemorySessionStore();
      await store.recordResponse('a', '1:k', 'CON a');
      await store.recordResponse('b', '1:k', 'CON b');
      expect(await store.getResponse('a', '1:k')).toBe('CON a');
      expect(await store.getResponse('b', '1:k')).toBe('CON b');
    });

    it('delete removes the session and its cache', async () => {
      const store = new InMemorySessionStore();
      await store.put(makeSession());
      await store.recordResponse('ATUid_1', '1:k', 'CON x');
      await store.delete('ATUid_1');
      expect(await store.get('ATUid_1', T0 + 1)).toBeUndefined();
      expect(await store.getResponse('ATUid_1', '1:k')).toBeUndefined();
    });

    it('expiry drops the cache with the session', async () => {
      const store = new InMemorySessionStore(5_000);
      await store.put(makeSession());
      await store.recordResponse('ATUid_1', '1:k', 'CON x');
      await store.get('ATUid_1', T0 + 5_000);
      expect(await store.getResponse('ATUid_1', '1:k')).toBeUndefined();
    });
  });
});
