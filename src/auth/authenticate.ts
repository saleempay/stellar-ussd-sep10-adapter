/**
 * The Week 2 end-to-end flow: authenticate one account with a SEP-10 anchor
 * through the pluggable signer seam, and hand the anchor's JWT straight back
 * to the caller.
 */

import { SignerUnavailableError } from '../errors.js';
import type { Signer } from '../signer/types.js';
import { requestChallenge } from './challenge.js';
import type { Sep10JwtClaims } from './token.js';
import { assertTokenScope, decodeJwtClaims, submitChallenge } from './token.js';
import type { WebAuthConfig } from './toml.js';
import { verifyChallenge } from './verify.js';

/** Dependencies for {@link authenticate}. */
export interface AuthenticateDeps {
  /** The signing backend: the same seam Week 1 defined, unchanged. */
  signer: Signer;
  /** The network passphrase the adapter is configured for. */
  networkPassphrase: string;
  /** Anchor coordinates, usually from `fetchWebAuthConfig(homeDomain)`. */
  anchor: WebAuthConfig;
  /** Injectable transport for both HTTP legs, defaults to global fetch. */
  fetchFn?: typeof fetch;
  /**
   * Network timeout applied to each HTTP leg (challenge GET, token POST),
   * default 10 seconds. Pass the same value to `fetchWebAuthConfig` for
   * the toml leg. A USSD session is gateway-bounded at 120 to 180 seconds,
   * so a hung anchor must become a fast typed failure.
   */
  timeoutMs?: number;
}

/** What {@link authenticate} returns. The adapter keeps no copy of either. */
export interface AuthenticationResult {
  /** The anchor's JWT, verbatim: the bearer credential for SEP endpoints. */
  token: string;
  /** The decoded (not signature-verified) claims, for scope checks. */
  claims: Sep10JwtClaims;
}

/**
 * Authenticate `accountId` with the anchor over SEP-10.
 *
 * The flow, in order:
 *
 * 1. **Preflight**: `signer.canSignFor(accountId)`, so a signer that cannot
 *    produce the one required signature fails fast with no anchor
 *    round-trip.
 * 2. **Challenge**: GET the challenge from the anchor's WEB_AUTH_ENDPOINT
 *    (HTTPS only).
 * 3. **Verify before signing**: every check in `verifyChallenge`. A
 *    challenge that fails any check is refused, unsigned.
 * 4. **Sign** through the signer seam: base64 XDR in, signed XDR out; no
 *    key material crosses the boundary. The challenge is an authentication
 *    artifact and is never submitted to the network.
 * 5. **Token**: POST the signed challenge back; the anchor validates it and
 *    answers with the session JWT.
 * 6. **Scope check**: the decoded claims must scope the token to
 *    `accountId` and carry a live expiry.
 *
 * The token and claims are returned to the caller; the adapter stores
 * nothing (session custody is the caller's concern, by ruling).
 *
 * @throws SignerUnavailableError when the signer cannot sign for the account.
 * @throws ChallengeValidationError when the challenge fails verification.
 * @throws WebAuthRequestFailedError when either HTTP leg fails.
 * @throws TokenScopeError when the issued token is not scoped to the account.
 */
export async function authenticate(
  deps: AuthenticateDeps,
  accountId: string,
): Promise<AuthenticationResult> {
  const { signer, networkPassphrase, anchor, fetchFn, timeoutMs } = deps;

  if (!(await signer.canSignFor(accountId))) {
    throw new SignerUnavailableError(accountId);
  }

  const challengeXdr = await requestChallenge({ anchor, accountId, networkPassphrase, fetchFn, timeoutMs });

  verifyChallenge({ challengeXdr, expectedAccountId: accountId, anchor, networkPassphrase });

  const signedChallengeXdr = await signer.signTransaction(challengeXdr, {
    networkPassphrase,
    accountId,
  });

  const token = await submitChallenge({ anchor, signedChallengeXdr, fetchFn, timeoutMs });
  const claims = decodeJwtClaims(token);
  assertTokenScope(claims, accountId);

  return { token, claims };
}
