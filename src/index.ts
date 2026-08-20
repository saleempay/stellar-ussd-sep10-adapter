/**
 * stellar-ussd-sep10-adapter: the Weeks 1 and 2 surface.
 *
 * MSISDN to Stellar account resolution, sponsored account creation with
 * trustline establishment, the pluggable {@link Signer} seam (Week 1), and
 * SEP-10 authentication through that seam: challenge request, verification
 * before signing, signature orchestration, and JWT issuance (Week 2).
 */

import { normalizeMsisdn, MsisdnResolver } from './resolver/resolver.js';
import type { AccountStore, ResolvedAccount } from './resolver/types.js';
import { createSponsoredAccount } from './accounts/sponsoredCreate.js';
import type { HorizonLike } from './accounts/horizon.js';
import type { Signer } from './signer/types.js';
import { RegistrationFailedError } from './errors.js';

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
export {
  loadAccountOrThrow,
  type HorizonLike,
  type HorizonAccount,
  type SubmitResult,
} from './accounts/horizon.js';

export {
  fetchWebAuthConfig,
  buildWebAuthConfig,
  type WebAuthConfig,
  type StellarTomlFields,
  type FetchWebAuthConfigDeps,
} from './auth/toml.js';
export { requestChallenge, type RequestChallengeParams } from './auth/challenge.js';
export {
  verifyChallenge,
  TIMEBOUNDS_GRACE_SECONDS,
  type VerifyChallengeParams,
  type VerifiedChallenge,
} from './auth/verify.js';
export {
  submitChallenge,
  decodeJwtClaims,
  assertTokenScope,
  type Sep10JwtClaims,
  type SubmitChallengeParams,
} from './auth/token.js';
export {
  authenticate,
  type AuthenticateDeps,
  type AuthenticationResult,
} from './auth/authenticate.js';

export { loadConfig, TESTNET_DEFAULTS, type AdapterConfig } from './config/index.js';
export {
  AdapterError,
  InvalidMsisdnError,
  TrustlineMissingError,
  AccountNotFoundError,
  RegistrationFailedError,
  SignerUnavailableError,
  TransactionFailedError,
  ConfigError,
  ChallengeValidationError,
  WebAuthRequestFailedError,
  TokenScopeError,
  type ChallengeFailedCheck,
  decodeSubmissionError,
  isHorizonNotFound,
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
 * Failure ordering, stated honestly in both directions:
 *
 * - The mapping is recorded only after on-chain creation succeeds, so a
 *   failed submission never leaves a dangling MSISDN → account entry.
 * - A failed registration after a successful submission leaves a funded
 *   on-chain account (sponsored reserves locked) with no mapping. That case
 *   is surfaced as {@link RegistrationFailedError}, which carries the
 *   created `accountId`, the MSISDN, and the store error, so an operator
 *   can reconcile rather than lose the account.
 *
 * @throws InvalidMsisdnError when the MSISDN is not canonical E.164 (see
 *   that error's docs: country-code inference is the caller's job).
 * @throws TransactionFailedError when the network rejects the creation.
 * @throws RegistrationFailedError when the store write fails after creation.
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
  try {
    await resolver.register(msisdn, newAccountId);
  } catch (cause) {
    throw new RegistrationFailedError(newAccountId, msisdn, cause);
  }

  return { msisdn, accountId: newAccountId, created: true, creationTxHash: result.hash };
}
