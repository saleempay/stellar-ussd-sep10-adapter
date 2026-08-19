import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  InMemoryAccountStore,
  InvalidMsisdnError,
  JsonFileAccountStore,
  MsisdnResolver,
  normalizeMsisdn,
  type AccountStore,
} from '../../src/index.js';

const ACCOUNT_A = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const ACCOUNT_B = 'GB7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUSEO';

describe('normalizeMsisdn', () => {
  it('accepts canonical E.164', () => {
    expect(normalizeMsisdn('+971501234567')).toBe('+971501234567');
  });

  it('strips formatting noise', () => {
    expect(normalizeMsisdn('+971 50-123 4567')).toBe('+971501234567');
    expect(normalizeMsisdn('+1 (415) 555.0100')).toBe('+14155550100');
  });

  it.each([
    ['national format without +', '0501234567'],
    ['missing +', '971501234567'],
    ['leading zero after +', '+0971501234567'],
    ['letters', '+9715012345ab'],
    ['too short', '+9715012'],
    ['too long (16 digits)', '+9715012345678901'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeMsisdn(input)).toThrow(InvalidMsisdnError);
  });

  it('rejection says country-code inference is the caller\'s responsibility', () => {
    try {
      normalizeMsisdn('0501234567');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidMsisdnError);
      const e = err as InvalidMsisdnError;
      expect(e.code).toBe('INVALID_MSISDN');
      expect(e.rawInput).toBe('0501234567');
      expect(e.message).toContain("country-code inference is the caller's responsibility");
    }
  });
});

/** Contract test any AccountStore implementation must pass. */
function storeContract(name: string, makeStore: () => AccountStore) {
  describe(`${name} (AccountStore contract)`, () => {
    it('returns undefined for an unmapped MSISDN', async () => {
      const store = makeStore();
      expect(await store.get('+971501234567')).toBeUndefined();
    });

    it('round-trips put/get', async () => {
      const store = makeStore();
      await store.put('+971501234567', ACCOUNT_A);
      expect(await store.get('+971501234567')).toBe(ACCOUNT_A);
    });

    it('put replaces an existing mapping', async () => {
      const store = makeStore();
      await store.put('+971501234567', ACCOUNT_A);
      await store.put('+971501234567', ACCOUNT_B);
      expect(await store.get('+971501234567')).toBe(ACCOUNT_B);
    });

    it('delete removes a mapping and tolerates absent keys', async () => {
      const store = makeStore();
      await store.put('+971501234567', ACCOUNT_A);
      await store.delete('+971501234567');
      expect(await store.get('+971501234567')).toBeUndefined();
      await expect(store.delete('+971501234567')).resolves.toBeUndefined();
    });
  });
}

storeContract('InMemoryAccountStore', () => new InMemoryAccountStore());

const tmpRoot = mkdtempSync(join(tmpdir(), 'ussd-adapter-store-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
let fileN = 0;
storeContract('JsonFileAccountStore', () => new JsonFileAccountStore(join(tmpRoot, `store-${fileN++}.json`)));

describe('JsonFileAccountStore persistence', () => {
  it('survives a re-open of the same file', async () => {
    const path = join(tmpRoot, 'persist.json');
    await new JsonFileAccountStore(path).put('+971501234567', ACCOUNT_A);
    expect(await new JsonFileAccountStore(path).get('+971501234567')).toBe(ACCOUNT_A);
  });
});

describe('MsisdnResolver', () => {
  it('normalizes before hitting the store', async () => {
    const store = new InMemoryAccountStore();
    const resolver = new MsisdnResolver(store);
    await resolver.register('+971 50 123 4567', ACCOUNT_A);
    expect(await resolver.lookup('+971501234567')).toBe(ACCOUNT_A);
    expect(await store.get('+971501234567')).toBe(ACCOUNT_A);
  });

  it('lookup misses return undefined', async () => {
    const resolver = new MsisdnResolver(new InMemoryAccountStore());
    expect(await resolver.lookup('+971501234567')).toBeUndefined();
  });

  it('unregister removes the mapping', async () => {
    const resolver = new MsisdnResolver(new InMemoryAccountStore());
    await resolver.register('+971501234567', ACCOUNT_A);
    await resolver.unregister('+971501234567');
    expect(await resolver.lookup('+971501234567')).toBeUndefined();
  });

  it('rejects invalid input at every entry point', async () => {
    const resolver = new MsisdnResolver(new InMemoryAccountStore());
    await expect(resolver.lookup('0501234567')).rejects.toThrow(InvalidMsisdnError);
    await expect(resolver.register('0501234567', ACCOUNT_A)).rejects.toThrow(InvalidMsisdnError);
    await expect(resolver.unregister('0501234567')).rejects.toThrow(InvalidMsisdnError);
  });
});
