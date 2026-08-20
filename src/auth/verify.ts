/**
 * SEP-10 challenge verification: the security core of the auth flow.
 *
 * The adapter refuses to sign a challenge that fails ANY check. Checks run
 * in a fixed order and the first failure is reported as a typed
 * {@link ChallengeValidationError} whose `failedCheck` names it (a stable
 * contract, documented in the integration guide).
 *
 * ## Who checks what
 *
 * Each named security check is performed explicitly here, so every refusal
 * carries a precise name, and then the SDK's own `WebAuth.readChallengeTx`
 * runs as the authoritative final gate (defense in depth: a residual SDK
 * refusal surfaces as `sdk_validation`). The two adapter-only checks the SDK
 * cannot perform, because only the caller knows them, run last: the
 * challenge must name the account we asked to authenticate
 * (`client_account_mismatch`) and must carry no memo, since we never request
 * one (`unexpected_memo`).
 *
 * ## Timebounds grace
 *
 * The SDK's `readChallengeTx` applies a fixed 5 minute clock-skew grace on
 * both sides of the timebounds window. The explicit check here uses the
 * same grace so the two gates agree; the grace is a documented property of
 * the flow, not an option.
 */

import { FeeBumpTransaction, MemoNone, Transaction, WebAuth } from '@stellar/stellar-sdk';

import { ChallengeValidationError } from '../errors.js';
import type { WebAuthConfig } from './toml.js';

/** Clock-skew tolerance, matching the SDK's `readChallengeTx`. */
export const TIMEBOUNDS_GRACE_SECONDS = 300;

/** Parameters for {@link verifyChallenge}. */
export interface VerifyChallengeParams {
  /** The challenge transaction, base64 XDR, as received from the anchor. */
  challengeXdr: string;
  /** The account the challenge was requested for. */
  expectedAccountId: string;
  /** Anchor coordinates: SIGNING_KEY, home domain, web auth domain. */
  anchor: WebAuthConfig;
  /** The network passphrase the adapter is configured for. */
  networkPassphrase: string;
  /** Current unix time in seconds; injectable for tests. */
  nowSeconds?: number;
}

/** What a verified challenge established. */
export interface VerifiedChallenge {
  /** The client account the challenge names (equals the expected account). */
  clientAccountId: string;
  /** The home domain matched in the first operation's key. */
  matchedHomeDomain: string;
}

/**
 * Verify a SEP-10 challenge transaction before signing.
 *
 * @throws ChallengeValidationError naming the first failed check. A
 *   challenge that throws here must never be signed.
 */
