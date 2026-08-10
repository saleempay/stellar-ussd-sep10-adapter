/**
 * stellar-ussd-sep10-adapter — Week 1 surface.
 *
 * MSISDN → Stellar account resolution, sponsored account creation with
 * trustline establishment, and the pluggable {@link Signer} seam.
 */

import { normalizeMsisdn, MsisdnResolver } from './resolver/resolver.js';
import type { AccountStore, ResolvedAccount } from './resolver/types.js';
import { createSponsoredAccount } from './accounts/sponsoredCreate.js';
import type { HorizonLike } from './accounts/horizon.js';
import type { Signer } from './signer/types.js';

export { normalizeMsisdn, MsisdnResolver } from './resolver/resolver.js';
export type { AccountStore, ResolvedAccount } from './resolver/types.js';
export { InMemoryAccountStore } from './resolver/memoryStore.js';
export { JsonFileAccountStore } from './resolver/jsonFileStore.js';

export type { Signer } from './signer/types.js';
export { LocalKeypairSigner } from './signer/localKeypairSigner.js';

export {
  createSponsoredAccount,
  type CreateSponsoredAccountParams,
} from './accounts/sponsoredCreate.js';
export {
  accountHasTrustline,
  assertTrustline,
  addSponsoredTrustline,
  type AssetRef,
  type AddSponsoredTrustlineParams,
} from './accounts/trustline.js';
export type { HorizonLike, HorizonAccount, SubmitResult } from './accounts/horizon.js';

export { loadConfig, TESTNET_DEFAULTS, type AdapterConfig } from './config/index.js';
export {
  AdapterError,
  InvalidMsisdnError,
  TrustlineMissingError,
  SignerUnavailableError,
  TransactionFailedError,
  ConfigError,
  decodeSubmissionError,
} from './errors.js';

/** Dependencies for {@link resolveOrCreateAccount}. */
export interface ResolveOrCreateDeps {
  store: AccountStore;
  signer: Signer;
  horizon: HorizonLike;
  networkPassphrase: string;
  sponsorPublicKey: string;
  /** Trustline established at creation. Omit to create bare accounts. */
  asset?: { code: string; issuer: string };
}

/**
 * The Week 1 end-to-end flow: resolve an MSISDN to a Stellar account,
 * creating the account (sponsored reserves + trustline) when none exists.
 *
 * - Existing mapping → returns it, `created: false`. No network calls.
 * - No mapping → asks the {@link Signer} for a new public key, creates the
 *   account on-chain with sponsored reserves and the configured trustline,
 *   records the mapping, and returns `created: true` with the transaction
 *   hash.
 *
 * The mapping is recorded only after on-chain creation succeeds, so a failed
 * submission never leaves a dangling MSISDN → account entry.
 *
 * @throws InvalidMsisdnError when the MSISDN is not canonical E.164 (see
 *   that error's docs: country-code inference is the caller's job).
 * @throws TransactionFailedError when the network rejects the creation.
 */
export async function resolveOrCreateAccount(
  deps: ResolveOrCreateDeps,
  rawMsisdn: string,
): Promise<ResolvedAccount> {
  const msisdn = normalizeMsisdn(rawMsisdn);
  const resolver = new MsisdnResolver(deps.store);

  const existing = await resolver.lookup(msisdn);
  if (existing) {
    return { msisdn, accountId: existing, created: false };
  }

  const newAccountId = await deps.signer.createAccountKey();
  const result = await createSponsoredAccount({
    horizon: deps.horizon,
    networkPassphrase: deps.networkPassphrase,
    sponsorPublicKey: deps.sponsorPublicKey,
    newAccountId,
    signer: deps.signer,
    asset: deps.asset,
  });
  await resolver.register(msisdn, newAccountId);

  return { msisdn, accountId: newAccountId, created: true, creationTxHash: result.hash };
}
