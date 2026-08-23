/**
 * The SEP-10 token leg: POST the signed challenge, receive the anchor's JWT,
 * decode its claims, and check their scope.
 *
 * ## The adapter stores nothing
 *
 * The JWT is returned to the caller and no copy, cache, or session state is
 * kept here (a settled sprint ruling): session custody across a USSD session
 * belongs to the session layer. Scoping is carried by the claims themselves,
 * so callers holding a token re-check it with {@link assertTokenScope}
 * before each use.
 *
 * ## Decode, not verify
 *
 * Claims are decoded, never signature-verified: the JWT is the anchor's own
 * bearer credential, verified by the anchor on every authenticated call, and
 * clients hold no verification key for it. Nothing here treats the decoded
 * claims as proof of anything beyond what the anchor asserted.
 */

import { TokenScopeError, WebAuthRequestFailedError } from '../errors.js';
import { DEFAULT_NETWORK_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from './timeout.js';
import type { WebAuthConfig } from './toml.js';

/**
 * The SEP-10 JWT claims (RFC 7519 registered claims plus SEP-10's optional
 * extras). `sub` scopes the token to one account: for this adapter's flow
 * always the plain `G...` account, since no memo is ever requested and muxed
 * accounts are not used; the `G...:memo` and `M...` forms defined by SEP-10
 * are typed here for completeness and handled by {@link assertTokenScope}.
 */
export interface Sep10JwtClaims {
  /** The issuing anchor, as a URI. */
  iss?: string;
  /** The authenticated principal: `G...`, `G...:memo`, or `M...`. */
  sub?: string;
  /** Issued-at, unix seconds. */
  iat?: number;
  /** Expiry, unix seconds. The session window is [iat, exp). */
  exp?: number;
  /** Token id; anchors commonly set it to the challenge transaction hash. */
  jti?: string;
  /** Present only when a client_domain was verified (never in this flow). */
  client_domain?: string;
  /** Anchors may add application-specific claims. */
  [claim: string]: unknown;
}

/** Parameters for {@link submitChallenge}. */
export interface SubmitChallengeParams {
  /** Anchor coordinates from {@link fetchWebAuthConfig}. */
  anchor: WebAuthConfig;
  /** The verified challenge, now carrying the client signature, base64 XDR. */
  signedChallengeXdr: string;
  /** Injectable transport, defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Network timeout for this leg, default {@link DEFAULT_NETWORK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * POST the signed challenge back to the anchor and return the JWT.
 *
 * @throws WebAuthRequestFailedError on any non-200 answer (carrying the
 *   anchor's `error` string verbatim when present) or an unusable body, or
 *   with `timedOut: true` and `httpStatus: 0` when the leg exceeds its
 *   timeout.
 */
export async function submitChallenge(params: SubmitChallengeParams): Promise<string> {
  const { anchor, signedChallengeXdr } = params;
  const fetchFn = params.fetchFn ?? fetch;
  const timeoutMs = params.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchFn,
      anchor.webAuthEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: signedChallengeXdr }),
      },
      timeoutMs,
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new WebAuthRequestFailedError(
        'token',
        0,
        `No response from the anchor within ${timeoutMs} ms.`,
        undefined,
        { timedOut: true },
      );
    }
    throw err;
  }
  const body: unknown = await res.json().catch(() => undefined);

  if (res.status !== 200) {
    const anchorError =
      typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as { error: string }).error)
        : undefined;
    throw new WebAuthRequestFailedError(
      'token',
      res.status,
      'The anchor rejected the signed challenge.',
      anchorError,
    );
  }
  if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).token !== 'string') {
    throw new WebAuthRequestFailedError(
      'token',
      res.status,
      'The token response carries no usable `token` field.',
    );
  }
  return (body as { token: string }).token;
}

/**
 * Decode a JWT's payload claims without verifying its signature (see the
 * module note on why clients decode rather than verify).
 *
 * @throws WebAuthRequestFailedError when the token is not a decodable JWT.
 */
export function decodeJwtClaims(token: string): Sep10JwtClaims {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || !payload) {
    throw new WebAuthRequestFailedError(
      'token',
      200,
      'The anchor returned a token that is not a three-part JWT.',
    );
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new WebAuthRequestFailedError(
      'token',
      200,
      'The JWT payload is not base64url-encoded JSON.',
    );
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    throw new WebAuthRequestFailedError('token', 200, 'The JWT payload is not a claims object.');
  }
  return claims as Sep10JwtClaims;
}

/**
 * Assert that decoded claims scope a token to `accountId` and that the
 * token is not expired. Pure, no clock side effects when `nowSeconds` is
 * given; this is the check a caller runs before each use of a held token.
 *
 * The `sub` forms are handled per SEP-10: a `G...:memo` subject matches on
 * its account part; a plain subject must match exactly.
 *
 * Present-but-unusable claims refuse, they never silently pass: a `sub`
 * that is not a string, or an `exp` that is present but not a finite
 * number (a string, NaN, Infinity, null, an object), throws with a
 * distinguishable reason so callers can tell malformed from expired. Only
 * an `exp` that is entirely absent is accepted (expiry is then enforced
 * by the anchor alone).
 *
 * @throws TokenScopeError on a missing, malformed, or mismatched `sub`, on
 *   a malformed `exp`, or on an expired token.
 */
export function assertTokenScope(
  claims: Sep10JwtClaims,
  accountId: string,
  nowSeconds?: number,
): void {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const sub = claims.sub;
  if (sub === undefined) {
    throw new TokenScopeError(accountId, 'The token has no `sub` claim to scope it to an account.');
  }
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new TokenScopeError(
      accountId,
      `The token's \`sub\` claim is malformed (expected a non-empty string, got ${describeClaim(sub)}).`,
    );
  }
  const subAccount = sub.includes(':') ? sub.slice(0, sub.indexOf(':')) : sub;
  if (subAccount !== accountId) {
    throw new TokenScopeError(
      accountId,
      `The token is scoped to ${sub}, not to the expected account ${accountId}.`,
      sub,
    );
  }
  const exp = claims.exp;
  if (exp !== undefined) {
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      throw new TokenScopeError(
        accountId,
        `The token's \`exp\` claim is malformed (expected a finite number of unix seconds, got ${describeClaim(exp)}).`,
        sub,
      );
    }
    if (exp <= now) {
      throw new TokenScopeError(
        accountId,
        `The token expired at ${exp} (now ${now}). Re-authenticate.`,
        sub,
      );
    }
  }
}

/** A short, safe description of a malformed claim value for error text. */
function describeClaim(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
  if (typeof value === 'string') return `a string ${JSON.stringify(value)}`;
  return `a value of type ${typeof value}`;
}
