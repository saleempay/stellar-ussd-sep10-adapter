/**
 * Anchor web auth discovery: read the SEP-10 coordinates from the anchor's
 * SEP-1 stellar.toml.
 *
 * ## HTTPS posture (pinned)
 *
 * Everything on the auth path travels over HTTPS only. The toml is fetched
 * with the SDK's `StellarToml.Resolver` at its default posture (`allowHttp`
 * is false, so the resolver itself refuses plain HTTP), and the discovered
 * `WEB_AUTH_ENDPOINT` is refused here unless it is an `https://` URL, so no
 * later fetch can be downgraded by a hostile or misconfigured toml. This is
 * a config invariant, asserted in unit tests, not an option.
 */

import { StellarToml } from '@stellar/stellar-sdk';

import { ConfigError, WebAuthRequestFailedError } from '../errors.js';
import { DEFAULT_NETWORK_TIMEOUT_MS, isTimeoutError } from './timeout.js';

/**
 * The anchor coordinates the SEP-10 flow needs, all sourced from the
 * anchor's stellar.toml over HTTPS.
 */
export interface WebAuthConfig {
  /** The anchor's home domain, e.g. `testanchor.stellar.org`. */
  homeDomain: string;
  /** `WEB_AUTH_ENDPOINT` from the toml. Always `https://`. */
  webAuthEndpoint: string;
  /** `SIGNING_KEY` from the toml: the Server Account that signs challenges. */
  signingKey: string;
  /**
   * The web auth domain the challenge must name in its `web_auth_domain`
   * operation: the host of {@link webAuthEndpoint}.
   */
  webAuthDomain: string;
  /**
   * `NETWORK_PASSPHRASE` from the toml, when declared. Informational: the
   * binding check is against the adapter's own configured passphrase.
   */
  networkPassphrase?: string;
}

/** The subset of a parsed stellar.toml this module reads. */
export interface StellarTomlFields {
  WEB_AUTH_ENDPOINT?: unknown;
  SIGNING_KEY?: unknown;
  NETWORK_PASSPHRASE?: unknown;
}

/** Dependencies for {@link fetchWebAuthConfig}, injectable for tests. */
export interface FetchWebAuthConfigDeps {
  /**
   * Resolves a home domain to its parsed stellar.toml. Defaults to the
   * SDK's `StellarToml.Resolver.resolve` with its default HTTPS-only
   * posture. Injected by unit tests with fixture toml objects.
   */
  resolveToml?: (homeDomain: string, opts: { timeout: number }) => Promise<StellarTomlFields>;
  /**
   * Network timeout for the toml fetch, default
   * {@link DEFAULT_NETWORK_TIMEOUT_MS}; passed to the resolver's own
   * `timeout` option.
   */
  timeoutMs?: number;
}

/**
 * Extract and validate a {@link WebAuthConfig} from a parsed stellar.toml.
 *
 * Pure: no network. Exported so unit tests exercise every refusal without
 * fetching, and so callers with their own toml pipeline can reuse the
 * validation.
 *
 * @throws ConfigError when a required field is missing or malformed, or
 *   when `WEB_AUTH_ENDPOINT` is not an `https://` URL.
 */
export function buildWebAuthConfig(
  toml: StellarTomlFields,
  homeDomain: string,
): WebAuthConfig {
  if (!homeDomain || homeDomain.includes('://')) {
    throw new ConfigError(
      `homeDomain must be a bare domain (e.g. "testanchor.stellar.org"), got ${JSON.stringify(homeDomain)}.`,
    );
  }

  const endpoint = toml.WEB_AUTH_ENDPOINT;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new ConfigError(
      `stellar.toml for ${homeDomain} declares no WEB_AUTH_ENDPOINT; the anchor does not offer SEP-10.`,
    );
  }
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new ConfigError(
      `WEB_AUTH_ENDPOINT in stellar.toml for ${homeDomain} is not a valid URL: ${JSON.stringify(endpoint)}.`,
    );
  }
  if (endpointUrl.protocol !== 'https:') {
    throw new ConfigError(
      `WEB_AUTH_ENDPOINT for ${homeDomain} must be https (got ${JSON.stringify(endpoint)}). ` +
        'The auth path never travels over plain HTTP.',
    );
  }

  const signingKey = toml.SIGNING_KEY;
  if (typeof signingKey !== 'string' || !/^G[A-Z2-7]{55}$/.test(signingKey)) {
    throw new ConfigError(
      `stellar.toml for ${homeDomain} has no usable SIGNING_KEY; ` +
        'the challenge signature cannot be verified without it.',
    );
  }

  const networkPassphrase = toml.NETWORK_PASSPHRASE;

  return {
    homeDomain,
    webAuthEndpoint: endpoint,
    signingKey,
    webAuthDomain: endpointUrl.host,
    ...(typeof networkPassphrase === 'string' ? { networkPassphrase } : {}),
  };
}

/**
 * Fetch the anchor's stellar.toml over HTTPS and extract the SEP-10
 * coordinates.
 *
 * @param homeDomain - The anchor's home domain, without protocol.
 * @throws ConfigError per {@link buildWebAuthConfig}.
 * @throws WebAuthRequestFailedError (`phase: "toml"`, `timedOut: true`,
 *   `httpStatus: 0`) when the fetch exceeds its timeout; any other resolver
 *   failure propagates as the resolver's own error.
 */
export async function fetchWebAuthConfig(
  homeDomain: string,
  deps: FetchWebAuthConfigDeps = {},
): Promise<WebAuthConfig> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
  const resolveToml =
    deps.resolveToml ??
    ((domain: string, opts: { timeout: number }) =>
      StellarToml.Resolver.resolve(domain, opts) as Promise<StellarTomlFields>);
  let toml: StellarTomlFields;
  try {
    toml = await resolveToml(homeDomain, { timeout: timeoutMs });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new WebAuthRequestFailedError(
        'toml',
        0,
        `No stellar.toml from ${homeDomain} within ${timeoutMs} ms.`,
        undefined,
        { timedOut: true },
      );
    }
    throw err;
  }
  return buildWebAuthConfig(toml, homeDomain);
}
