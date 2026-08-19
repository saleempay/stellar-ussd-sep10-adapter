import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

import { SignerUnavailableError } from '../errors.js';
import type { Signer } from './types.js';

/**
 * Local Ed25519 reference implementation of {@link Signer}.
 *
 * # ⚠️ NOT FOR PRODUCTION
 *
 * This signer generates keypairs with the Stellar SDK and holds the secret
 * keys **in process memory in plaintext**. It exists for exactly one
 * purpose: so a third party can clone this repository and verify the whole
 * flow on testnet without access to anyone's signing infrastructure.
 *
 * Do not deploy it. A production deployment implements {@link Signer} over
 * infrastructure where key material is generated and used inside a
 * protected boundary (MPC, HSM, or equivalent) and is never exportable.
 */
export class LocalKeypairSigner implements Signer {
  readonly #keypairs = new Map<string, Keypair>();

  async createAccountKey(): Promise<string> {
    const kp = Keypair.random();
    this.#keypairs.set(kp.publicKey(), kp);
    return kp.publicKey();
  }

  /**
   * Import an existing secret key (testnet setup only — e.g. the sponsor
   * account funded by friendbot). Returns the corresponding public key.
   *
   * NOT FOR PRODUCTION: accepting a raw secret is exactly what a real
   * signing backend must never do.
   */
  importSecret(secretKey: string): string {
    const kp = Keypair.fromSecret(secretKey);
    this.#keypairs.set(kp.publicKey(), kp);
    return kp.publicKey();
  }

  async canSignFor(accountId: string): Promise<boolean> {
    return this.#keypairs.has(accountId);
  }

  async signTransaction(
    xdrBase64: string,
    opts: { networkPassphrase: string; accountId: string },
  ): Promise<string> {
    const kp = this.#keypairs.get(opts.accountId);
    if (!kp) throw new SignerUnavailableError(opts.accountId);
    const tx = TransactionBuilder.fromXDR(xdrBase64, opts.networkPassphrase);
    tx.sign(kp);
    return tx.toXDR();
  }
}
