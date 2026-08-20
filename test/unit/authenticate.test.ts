/**
 * The authenticate orchestrator, end to end against a fixture anchor:
 * challenge GET, verification, signing through the Week 1 signer seam,
 * token POST, claims decode, scope check. Exercised through the public
 * `src/index.js` surface.
 */
import { Keypair, Networks, Transaction, WebAuth } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import {
  ChallengeValidationError,
  LocalKeypairSigner,
  SignerUnavailableError,
  TokenScopeError,
  authenticate,
  type WebAuthConfig,
} from '../../src/index.js';

const NET = Networks.TESTNET;
const serverKp = Keypair.random();

const anchor: WebAuthConfig = {
  homeDomain: 'testanchor.stellar.org',
  webAuthEndpoint: 'https://testanchor.stellar.org/auth',
  signingKey: serverKp.publicKey(),
  webAuthDomain: 'testanchor.stellar.org',
};

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const makeJwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.FAKESIG`;

/**
 * A fixture anchor: GET answers with a real server-signed challenge, POST
 * checks the client signature actually arrived and answers with a JWT.
 */
function fixtureAnchor(accountId: string, opts?: { jwtSub?: string; tamperChallenge?: (xdr: string) => string }) {
  const calls: Array<{ method: string; url: string }> = [];
  let postedXdr: string | undefined;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: String(input) });
    if (method === 'GET') {
      let challenge = WebAuth.buildChallengeTx(
        serverKp,
        accountId,
        anchor.homeDomain,
        300,
        NET,
        anchor.webAuthDomain,
      );
      if (opts?.tamperChallenge) challenge = opts.tamperChallenge(challenge);
      return new Response(JSON.stringify({ transaction: challenge, network_passphrase: NET }), {
        status: 200,
      });
    }
    postedXdr = (JSON.parse(String(init?.body)) as { transaction: string }).transaction;
    const posted = new Transaction(postedXdr, NET);
    // The anchor's own validation is out of scope here; assert the shape
    // the orchestrator promises: the server signature plus one more.
    if (posted.signatures.length < 2) {
      return new Response(JSON.stringify({ error: 'missing client signature' }), { status: 400 });
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    return new Response(
      JSON.stringify({
        token: makeJwt({
          iss: anchor.webAuthEndpoint,
          sub: opts?.jwtSub ?? accountId,
          iat: nowSeconds,
          exp: nowSeconds + 900,
        }),
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { fetchFn, calls, postedChallenge: () => postedXdr };
}

describe('authenticate', () => {
  it('runs the full flow and returns the token with decoded, scoped claims', async () => {
    const signer = new LocalKeypairSigner();
    const accountId = await signer.createAccountKey();
    const { fetchFn, calls, postedChallenge } = fixtureAnchor(accountId);

    const result = await authenticate({ signer, networkPassphrase: NET, anchor, fetchFn }, accountId);

    expect(result.token.split('.')).toHaveLength(3);
    expect(result.claims.sub).toBe(accountId);
    expect(result.claims.iss).toBe(anchor.webAuthEndpoint);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);

    // The posted challenge carries both signatures: the server's from the
    // anchor plus the client's added through the signer seam.
    const posted = new Transaction(postedChallenge()!, NET);
    expect(posted.signatures).toHaveLength(2);
    expect(WebAuth.verifyTxSignedBy(posted, serverKp.publicKey())).toBe(true);
    expect(WebAuth.verifyTxSignedBy(posted, accountId)).toBe(true);
  });

  it('fails fast on the canSignFor preflight with no anchor round-trip', async () => {
    const signer = new LocalKeypairSigner();
    const strangerAccount = Keypair.random().publicKey();
    const { fetchFn, calls } = fixtureAnchor(strangerAccount);

    await expect(
      authenticate({ signer, networkPassphrase: NET, anchor, fetchFn }, strangerAccount),
    ).rejects.toThrow(SignerUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it('refuses to sign a tampered challenge and never POSTs it', async () => {
    const signer = new LocalKeypairSigner();
    const accountId = await signer.createAccountKey();
    const otherAccount = Keypair.random().publicKey();
    // The anchor answers with a challenge naming a different client account.
    const { fetchFn, calls } = fixtureAnchor(accountId, {
      tamperChallenge: () =>
        WebAuth.buildChallengeTx(serverKp, otherAccount, anchor.homeDomain, 300, NET, anchor.webAuthDomain),
    });

    const err = await authenticate(
      { signer, networkPassphrase: NET, anchor, fetchFn },
      accountId,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChallengeValidationError);
    expect((err as ChallengeValidationError).failedCheck).toBe('client_account_mismatch');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('refuses a token the anchor scoped to a different account', async () => {
    const signer = new LocalKeypairSigner();
    const accountId = await signer.createAccountKey();
    const { fetchFn } = fixtureAnchor(accountId, { jwtSub: Keypair.random().publicKey() });

    await expect(
      authenticate({ signer, networkPassphrase: NET, anchor, fetchFn }, accountId),
    ).rejects.toThrow(TokenScopeError);
  });
});
