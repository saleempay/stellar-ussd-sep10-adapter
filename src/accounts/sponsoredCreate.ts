import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { SignerUnavailableError, decodeSubmissionError } from '../errors.js';
import type { Signer } from '../signer/types.js';
import { loadAccountOrThrow, type HorizonLike, type SubmitResult } from './horizon.js';

/** Inputs for {@link createSponsoredAccount}. */
export interface CreateSponsoredAccountParams {
  horizon: HorizonLike;
  networkPassphrase: string;
  /** Operator account that pays the fee and sponsors all reserves. */
  sponsorPublicKey: string;
  /** Public key of the account to create (from `Signer.createAccountKey`). */
  newAccountId: string;
  /**
   * Signs for BOTH the sponsor and the new account. A single `Signer`
   * instance may hold both (reference setup), or wrap two backends.
   */
  signer: Signer;
  /**
   * Asset to open a trustline to inside the sponsorship sandwich, so the
   * account is usable for anchor flows the moment it exists. Omit to create
   * the account without a trustline.
   */
  asset?: { code: string; issuer: string };
  /** Transaction timebounds, seconds. Default 120. */
  timeoutSeconds?: number;
}

/**
 * Create a Stellar account whose reserves are sponsored by the operator
 * account, optionally establishing a sponsored trustline in the same
 * transaction.
 *
 * The transaction is the classic sponsorship sandwich:
 *
 * 1. `beginSponsoringFutureReserves` (source: sponsor)
 * 2. `createAccount` with `startingBalance: "0"` — possible only because the
 *    base reserves are sponsored
 * 3. `changeTrust` (source: **new account**) — the trustline subentry is
 *    created inside the sandwich, so its reserve is sponsor-paid
 * 4. `endSponsoringFutureReserves` (source: new account)
 *
 * Both the sponsor (transaction source) and the new account (source of ops
 * 3 to 4) must sign; both signatures are obtained through the {@link Signer}
 * seam, so no key material is handled here. Before anything is built, the
 * signer is asked `canSignFor` each of the two accounts, so a signer that
 * cannot produce a required signature fails fast with no network activity.
 *
 * @returns The submission result (transaction hash and ledger).
 * @throws SignerUnavailableError when the signer cannot sign for the sponsor
 *   or the new account (preflight, before any Horizon call).
 * @throws AccountNotFoundError when the sponsor account does not exist.
 * @throws TransactionFailedError (typed, with Horizon result codes) on rejection.
 */
export async function createSponsoredAccount(
  params: CreateSponsoredAccountParams,
): Promise<SubmitResult> {
  const {
    horizon,
    networkPassphrase,
    sponsorPublicKey,
    newAccountId,
    signer,
    asset,
    timeoutSeconds = 120,
  } = params;

  // Signer preflight: confirm the backend can sign for both required
  // signers before any Horizon round-trip or transaction construction. A
  // sponsor public key whose secret the signer does not hold fails here
  // with a clear SignerUnavailableError instead of a confusing submission
  // error. Week 2's authentication path will run the same preflight before
  // requesting a SEP-10 challenge.
  for (const accountId of [sponsorPublicKey, newAccountId]) {
    if (!(await signer.canSignFor(accountId))) {
      throw new SignerUnavailableError(accountId);
    }
  }

  const sponsorAccount = await loadAccountOrThrow(horizon, sponsorPublicKey);

  const builder = new TransactionBuilder(sponsorAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({ sponsoredId: newAccountId }),
    )
    .addOperation(
      Operation.createAccount({
        destination: newAccountId,
        startingBalance: '0',
      }),
    );

  if (asset) {
    builder.addOperation(
      Operation.changeTrust({
        asset: new Asset(asset.code, asset.issuer),
        source: newAccountId,
      }),
    );
  }

  const tx = builder
    .addOperation(Operation.endSponsoringFutureReserves({ source: newAccountId }))
    .setTimeout(timeoutSeconds)
    .build();

  let xdr = tx.toXDR();
  xdr = await signer.signTransaction(xdr, { networkPassphrase, accountId: sponsorPublicKey });
  xdr = await signer.signTransaction(xdr, { networkPassphrase, accountId: newAccountId });

  const signed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  try {
    return await horizon.submitTransaction(signed as Parameters<HorizonLike['submitTransaction']>[0]);
  } catch (err) {
    throw decodeSubmissionError(
      err,
      asset ? { accountId: newAccountId, assetCode: asset.code, assetIssuer: asset.issuer } : undefined,
    );
  }
}
