/**
 * The SEP-10 challenge request: `GET <WEB_AUTH_ENDPOINT>` for one account.
 *
 * The response's challenge transaction is NOT trusted here: this module only
 * moves bytes and checks the response envelope (HTTP status, JSON shape, and
 * the recommended `network_passphrase` cross-check). The security core is
 * `verify.ts`, which must pass before anything is signed.
 */

import {
  ChallengeValidationError,
  ConfigError,
  WebAuthRequestFailedError,
} from '../errors.js';
import { DEFAULT_NETWORK_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from './timeout.js';
import type { WebAuthConfig } from './toml.js';

/** Parameters for {@link requestChallenge}. */
export interface RequestChallengeParams {
  /** Anchor coordinates from {@link fetchWebAuthConfig}. */
  anchor: WebAuthConfig;
  /** The Client Account (G...) to request a challenge for. */
  accountId: string;
  /** The network passphrase the adapter is configured for. */
  networkPassphrase: string;
  /** Injectable transport, defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Network timeout for this leg, default {@link DEFAULT_NETWORK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Request a challenge transaction from the anchor.
 *
 * Sends `account` and, explicitly, `home_domain` (optional per SEP-10, sent
 * for determinism against multi-domain anchors). Never sends `memo` or
 * `client_domain`: this adapter authenticates plainly (see the integration
 * guide's client_domain extension point note).
 *
 * @returns The challenge transaction, base64 XDR, still unverified.
 * @throws ConfigError when the endpoint is not https (defense in depth; the
 *   toml module already refuses such a config).
 * @throws WebAuthRequestFailedError on a non-200 answer or an unusable body,
 *   or with `timedOut: true` and `httpStatus: 0` when the leg exceeds its
 *   timeout.
 * @throws ChallengeValidationError (`network_passphrase_mismatch`) when the
 *   anchor declares a passphrase that is not the configured one.
 */
export async function requestChallenge(params: RequestChallengeParams): Promise<string> {
  const { anchor, accountId, networkPassphrase } = params;
  const fetchFn = params.fetchFn ?? fetch;
  const timeoutMs = params.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;

  if (!anchor.webAuthEndpoint.startsWith('https://')) {
    throw new ConfigError(
      `Refusing SEP-10 challenge request to a non-https endpoint: ${anchor.webAuthEndpoint}`,
    );
  }

  const url = new URL(anchor.webAuthEndpoint);
  url.searchParams.set('account', accountId);
  url.searchParams.set('home_domain', anchor.homeDomain);

  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, url.toString(), { method: 'GET' }, timeoutMs);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new WebAuthRequestFailedError(
        'challenge',
        0,
        `No response from the anchor within ${timeoutMs} ms.`,
        undefined,
        { timedOut: true },
      );
    }
    throw err;
  }
  const body = await readJson(res);

  if (res.status !== 200) {
    throw new WebAuthRequestFailedError(
      'challenge',
      res.status,
      'The anchor refused to issue a challenge.',
      anchorErrorField(body),
    );
  }
  if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).transaction !== 'string') {
    throw new WebAuthRequestFailedError(
      'challenge',
      res.status,
      'The challenge response carries no usable `transaction` field.',
    );
  }

  const { transaction, network_passphrase: anchorPassphrase } = body as {
    transaction: string;
    network_passphrase?: unknown;
  };
  if (typeof anchorPassphrase === 'string' && anchorPassphrase !== networkPassphrase) {
    throw new ChallengeValidationError(
      'network_passphrase_mismatch',
      `The anchor's network_passphrase (${JSON.stringify(anchorPassphrase)}) is not the ` +
        `configured one (${JSON.stringify(networkPassphrase)}). One side is on the wrong network.`,
    );
  }

  return transaction;
}

/** Parse a response body as JSON, tolerating non-JSON error bodies. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** The anchor's `error` field, when the body has one. */
function anchorErrorField(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string') {
    return (body as { error: string }).error;
  }
  return undefined;
}
