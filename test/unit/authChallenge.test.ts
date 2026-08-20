import { describe, expect, it } from 'vitest';

import {
  ChallengeValidationError,
  ConfigError,
  WebAuthRequestFailedError,
} from '../../src/errors.js';
import { requestChallenge } from '../../src/auth/challenge.js';
import type { WebAuthConfig } from '../../src/auth/toml.js';

const NET = 'Test SDF Network ; September 2015';
const ACCOUNT = 'GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE';

const anchor: WebAuthConfig = {
  homeDomain: 'testanchor.stellar.org',
  webAuthEndpoint: 'https://testanchor.stellar.org/auth',
  signingKey: 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR',
  webAuthDomain: 'testanchor.stellar.org',
};

/** A recorded-fixture transport: canned response, requests captured. */
function fixtureFetch(status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('requestChallenge', () => {
  it('GETs account and an explicit home_domain, returning the challenge XDR', async () => {
    const { fetchFn, calls } = fixtureFetch(200, { transaction: 'AAAA...', network_passphrase: NET });
    const xdr = await requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn });
    expect(xdr).toBe('AAAA...');
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://testanchor.stellar.org/auth');
    expect(url.searchParams.get('account')).toBe(ACCOUNT);
    expect(url.searchParams.get('home_domain')).toBe('testanchor.stellar.org');
    expect(url.searchParams.has('memo')).toBe(false);
    expect(url.searchParams.has('client_domain')).toBe(false);
  });

  it('accepts a response that omits network_passphrase', async () => {
    const { fetchFn } = fixtureFetch(200, { transaction: 'AAAA...' });
    await expect(
      requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }),
    ).resolves.toBe('AAAA...');
  });

  it('refuses a non-https endpoint outright (defense in depth)', async () => {
    const { fetchFn, calls } = fixtureFetch(200, { transaction: 'AAAA...' });
    const insecure = { ...anchor, webAuthEndpoint: 'http://testanchor.stellar.org/auth' };
    await expect(
      requestChallenge({ anchor: insecure, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }),
    ).rejects.toThrow(ConfigError);
    expect(calls).toHaveLength(0);
  });

  it('maps an anchor 4xx to WebAuthRequestFailedError with the anchor error verbatim', async () => {
    const { fetchFn } = fixtureFetch(400, { error: 'unable to validate account' });
    const err = await requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WebAuthRequestFailedError);
    const failure = err as WebAuthRequestFailedError;
    expect(failure.phase).toBe('challenge');
    expect(failure.httpStatus).toBe(400);
    expect(failure.anchorError).toBe('unable to validate account');
  });

  it('tolerates a non-JSON error body', async () => {
    const { fetchFn } = fixtureFetch(500, undefined);
    const err = await requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WebAuthRequestFailedError);
    expect((err as WebAuthRequestFailedError).httpStatus).toBe(500);
    expect((err as WebAuthRequestFailedError).anchorError).toBeUndefined();
  });

  it('refuses a 200 body with no usable transaction field', async () => {
    const { fetchFn } = fixtureFetch(200, { transaction: 42 });
    await expect(
      requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }),
    ).rejects.toThrow(WebAuthRequestFailedError);
  });

  it('refuses a challenge declared for another network', async () => {
    const { fetchFn } = fixtureFetch(200, {
      transaction: 'AAAA...',
      network_passphrase: 'Public Global Stellar Network ; September 2015',
    });
    const err = await requestChallenge({ anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChallengeValidationError);
    expect((err as ChallengeValidationError).failedCheck).toBe('network_passphrase_mismatch');
  });
});
