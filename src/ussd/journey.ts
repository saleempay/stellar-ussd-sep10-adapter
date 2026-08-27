/**
 * The real {@link JourneySeam}: composes the Week 1 resolver and accounts
 * modules and the Week 2 auth module, unchanged, into the three expensive
 * operations the menu machine schedules across callbacks.
 *
 * ## Session layer timeouts
 *
 * The library default of 10 seconds per network leg is correct for
 * standalone use but wrong inside a USSD callback: the gateway expects
 * the WHOLE response within 10 seconds. The journey therefore passes
 * {@link SESSION_LEG_TIMEOUT_MS} (2.5 seconds) through the auth module's
 * existing `timeoutMs` seam and applies the same bound to the SEP-6 leg,
 * so the final callback's worst case (challenge, token, deposit) stays
 * inside the handler watchdog.
 *
 * ## JWT custody
 *
 * `authenticateAndDeposit` receives the token from `authenticate`, runs
 * `assertTokenScope` immediately before the one use it makes of it (the
 * settled per-use check), sends the deposit request, and returns the
 * token to the machine, which custodies it in the session record for the
 * remainder of the session. The auth module stores nothing.
 */

import { AnchorOperationFailedError } from '../errors.js';
import { assertTrustline } from '../accounts/trustline.js';
import type { HorizonLike } from '../accounts/horizon.js';
import { authenticate } from '../auth/authenticate.js';
import { assertTokenScope } from '../auth/token.js';
import { fetchWithTimeout, isTimeoutError } from '../auth/timeout.js';
import { resolveOrCreateAccount } from '../index.js';
import type { AccountStore } from '../resolver/types.js';
import type { Signer } from '../signer/types.js';
import type { AnchorInfo } from './anchorCache.js';
import type { JourneySeam } from './menu/machine.js';

/** Per-leg network timeout inside a USSD callback: 2.5 seconds. */
export const SESSION_LEG_TIMEOUT_MS = 2_500;

/** Dependencies for {@link createJourney}. */
export interface JourneyDeps {
  store: AccountStore;
  signer: Signer;
  horizon: HorizonLike;
  /** Current anchor coordinates; a function so cache refreshes are seen. */
  anchor: () => AnchorInfo;
  networkPassphrase: string;
  sponsorPublicKey: string;
  /** Asset for account creation trustlines and the SEP-6 deposit. */
  asset: { code: string; issuer: string };
  /** Injectable transport, defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Per-leg timeout override; default {@link SESSION_LEG_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Build the production {@link JourneySeam}. */
export function createJourney(deps: JourneyDeps): JourneySeam {
  const timeoutMs = deps.timeoutMs ?? SESSION_LEG_TIMEOUT_MS;
  const fetchFn = deps.fetchFn ?? fetch;

  return {
    async lookupAccount(msisdn) {
      return deps.store.get(msisdn);
    },

    async createAccount(msisdn) {
      const resolved = await resolveOrCreateAccount(
        {
          store: deps.store,
          signer: deps.signer,
          horizon: deps.horizon,
          networkPassphrase: deps.networkPassphrase,
          sponsorPublicKey: deps.sponsorPublicKey,
          asset: deps.asset,
        },
        msisdn,
      );
      return { accountId: resolved.accountId, creationTxHash: resolved.creationTxHash };
    },

    async checkTrustline(accountId) {
      await assertTrustline(deps.horizon, accountId, {
        code: deps.asset.code,
        issuer: deps.asset.issuer,
      });
    },

    async authenticateAndDeposit(accountId) {
      const anchor = deps.anchor();
      const { token, claims } = await authenticate(
        {
          signer: deps.signer,
          networkPassphrase: deps.networkPassphrase,
          anchor: anchor.auth,
          fetchFn,
          timeoutMs,
        },
        accountId,
      );

      // The settled per-use check: the token is re-scoped immediately
      // before the one authenticated call this journey makes.
      assertTokenScope(claims, accountId);

      const depositRef = await initiateSep6Deposit({
        transferServer: anchor.transferServer,
        assetCode: deps.asset.code,
        accountId,
        token,
        fetchFn,
        timeoutMs,
      });
      return { token, claims, depositRef };
    },
  };
}

/** Parameters for {@link initiateSep6Deposit}. */
interface Sep6DepositParams {
  transferServer: string;
  assetCode: string;
  accountId: string;
  token: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
}

/**
 * The anchor operation completing the SOW journey: an authenticated SEP-6
 * deposit initiation. testanchor.stellar.org reports SRT deposit with
 * `authentication_required: true` and answers 403 without a bearer token,
 * so a 200 with a transaction id is positive proof the JWT worked. No
 * funds move.
 *
 * @returns The deposit reference shown on the END screen: the first 8
 *   characters of the anchor's transaction id (the full id goes to
 *   evidence, not to a 160 character screen).
 * @throws AnchorOperationFailedError on any non-2xx response or timeout.
 */
async function initiateSep6Deposit(params: Sep6DepositParams): Promise<string> {
  const url = new URL(`${params.transferServer}/deposit`);
  url.searchParams.set('asset_code', params.assetCode);
  url.searchParams.set('account', params.accountId);
  url.searchParams.set('type', 'bank_account');

  let response: Response;
  try {
    response = await fetchWithTimeout(
      params.fetchFn,
      url.toString(),
      { method: 'GET', headers: { authorization: `Bearer ${params.token}` } },
      params.timeoutMs,
    );
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new AnchorOperationFailedError('deposit', 0, 'Request timed out.', true);
    }
    throw new AnchorOperationFailedError('deposit', 0, describeCause(err), false);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new AnchorOperationFailedError('deposit', response.status, truncate(text), false);
  }

  let id: unknown;
  try {
    id = (JSON.parse(text) as { id?: unknown }).id;
  } catch {
    id = undefined;
  }
  if (typeof id !== 'string' || id === '') {
    throw new AnchorOperationFailedError(
      'deposit',
      response.status,
      'Response carried no transaction id.',
      false,
    );
  }
  return id.slice(0, 8);
}

function describeCause(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}
