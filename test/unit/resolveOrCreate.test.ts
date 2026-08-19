import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  InMemoryAccountStore,
  InvalidMsisdnError,
  LocalKeypairSigner,
  RegistrationFailedError,
  resolveOrCreateAccount,
  type HorizonAccount,
  type HorizonLike,
  type ResolveOrCreateDeps,
} from '../../src/index.js';
import { Account } from '@stellar/stellar-sdk';

function makeDeps(): { deps: ResolveOrCreateDeps; horizon: StubHorizon; signer: LocalKeypairSigner } {
  const horizon = new StubHorizon();
  const signer = new LocalKeypairSigner();
  return {
    horizon,
    signer,
    deps: {
      store: new InMemoryAccountStore(),
      signer,
      horizon,
      networkPassphrase: Networks.TESTNET,
      sponsorPublicKey: '',
      asset: { code: 'SRT', issuer: 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B' },
    },
  };
}

class StubHorizon implements HorizonLike {
  loadCount = 0;
  submitCount = 0;
  submitError: unknown;
  accounts = new Map<string, Account>();

  addAccount(id: string) {
    this.accounts.set(id, new Account(id, '1'));
  }

  async loadAccount(accountId: string): Promise<HorizonAccount> {
    this.loadCount++;
    const inner = this.accounts.get(accountId);
    if (!inner) throw new Error(`stub: no account ${accountId}`);
    return {
      accountId: () => inner.accountId(),
      sequenceNumber: () => inner.sequenceNumber(),
      incrementSequenceNumber: () => inner.incrementSequenceNumber(),
      balances: [],
    };
  }

  async submitTransaction(tx: { hash(): Buffer }) {
    if (this.submitError) throw this.submitError;
    this.submitCount++;
    return { hash: tx.hash().toString('hex'), ledger: 1 };
  }
}

describe('resolveOrCreateAccount', () => {
  it('creates on first resolution, resolves from the store on the second', async () => {
    const { deps, horizon, signer } = makeDeps();
    const sponsor = await signer.createAccountKey();
    deps.sponsorPublicKey = sponsor;
    horizon.addAccount(sponsor);

    const first = await resolveOrCreateAccount(deps, '+999 4152 0001');
    expect(first.created).toBe(true);
    expect(first.msisdn).toBe('+99941520001');
    expect(first.accountId).toMatch(/^G[A-Z2-7]{55}$/);
    expect(first.creationTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(horizon.submitCount).toBe(1);

    const second = await resolveOrCreateAccount(deps, '+99941520001');
    expect(second).toEqual({ msisdn: '+99941520001', accountId: first.accountId, created: false });
    expect(horizon.submitCount).toBe(1);
  });

  it('does not record a mapping when on-chain creation fails', async () => {
    const { deps, horizon, signer } = makeDeps();
    const sponsor = await signer.createAccountKey();
    deps.sponsorPublicKey = sponsor;
    horizon.addAccount(sponsor);
    horizon.submitError = new Error('network down');

    await expect(resolveOrCreateAccount(deps, '+99941520002')).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
    });
    expect(await deps.store.get('+99941520002')).toBeUndefined();

    horizon.submitError = undefined;
    const retry = await resolveOrCreateAccount(deps, '+99941520002');
    expect(retry.created).toBe(true);
  });

  it('surfaces a store-write failure after creation as RegistrationFailedError', async () => {
    const { deps, horizon, signer } = makeDeps();
    const sponsor = await signer.createAccountKey();
    deps.sponsorPublicKey = sponsor;
    horizon.addAccount(sponsor);
    const diskError = new Error('EIO: disk write failed');
    deps.store = {
      get: async () => undefined,
      put: async () => {
        throw diskError;
      },
      delete: async () => undefined,
    };

    let caught: unknown;
    try {
      await resolveOrCreateAccount(deps, '+99941520003');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RegistrationFailedError);
    const e = caught as RegistrationFailedError;
    expect(e.code).toBe('REGISTRATION_FAILED');
    expect(e.accountId).toMatch(/^G[A-Z2-7]{55}$/);
    expect(e.msisdn).toBe('+99941520003');
    expect(e.cause).toBe(diskError);
    expect(e.message).toContain('requires operator reconciliation');
    // The account really was created on-chain (one submission happened).
    expect(horizon.submitCount).toBe(1);
  });

  it('rejects non-E.164 input before any network activity', async () => {
    const { deps, horizon } = makeDeps();
    await expect(resolveOrCreateAccount(deps, '0501234567')).rejects.toThrow(InvalidMsisdnError);
    expect(horizon.loadCount).toBe(0);
    expect(horizon.submitCount).toBe(0);
  });
});
