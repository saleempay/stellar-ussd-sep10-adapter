import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  LocalKeypairSigner,
  TransactionFailedError,
  TrustlineMissingError,
  accountHasTrustline,
  addSponsoredTrustline,
  assertTrustline,
  createSponsoredAccount,
  type HorizonAccount,
  type HorizonLike,
} from '../../src/index.js';

const ASSET = {
  code: 'SRT',
  issuer: 'GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B',
};

/** Offline Horizon stub: canned accounts, captures submissions. */
class StubHorizon implements HorizonLike {
  submitted: Transaction[] = [];
  submitError: unknown;
  accounts = new Map<string, HorizonAccount>();

  addAccount(id: string, balances: HorizonAccount['balances'] = [{ asset_type: 'native', balance: '10000.0000000' }]) {
    const inner = new Account(id, '103720918407102567');
    this.accounts.set(id, {
      accountId: () => inner.accountId(),
      sequenceNumber: () => inner.sequenceNumber(),
      incrementSequenceNumber: () => inner.incrementSequenceNumber(),
      balances,
    });
  }

  async loadAccount(accountId: string): Promise<HorizonAccount> {
    const acct = this.accounts.get(accountId);
    if (!acct) throw new Error(`stub: no account ${accountId}`);
    return acct;
  }

  async submitTransaction(tx: Transaction) {
    if (this.submitError) throw this.submitError;
    this.submitted.push(tx);
    return { hash: tx.hash().toString('hex'), ledger: 1 };
  }
}

function horizonRejection(txCode: string, opCodes: string[]): unknown {
  return {
    response: { data: { extras: { result_codes: { transaction: txCode, operations: opCodes } } } },
  };
}

describe('createSponsoredAccount', () => {
  async function run(withAsset: boolean) {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    horizon.addAccount(sponsor);
    const newAccountId = await signer.createAccountKey();

    const result = await createSponsoredAccount({
      horizon,
      networkPassphrase: Networks.TESTNET,
      sponsorPublicKey: sponsor,
      newAccountId,
      signer,
      asset: withAsset ? ASSET : undefined,
    });
    return { horizon, sponsor, newAccountId, result };
  }

  it('builds the sponsorship sandwich in the right order with the right sources', async () => {
    const { horizon, sponsor, newAccountId } = await run(true);
    expect(horizon.submitted).toHaveLength(1);
    const tx = horizon.submitted[0]!;

    expect(tx.source).toBe(sponsor);
    expect(tx.operations.map((op) => op.type)).toEqual([
      'beginSponsoringFutureReserves',
      'createAccount',
      'changeTrust',
      'endSponsoringFutureReserves',
    ]);

    const [begin, create, trust, end] = tx.operations as [
      Operation.BeginSponsoringFutureReserves,
      Operation.CreateAccount,
      Operation.ChangeTrust,
      Operation.EndSponsoringFutureReserves,
    ];
    expect(begin.sponsoredId).toBe(newAccountId);
    expect(begin.source ?? tx.source).toBe(sponsor);
    expect(create.destination).toBe(newAccountId);
    expect(Number(create.startingBalance)).toBe(0);
    expect(trust.source).toBe(newAccountId);
    expect(trust.line).toMatchObject({ code: ASSET.code, issuer: ASSET.issuer });
    expect(end.source).toBe(newAccountId);
  });

  it('omits changeTrust when no asset is configured', async () => {
    const { horizon } = await run(false);
    expect(horizon.submitted[0]!.operations.map((op) => op.type)).toEqual([
      'beginSponsoringFutureReserves',
      'createAccount',
      'endSponsoringFutureReserves',
    ]);
  });

  it('carries signatures from both sponsor and new account', async () => {
    const { horizon } = await run(true);
    expect(horizon.submitted[0]!.signatures).toHaveLength(2);
  });

  it('maps Horizon rejection to TransactionFailedError with result codes', async () => {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    horizon.addAccount(sponsor);
    horizon.submitError = horizonRejection('tx_failed', ['op_underfunded']);

    await expect(
      createSponsoredAccount({
        horizon,
        networkPassphrase: Networks.TESTNET,
        sponsorPublicKey: sponsor,
        newAccountId: await signer.createAccountKey(),
        signer,
      }),
    ).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      transactionResultCode: 'tx_failed',
      operationResultCodes: ['op_underfunded'],
    });
  });
});

