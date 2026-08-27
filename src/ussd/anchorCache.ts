/**
 * Anchor configuration cache: the toml never costs a callback.
 *
 * The gateway expects every callback answered within 10 seconds, so the
 * stellar.toml resolution (WEB_AUTH_ENDPOINT, SIGNING_KEY, TRANSFER_SERVER)
 * is done ONCE at handler startup and refreshed in the background. Startup
 * fails fast when the anchor is unreachable: a session service that cannot
 * authenticate anyone refuses to start instead of serving sessions that
 * must all fail.
 */

import { ConfigError } from '../errors.js';
import { buildWebAuthConfig, fetchWebAuthConfig } from '../auth/toml.js';
import type { FetchWebAuthConfigDeps, StellarTomlFields, WebAuthConfig } from '../auth/toml.js';

/** Everything the journey needs to know about the anchor. */
export interface AnchorInfo {
  /** SEP-10 coordinates, validated (HTTPS pinned). */
  auth: WebAuthConfig;
  /** `TRANSFER_SERVER` from the toml: the SEP-6 base URL. HTTPS only. */
  transferServer: string;
}

/** Toml fields this module reads beyond the auth subset. */
interface TransferTomlFields extends StellarTomlFields {
  TRANSFER_SERVER?: unknown;
}

/** Dependencies for {@link AnchorCache}. */
export interface AnchorCacheDeps extends FetchWebAuthConfigDeps {
  /** The anchor's home domain, e.g. `testanchor.stellar.org`. */
  homeDomain: string;
  /** Background refresh interval, default 10 minutes. 0 disables refresh. */
  refreshIntervalMs?: number;
  /** Structured event sink (refresh outcomes). */
  log?: (line: string) => void;
}

/** Default background refresh interval: 10 minutes. */
export const DEFAULT_ANCHOR_REFRESH_MS = 10 * 60 * 1000;

/**
 * Startup-resolved, background-refreshed {@link AnchorInfo}.
 *
 * `start()` performs the initial resolution and throws on failure (fail
 * fast). After a successful start, `get()` is synchronous and always
 * returns the most recent good configuration: a failed background refresh
 * logs and keeps the previous value, so a transient anchor outage never
 * takes down live sessions that could still complete.
 */
export class AnchorCache {
  readonly #deps: AnchorCacheDeps;
  #info: AnchorInfo | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: AnchorCacheDeps) {
    this.#deps = deps;
  }

  /** Resolve once, fail fast, then begin background refresh. */
  async start(): Promise<AnchorInfo> {
    this.#info = await this.#resolve();
    const interval = this.#deps.refreshIntervalMs ?? DEFAULT_ANCHOR_REFRESH_MS;
    if (interval > 0) {
      this.#timer = setInterval(() => {
        void this.#refresh();
      }, interval);
      // A refresh timer must never hold the process open on its own.
      this.#timer.unref?.();
    }
    return this.#info;
  }

  /** The current anchor configuration. Throws before a successful start. */
  get(): AnchorInfo {
    if (this.#info === undefined) {
      throw new ConfigError('AnchorCache.get() called before start() succeeded.');
    }
    return this.#info;
  }

  /** Stop background refresh. */
  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #refresh(): Promise<void> {
    try {
      this.#info = await this.#resolve();
      this.#deps.log?.('anchorCache event=refresh outcome=ok');
    } catch (err) {
      const code = (err as { code?: string })?.code ?? 'unknown';
      this.#deps.log?.(`anchorCache event=refresh outcome=failed code=${code}`);
    }
  }

  async #resolve(): Promise<AnchorInfo> {
    // One toml fetch serves both extractions: the resolver seam is invoked
    // directly so TRANSFER_SERVER can be read from the same document the
    // auth config was validated from.
    const { homeDomain, resolveToml, timeoutMs } = this.#deps;
    if (resolveToml !== undefined) {
      const toml = (await resolveToml(homeDomain, {
        timeout: timeoutMs ?? 0,
      })) as TransferTomlFields;
      return {
        auth: buildWebAuthConfig(toml, homeDomain),
        transferServer: validateTransferServer(toml, homeDomain),
      };
    }
    // Default path: reuse fetchWebAuthConfig (SDK resolver, HTTPS pinned),
    // then fetch the toml once more is avoided by resolving via the same
    // helper with an injected resolver in tests; in production the SDK
    // resolver caches nothing, so the two-field read happens in one fetch
    // through fetchWebAuthConfig's own resolver plus this direct read.
    const { StellarToml } = await import('@stellar/stellar-sdk');
    const toml = (await StellarToml.Resolver.resolve(homeDomain, {
      timeout: timeoutMs,
    })) as TransferTomlFields;
    const auth = await fetchWebAuthConfig(homeDomain, {
      resolveToml: async () => toml,
      timeoutMs,
    });
    return { auth, transferServer: validateTransferServer(toml, homeDomain) };
  }
}

/** Validate `TRANSFER_SERVER`: present, a URL, and https. */
function validateTransferServer(toml: TransferTomlFields, homeDomain: string): string {
  const raw = toml.TRANSFER_SERVER;
  if (typeof raw !== 'string' || raw === '') {
    throw new ConfigError(
      `stellar.toml for ${homeDomain} declares no TRANSFER_SERVER; the anchor does not offer SEP-6.`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      `TRANSFER_SERVER in stellar.toml for ${homeDomain} is not a valid URL: ${JSON.stringify(raw)}.`,
    );
  }
  if (url.protocol !== 'https:') {
    throw new ConfigError(
      `TRANSFER_SERVER for ${homeDomain} must be https (got ${JSON.stringify(raw)}).`,
    );
  }
  return raw.replace(/\/$/, '');
}
