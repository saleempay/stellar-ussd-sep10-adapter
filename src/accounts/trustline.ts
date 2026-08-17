import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

import { TrustlineMissingError, decodeSubmissionError } from '../errors.js';
import type { Signer } from '../signer/types.js';
import { loadAccountOrThrow, type HorizonAccount, type HorizonLike, type SubmitResult } from './horizon.js';

/** An asset identified by code and issuing account. */
export interface AssetRef {
  code: string;
  issuer: string;
}

/** True if the loaded account holds a trustline to the asset. */
export function accountHasTrustline(account: HorizonAccount, asset: AssetRef): boolean {
  return account.balances.some(
    (b) =>
      (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
      b.asset_code === asset.code &&
      b.asset_issuer === asset.issuer,
  );
}

/**
 * Preflight check: load the account and verify the trustline exists.
 *
 * Call this before any operation that pays or receives the asset, so a
 * missing trustline surfaces as a typed {@link TrustlineMissingError}
 * up front instead of an `op_no_trust` failure at submission time. (The
 * submission decoder maps `op_no_trust` to the same error type, so callers
 * handle one error either way.)
 *
 * @throws TrustlineMissingError when the trustline is absent.
 */
export async function assertTrustline(
  horizon: HorizonLike,
  accountId: string,
  asset: AssetRef,
): Promise<void> {
  const account = await loadAccountOrThrow(horizon, accountId);
  if (!accountHasTrustline(account, asset)) {
    throw new TrustlineMissingError(accountId, asset.code, asset.issuer);
  }
}

/** Inputs for {@link addSponsoredTrustline}. */
export interface AddSponsoredTrustlineParams {
  horizon: HorizonLike;
  networkPassphrase: string;
  /** Operator account that pays the fee and sponsors the subentry reserve. */
  sponsorPublicKey: string;
  /** Existing account that will trust the asset. */
  accountId: string;
  asset: AssetRef;
  /** Signs for both the sponsor and the trusting account. */
  signer: Signer;
  /** Transaction timebounds, seconds. Default 120. */
  timeoutSeconds?: number;
}

/**
 * Establish a trustline on an **existing** account, with the subentry
 * reserve sponsored and the fee paid by the operator account — so it works
 * for accounts holding zero XLM (the normal state for accounts this adapter
 * creates).
 *
 * Transaction shape: `beginSponsoringFutureReserves` (sponsor) →
 * `changeTrust` (source: account) → `endSponsoringFutureReserves`
 * (source: account). Sponsor and account both sign via the {@link Signer}
 * seam.
 *
 * No-op (returns undefined) when the trustline already exists.
 */
export async function addSponsoredTrustline(
  params: AddSponsoredTrustlineParams,
): Promise<SubmitResult | undefined> {
  const {
    horizon,
    networkPassphrase,
    sponsorPublicKey,
    accountId,
    asset,
    signer,
    timeoutSeconds = 120,
  } = params;

  const account = await loadAccountOrThrow(horizon, accountId);
  if (accountHasTrustline(account, asset)) return undefined;

  const sponsorAccount = await loadAccountOrThrow(horizon, sponsorPublicKey);

  const tx = new TransactionBuilder(sponsorAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: accountId }))
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(asset.code, asset.issuer),
        source: accountId,
      }),
    )
    .addOperation(Operation.endSponsoringFutureReserves({ source: accountId }))
    .setTimeout(timeoutSeconds)
    .build();

  let xdr = tx.toXDR();
  xdr = await signer.signTransaction(xdr, { networkPassphrase, accountId: sponsorPublicKey });
  xdr = await signer.signTransaction(xdr, { networkPassphrase, accountId });

  const signed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  try {
    return await horizon.submitTransaction(signed as Parameters<HorizonLike['submitTransaction']>[0]);
  } catch (err) {
    throw decodeSubmissionError(err, {
      accountId,
      assetCode: asset.code,
      assetIssuer: asset.issuer,
    });
  }
}