describe('trustline helpers', () => {
  const TRUSTED: HorizonAccount['balances'] = [
    { asset_type: 'native', balance: '0.0000000' },
    { asset_type: 'credit_alphanum4', asset_code: ASSET.code, asset_issuer: ASSET.issuer, balance: '0.0000000' },
  ];

  it('accountHasTrustline distinguishes code, issuer, and native', () => {
    const account = { balances: TRUSTED } as HorizonAccount;
    expect(accountHasTrustline(account, ASSET)).toBe(true);
    expect(accountHasTrustline(account, { ...ASSET, code: 'USDC' })).toBe(false);
    expect(
      accountHasTrustline(account, { ...ASSET, issuer: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ' }),
    ).toBe(false);
  });

  it('assertTrustline passes when present, throws typed error when missing', async () => {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const trusted = await signer.createAccountKey();
    const bare = await signer.createAccountKey();
    horizon.addAccount(trusted, TRUSTED);
    horizon.addAccount(bare, [{ asset_type: 'native', balance: '0.0000000' }]);

    await expect(assertTrustline(horizon, trusted, ASSET)).resolves.toBeUndefined();
    await expect(assertTrustline(horizon, bare, ASSET)).rejects.toMatchObject({
      code: 'TRUSTLINE_MISSING',
      accountId: bare,
      assetCode: ASSET.code,
      assetIssuer: ASSET.issuer,
    });
  });

  it('addSponsoredTrustline is a no-op when the trustline exists', async () => {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const account = await signer.createAccountKey();
    horizon.addAccount(sponsor);
    horizon.addAccount(account, TRUSTED);

    const result = await addSponsoredTrustline({
      horizon,
      networkPassphrase: Networks.TESTNET,
      sponsorPublicKey: sponsor,
      accountId: account,
      asset: ASSET,
      signer,
    });
    expect(result).toBeUndefined();
    expect(horizon.submitted).toHaveLength(0);
  });

  it('addSponsoredTrustline wraps changeTrust in a sponsor sandwich for zero-XLM accounts', async () => {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const account = await signer.createAccountKey();
    horizon.addAccount(sponsor);
    horizon.addAccount(account, [{ asset_type: 'native', balance: '0.0000000' }]);

    const result = await addSponsoredTrustline({
      horizon,
      networkPassphrase: Networks.TESTNET,
      sponsorPublicKey: sponsor,
      accountId: account,
      asset: ASSET,
      signer,
    });
    expect(result?.hash).toMatch(/^[0-9a-f]{64}$/);

    const tx = horizon.submitted[0]!;
    expect(tx.source).toBe(sponsor);
    expect(tx.operations.map((op) => op.type)).toEqual([
      'beginSponsoringFutureReserves',
      'changeTrust',
      'endSponsoringFutureReserves',
    ]);
    expect(tx.signatures).toHaveLength(2);
  });

  it('maps op_no_trust on submission to TrustlineMissingError', async () => {
    const horizon = new StubHorizon();
    const signer = new LocalKeypairSigner();
    const sponsor = await signer.createAccountKey();
    const account = await signer.createAccountKey();
    horizon.addAccount(sponsor);
    horizon.addAccount(account, [{ asset_type: 'native', balance: '0.0000000' }]);
    horizon.submitError = horizonRejection('tx_failed', ['op_success', 'op_no_trust']);

    await expect(
      addSponsoredTrustline({
        horizon,
        networkPassphrase: Networks.TESTNET,
        sponsorPublicKey: sponsor,
        accountId: account,
        asset: ASSET,
        signer,
      }),
    ).rejects.toBeInstanceOf(TrustlineMissingError);
  });
});
