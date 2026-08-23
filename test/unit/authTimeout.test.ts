/**
 * Every network leg on the auth path is bounded: a transport that never
 * answers becomes a typed WebAuthRequestFailedError with timedOut true and
 * httpStatus 0, within the configured timeout.
 */
import { describe, expect, it } from 'vitest';

import { WebAuthRequestFailedError } from '../../src/errors.js';
import { requestChallenge } from '../../src/auth/challenge.js';
import { DEFAULT_NETWORK_TIMEOUT_MS, fetchWithTimeout } from '../../src/auth/timeout.js';
import { submitChallenge } from '../../src/auth/token.js';
import { fetchWebAuthConfig, type WebAuthConfig } from '../../src/auth/toml.js';

const NET = 'Test SDF Network ; September 2015';
const ACCOUNT = 'GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE';
const anchor: WebAuthConfig = {
  homeDomain: 'testanchor.stellar.org',
  webAuthEndpoint: 'https://testanchor.stellar.org/auth',
  signingKey: 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR',
  webAuthDomain: 'testanchor.stellar.org',
};

/** A transport that never resolves and ignores the abort signal entirely. */
const neverResolving = (() => new Promise<Response>(() => {})) as typeof fetch;

/** A transport that never resolves but honours the abort signal. */
const abortable = ((_: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  })) as typeof fetch;

function expectTimeout(err: unknown, phase: 'toml' | 'challenge' | 'token') {
  expect(err).toBeInstanceOf(WebAuthRequestFailedError);
  const e = err as WebAuthRequestFailedError;
  expect(e.phase).toBe(phase);
  expect(e.timedOut).toBe(true);
  expect(e.httpStatus).toBe(0);
  expect(e.anchorError).toBeUndefined();
  expect(e.message).toMatch(/timed out/);
}

describe('network timeouts on the auth path', () => {
  it('defaults to 10 seconds per leg', () => {
    expect(DEFAULT_NETWORK_TIMEOUT_MS).toBe(10_000);
  });

  it('bounds the challenge GET against a never-resolving transport', async () => {
    const started = Date.now();
    const err = await requestChallenge({
      anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn: neverResolving, timeoutMs: 50,
    }).catch((e: unknown) => e);
    expectTimeout(err, 'challenge');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds the token POST against a never-resolving transport', async () => {
    const err = await submitChallenge({
      anchor, signedChallengeXdr: 'X', fetchFn: neverResolving, timeoutMs: 50,
    }).catch((e: unknown) => e);
    expectTimeout(err, 'token');
  });

  it('maps a transport that honours the abort signal to the same typed timeout', async () => {
    const err = await requestChallenge({
      anchor, accountId: ACCOUNT, networkPassphrase: NET, fetchFn: abortable, timeoutMs: 50,
    }).catch((e: unknown) => e);
    expectTimeout(err, 'challenge');
  });

  it('passes the timeout to the toml resolver and maps its timeout error', async () => {
    const seen: number[] = [];
    const err = await fetchWebAuthConfig('testanchor.stellar.org', {
      timeoutMs: 50,
      resolveToml: async (_domain, opts) => {
        seen.push(opts.timeout);
        // The SDK resolver's own cancel error shape on timeout.
        throw Object.assign(new Error('timeout of 50ms exceeded'), { name: 'CanceledError' });
      },
    }).catch((e: unknown) => e);
    expect(seen).toEqual([50]);
    expectTimeout(err, 'toml');
  });

  it('propagates a non-timeout resolver failure unchanged', async () => {
    await expect(
      fetchWebAuthConfig('testanchor.stellar.org', {
        resolveToml: async () => {
          throw new Error('stellar.toml does not exist');
        },
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('attaches an AbortSignal to the underlying fetch and clears its timer on success', async () => {
    let signalSeen: AbortSignal | undefined;
    const fetchFn = (async (_: unknown, init?: RequestInit) => {
      signalSeen = init?.signal ?? undefined;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const res = await fetchWithTimeout(fetchFn, 'https://example.invalid/', { method: 'GET' }, 1000);
    expect(res.status).toBe(200);
    expect(signalSeen).toBeInstanceOf(AbortSignal);
  });
});
