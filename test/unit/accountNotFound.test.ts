import { Account, Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  AccountNotFoundError,
  AdapterError,
  LocalKeypairSigner,
  addSponsoredTrustline,
  assertTrustline,
  createSponsoredAccount,
  isHorizonNotFound,
  loadAccountOrThrow,
  type HorizonAccount,
  type HorizonLike,
} from '../../src/index.js';

const ASSET = {
  code: 'SRT',
  issuer: 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B',
};

/** Shape the SDK's Horizon.Server throws for a missing account. */
function sdkNotFound(): unknown {
  const err = new Error('Request failed with status code 404') as Error & {
    name: string;
    response: { status: number };
  };
  err.name = 'NotFoundError';
  err.response = { status: 404 };
  return err;
}

/** Horizon stub: known accounts load, everything else throws a 404 shape. */
class NotFoundHorizon implements HorizonLike {
  known = new Map<string, HorizonAccount>();
  otherError: unknown;

  addAccount(id: string) {
    const inner = new Account(id, '1');
    this.known.set(id, {
      accountId: () => inner.accountId(),
      sequenceNumber: () => inner.sequenceNumber(),
      incrementSequenceNumber: () => inner.incrementSequenceNumber(),
      balances: [{ asset_type: 'native', balance: '0.0000000' }],
    });
  }

  async loadAccount(accountId: string): Promise<HorizonAccount> {
    if (this.otherError) throw this.otherError;
    const acct = this.known.get(accountId);
    if (!acct) throw sdkNotFound();
    return acct;
  }

  async submitTransaction() {
    return { hash: 'unused' };
  }
}

describe('AccountNotFoundError taxonomy', () => {
  it('has a stable code, carries accountId, and is exported as an AdapterError', () => {
    const err = new AccountNotFoundError('GABC');
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.code).toBe('ACCOUNT_NOT_FOUND');
    expect(err.accountId).toBe('GABC');
    expect(err.name).toBe('AccountNotFoundError');
  });

  it('isHorizonNotFound recognizes SDK and plain 404 shapes only', () => {
    expect(isHorizonNotFound(sdkNotFound())).toBe(true);
    expect(isHorizonNotFound({ status: 404 })).toBe(true);
    expect(isHorizonNotFound({ response: { status: 500 } })).toBe(false);
    expect(isHorizonNotFound(new Error('boom'))).toBe(false);
    expect(isHorizonNotFound(null)).toBe(false);
  });
});

describe('loadAccountOrThrow', () => {
  it('maps a 404 to AccountNotFoundError and passes other errors through', async () => {
    const horizon = new NotFoundHorizon();
    await expect(loadAccountOrThrow(horizon, 'GMISSING')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      accountId: 'GMISSING',
    });

    horizon.otherError = new Error('ECONNRESET');
    await expect(loadAccountOrThrow(horizon, 'GANY')).rejects.toThrow('ECONNRESET');
  });
});

describe('call sites surface AccountNotFoundError with the missing account named', () => {
  it('createSponsoredAccount: missing sponsor', async () => {
    const horizon = new NotFoundHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const newAccountId = await signer.createAccountKey();

    await expect(
      createSponsoredAccount({
        horizon,
        networkPassphrase: Networks.TESTNET,
        sponsorPublicKey: sponsor,
        newAccountId,
        signer,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', accountId: sponsor });
  });

  it('assertTrustline: missing user account', async () => {
    const horizon = new NotFoundHorizon();
    const missing = await new LocalKeypairSigner().createAccountKey();
    await expect(assertTrustline(horizon, missing, ASSET)).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      accountId: missing,
    });
  });

  it('addSponsoredTrustline: missing user account', async () => {
    const horizon = new NotFoundHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const missing = await signer.createAccountKey();
    horizon.addAccount(sponsor);

    await expect(
      addSponsoredTrustline({
        horizon,
        networkPassphrase: Networks.TESTNET,
        sponsorPublicKey: sponsor,
        accountId: missing,
        asset: ASSET,
        signer,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', accountId: missing });
  });

  it('addSponsoredTrustline: missing sponsor (user account exists, no trustline)', async () => {
    const horizon = new NotFoundHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const account = await signer.createAccountKey();
    horizon.addAccount(account);

    await expect(
      addSponsoredTrustline({
        horizon,
        networkPassphrase: Networks.TESTNET,
        sponsorPublicKey: sponsor,
        accountId: account,
        asset: ASSET,
        signer,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', accountId: sponsor });
  });
});