export function verifyChallenge(params: VerifyChallengeParams): VerifiedChallenge {
  const { challengeXdr, expectedAccountId, anchor, networkPassphrase } = params;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  // 1. Deserialization: a classic Transaction under the configured
  //    passphrase. A fee-bump envelope is not a valid challenge.
  let tx: Transaction;
  try {
    tx = new Transaction(challengeXdr, networkPassphrase);
  } catch {
    let detail = 'not a decodable transaction envelope';
    try {
      new FeeBumpTransaction(challengeXdr, networkPassphrase);
      detail = 'a fee-bump envelope is not a valid SEP-10 challenge';
    } catch {
      // Keep the generic detail.
    }
    throw new ChallengeValidationError('deserialization', detail);
  }

  // 2. Sequence number must be exactly zero, so the challenge can never
  //    execute on the network.
  if (Number.parseInt(tx.sequence, 10) !== 0) {
    throw new ChallengeValidationError(
      'sequence_not_zero',
      `sequence is ${tx.sequence}, must be 0.`,
    );
  }

  // 3. The transaction source must be the anchor's SIGNING_KEY from the
  //    HTTPS-fetched stellar.toml.
  if (tx.source !== anchor.signingKey) {
    throw new ChallengeValidationError(
      'source_not_server',
      `transaction source ${tx.source} is not the anchor SIGNING_KEY ${anchor.signingKey}.`,
    );
  }

  // 4 to 7. First operation: present, sourced by the client, manage_data,
  //         named "<home domain> auth".
  const [firstOp, ...extraOps] = tx.operations;
  if (!firstOp) {
    throw new ChallengeValidationError('no_operations', 'the challenge has no operations.');
  }
  if (!firstOp.source) {
    throw new ChallengeValidationError(
      'first_op_source_missing',
      'the first operation has no source account, so there is no client account to authenticate.',
    );
  }
  if (firstOp.type !== 'manageData') {
    throw new ChallengeValidationError(
      'first_op_not_manage_data',
      `the first operation is ${firstOp.type}, must be manageData.`,
    );
  }
  const expectedName = `${anchor.homeDomain} auth`;
  if (firstOp.name !== expectedName) {
    throw new ChallengeValidationError(
      'home_domain_mismatch',
      `the first operation is named ${JSON.stringify(firstOp.name)}, expected ${JSON.stringify(expectedName)}.`,
    );
  }

  // 8 and 9. Timebounds: present, finite, and current (with the documented
  //          grace on both sides).
  const bounds = tx.timeBounds;
  if (!bounds || Number.parseInt(bounds.maxTime, 10) === 0) {
    throw new ChallengeValidationError(
      'timebounds_missing',
      'the challenge has no finite timebounds.',
    );
  }
  const minTime = Number.parseInt(bounds.minTime, 10);
  const maxTime = Number.parseInt(bounds.maxTime, 10);
  if (now < minTime - TIMEBOUNDS_GRACE_SECONDS || now > maxTime + TIMEBOUNDS_GRACE_SECONDS) {
    throw new ChallengeValidationError(
      'timebounds_expired',
      `current time ${now} is outside [${minTime}, ${maxTime}] plus ${TIMEBOUNDS_GRACE_SECONDS}s grace.`,
    );
  }

  // 10. The nonce: 64 base64 characters decoding to 48 random bytes.
  const nonce = firstOp.value;
  if (nonce === undefined || Buffer.from(nonce.toString(), 'base64').length !== 48) {
    throw new ChallengeValidationError(
      'nonce_invalid',
      'the first operation value must be a base64 encoding of 48 random bytes.',
    );
  }

  // 11 and 12. Subsequent operations: all manage_data, sourced by the
  //            server (a client_domain operation is the one exception, and
  //            this adapter never requests one), and any web_auth_domain
  //            operation must name the endpoint's host.
  for (const op of extraOps) {
    if (op.type !== 'manageData') {
      throw new ChallengeValidationError(
        'extra_op_invalid',
        `subsequent operation of type ${op.type}, all must be manageData.`,
      );
    }
    if (op.source !== anchor.signingKey && op.name !== 'client_domain') {
      throw new ChallengeValidationError(
        'extra_op_invalid',
        `subsequent operation ${JSON.stringify(op.name)} is not sourced by the server account.`,
      );
    }
    if (op.name === 'web_auth_domain') {
      const value = op.value?.toString();
      if (value !== anchor.webAuthDomain) {
        throw new ChallengeValidationError(
          'web_auth_domain_mismatch',
          `web_auth_domain is ${JSON.stringify(value)}, expected ${JSON.stringify(anchor.webAuthDomain)}.`,
        );
      }
    }
  }

  // 13. The anchor's signature over the challenge, under the configured
  //     network passphrase (the signed hash binds the passphrase, so a
  //     wrong-network challenge fails here too).
  if (!WebAuth.verifyTxSignedBy(tx, anchor.signingKey)) {
    throw new ChallengeValidationError(
      'server_signature_invalid',
      `the challenge is not validly signed by ${anchor.signingKey} under the configured ` +
        'network passphrase (an invalid signature and a wrong network are indistinguishable here).',
    );
  }

  // 14. The SDK's own reader as the authoritative final gate.
  let clientAccountID: string;
  let matchedHomeDomain: string;
  let memo: string | null;
  try {
    ({ clientAccountID, matchedHomeDomain, memo } = WebAuth.readChallengeTx(
      challengeXdr,
      anchor.signingKey,
      networkPassphrase,
      anchor.homeDomain,
      anchor.webAuthDomain,
    ));
  } catch (err) {
    throw new ChallengeValidationError(
      'sdk_validation',
      `the SDK challenge reader refused the challenge: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 15. Only the caller knows which account it asked to authenticate. A
  //     challenge naming any other account is refused, signature unmade.
  if (clientAccountID !== expectedAccountId) {
    throw new ChallengeValidationError(
      'client_account_mismatch',
      `the challenge names client account ${clientAccountID}, expected ${expectedAccountId}.`,
    );
  }

  // 16. This adapter never requests a memo, so a challenge carrying one was
  //     not built for our request.
  if (memo !== null || tx.memo.type !== MemoNone) {
    throw new ChallengeValidationError(
      'unexpected_memo',
      'the challenge carries a memo, but none was requested.',
    );
  }

  return { clientAccountId: clientAccountID, matchedHomeDomain };
}
