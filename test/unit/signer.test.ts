import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { LocalKeypairSigner, SignerUnavailableError } from '../../src/index.js';

function buildDummyTx(sourceId: string): Transaction {
  return new TransactionBuilder(new Account(sourceId, '0'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '1' }))
    .setTimeout(60)
    .build();
}

describe('LocalKeypairSigner', () => {
  it('createAccountKey returns a valid public key and no secret', async () => {
    const signer = new LocalKeypairSigner();
    const pub = await signer.createAccountKey();
    expect(pub).toMatch(/^G[A-Z2-7]{55}$/);
    expect(await signer.canSignFor(pub)).toBe(true);
  });

  it('appends a verifiable signature for the requested account', async () => {
    const signer = new LocalKeypairSigner();
    const pub = await signer.createAccountKey();
    const tx = buildDummyTx(pub);

    const signedXdr = await signer.signTransaction(tx.toXDR(), {
      networkPassphrase: Networks.TESTNET,
      accountId: pub,
    });

    const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET) as Transaction;
    expect(signed.signatures).toHaveLength(1);
    const sig = signed.signatures[0]!;
    expect(Keypair.fromPublicKey(pub).verify(signed.hash(), sig.signature())).toBe(true);
  });

  it('accumulates signatures across multiple signers of one envelope', async () => {
    const signer = new LocalKeypairSigner();
    const a = await signer.createAccountKey();
    const b = await signer.createAccountKey();
    const tx = buildDummyTx(a);

    let xdr = tx.toXDR();
    xdr = await signer.signTransaction(xdr, { networkPassphrase: Networks.TESTNET, accountId: a });
    xdr = await signer.signTransaction(xdr, { networkPassphrase: Networks.TESTNET, accountId: b });

    const signed = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
    expect(signed.signatures).toHaveLength(2);
  });

  it('importSecret registers an existing key by public key', async () => {
    const signer = new LocalKeypairSigner();
    const kp = Keypair.random();
    expect(signer.importSecret(kp.secret())).toBe(kp.publicKey());
    expect(await signer.canSignFor(kp.publicKey())).toBe(true);
  });

  it('throws SignerUnavailableError for unknown accounts', async () => {
    const signer = new LocalKeypairSigner();
    const stranger = Keypair.random().publicKey();
    expect(await signer.canSignFor(stranger)).toBe(false);
    const tx = buildDummyTx(stranger);
    await expect(
      signer.signTransaction(tx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
        accountId: stranger,
      }),
    ).rejects.toThrow(SignerUnavailableError);
  });
});
