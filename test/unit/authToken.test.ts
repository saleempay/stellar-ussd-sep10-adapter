import { describe, expect, it } from 'vitest';

import { TokenScopeError, WebAuthRequestFailedError } from '../../src/errors.js';
import {
  assertTokenScope,
  decodeJwtClaims,
  submitChallenge,
  type Sep10JwtClaims,
} from '../../src/auth/token.js';
import type { WebAuthConfig } from '../../src/auth/toml.js';

const ACCOUNT = 'GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE';

const anchor: WebAuthConfig = {
  homeDomain: 'testanchor.stellar.org',
  webAuthEndpoint: 'https://testanchor.stellar.org/auth',
  signingKey: 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR',
  webAuthDomain: 'testanchor.stellar.org',
};

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A decode-only JWT fixture; the signature segment is deliberately fake. */
const makeJwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.FAKESIG`;

function fixtureFetch(status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('submitChallenge', () => {
  it('POSTs the signed challenge as JSON and returns the token', async () => {
    const { fetchFn, calls } = fixtureFetch(200, { token: 'jwt-here' });
    const token = await submitChallenge({ anchor, signedChallengeXdr: 'SIGNEDXDR', fetchFn });
    expect(token).toBe('jwt-here');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(anchor.webAuthEndpoint);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ transaction: 'SIGNEDXDR' });
  });

  it('maps an anchor rejection to WebAuthRequestFailedError with the anchor error', async () => {
    const { fetchFn } = fixtureFetch(400, { error: 'The provided transaction is not valid' });
    const err = await submitChallenge({ anchor, signedChallengeXdr: 'X', fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WebAuthRequestFailedError);
    const failure = err as WebAuthRequestFailedError;
    expect(failure.phase).toBe('token');
    expect(failure.httpStatus).toBe(400);
    expect(failure.anchorError).toBe('The provided transaction is not valid');
  });

  it('refuses a 200 body with no usable token field', async () => {
    const { fetchFn } = fixtureFetch(200, { token: 123 });
    await expect(submitChallenge({ anchor, signedChallengeXdr: 'X', fetchFn })).rejects.toThrow(
      WebAuthRequestFailedError,
    );
  });
});

describe('decodeJwtClaims', () => {
  it('decodes the payload claims without verifying the signature', () => {
    const claims = decodeJwtClaims(
      makeJwt({ iss: 'https://testanchor.stellar.org/auth', sub: ACCOUNT, iat: 1, exp: 2 }),
    );
    expect(claims.sub).toBe(ACCOUNT);
    expect(claims.iss).toBe('https://testanchor.stellar.org/auth');
    expect(claims.iat).toBe(1);
    expect(claims.exp).toBe(2);
  });

  it('refuses a token that is not a three-part JWT', () => {
    expect(() => decodeJwtClaims('only.twoparts')).toThrow(WebAuthRequestFailedError);
    expect(() => decodeJwtClaims('')).toThrow(WebAuthRequestFailedError);
  });

  it('refuses a payload that is not base64url JSON', () => {
    expect(() => decodeJwtClaims('aGVhZGVy.!!!notb64.sig')).toThrow(WebAuthRequestFailedError);
  });

  it('refuses a payload that is JSON but not a claims object', () => {
    const payload = Buffer.from(JSON.stringify([1, 2])).toString('base64url');
    expect(() => decodeJwtClaims(`aGVhZGVy.${payload}.sig`)).toThrow(WebAuthRequestFailedError);
  });
});

describe('assertTokenScope', () => {
  const live: Sep10JwtClaims = { sub: ACCOUNT, iat: 100, exp: 1000 };

  it('accepts a token scoped to the account and not yet expired', () => {
    expect(() => assertTokenScope(live, ACCOUNT, 500)).not.toThrow();
  });

  it('accepts the G...:memo subject form by comparing the account part', () => {
    expect(() => assertTokenScope({ ...live, sub: `${ACCOUNT}:17509749319012223907` }, ACCOUNT, 500)).not.toThrow();
  });

  it('refuses a missing sub claim', () => {
    expect(() => assertTokenScope({ iat: 100, exp: 1000 }, ACCOUNT, 500)).toThrow(TokenScopeError);
  });

  it('refuses a token scoped to a different account', () => {
    const other = 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR';
    const err = (() => {
      try {
        assertTokenScope({ ...live, sub: other }, ACCOUNT, 500);
      } catch (e) {
        return e as TokenScopeError;
      }
      throw new Error('expected refusal');
    })();
    expect(err).toBeInstanceOf(TokenScopeError);
    expect(err.accountId).toBe(ACCOUNT);
    expect(err.sub).toBe(other);
  });

  it('refuses an expired token', () => {
    expect(() => assertTokenScope(live, ACCOUNT, 1000)).toThrow(TokenScopeError);
    expect(() => assertTokenScope(live, ACCOUNT, 5000)).toThrow(/expired/);
  });

  it('accepts a token with no exp claim (expiry is then the anchor side only)', () => {
    expect(() => assertTokenScope({ sub: ACCOUNT }, ACCOUNT, 5000)).not.toThrow();
  });
});

describe('assertTokenScope refuses present-but-unusable claims', () => {
  it("refuses the reviewer's probe: exp as the string \"1\" with a matching sub", () => {
    expect(() => assertTokenScope({ sub: ACCOUNT, exp: '1' } as never, ACCOUNT, 1_000_000)).toThrow(
      TokenScopeError,
    );
    expect(() => assertTokenScope({ sub: ACCOUNT, exp: '1' } as never, ACCOUNT, 1_000_000)).toThrow(
      /malformed/,
    );
  });

  it('refuses exp as NaN, Infinity, null, or an object, distinguishably from expiry', () => {
    for (const exp of [Number.NaN, Number.POSITIVE_INFINITY, null, { at: 1 }]) {
      const err = (() => {
        try {
          assertTokenScope({ sub: ACCOUNT, exp } as never, ACCOUNT, 500);
        } catch (e) {
          return e as TokenScopeError;
        }
        throw new Error(`expected refusal for exp=${String(exp)}`);
      })();
      expect(err).toBeInstanceOf(TokenScopeError);
      expect(err.message).toMatch(/malformed/);
      expect(err.message).not.toMatch(/expired/);
    }
  });

  it('refuses a non-string sub instead of bypassing the subject match', () => {
    for (const sub of [42, null, { id: ACCOUNT }, ['x']]) {
      expect(() => assertTokenScope({ sub, exp: 1000 } as never, ACCOUNT, 500)).toThrow(/malformed/);
    }
  });

  it('refuses an empty-string sub', () => {
    expect(() => assertTokenScope({ sub: '' }, ACCOUNT, 500)).toThrow(TokenScopeError);
  });
});
