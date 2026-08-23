/**
 * Typed error hierarchy for the adapter.
 *
 * Every failure a caller is expected to handle programmatically is a subclass
 * of {@link AdapterError} with a stable machine-readable `code`. Callers (for
 * example a USSD session layer) should branch on `code` or on the class, never
 * on message text — messages are for humans and may change between versions.
 */

/** Base class for all errors thrown by this library. */
export class AdapterError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * The supplied MSISDN is not valid canonical E.164.
 *
 * The library boundary is strict: it accepts only `+<country code><number>`
 * (8–15 digits, no leading zero after the `+`). Commercial USSD gateways
 * commonly deliver MSISDNs in national format without a leading `+`;
 * converting national format to E.164 requires knowing the country, and
 * **country-code inference is the caller's responsibility** — typically the
 * session layer, which knows which network the session arrived from. This
 * library does not guess country codes.
 */
export class InvalidMsisdnError extends AdapterError {
  /** The raw input as received, before normalization. */
  readonly rawInput: string;

  constructor(rawInput: string) {
    super(
      'INVALID_MSISDN',
      `MSISDN is not canonical E.164: ${JSON.stringify(rawInput)}. ` +
        'Expected "+" followed by 8-15 digits (e.g. "+971501234567"). ' +
        'If your input is in national format, convert it to E.164 first: ' +
        "country-code inference is the caller's responsibility — this " +
        'library does not guess country codes.',
    );
    this.rawInput = rawInput;
  }
}

/**
 * The account exists but holds no trustline to the required asset, so it
 * cannot receive or hold that asset yet.
 *
 * Thrown both by the preflight check ({@link assertTrustline}) and by the
 * submission-result decoder when Horizon reports `op_no_trust`, so callers
 * handle one error type regardless of where the condition surfaced.
 */
export class TrustlineMissingError extends AdapterError {
  readonly accountId: string;
  readonly assetCode: string;
  readonly assetIssuer: string;

  constructor(accountId: string, assetCode: string, assetIssuer: string) {
    super(
      'TRUSTLINE_MISSING',
      `Account ${accountId} has no trustline to ${assetCode}:${assetIssuer}.`,
    );
    this.accountId = accountId;
    this.assetCode = assetCode;
    this.assetIssuer = assetIssuer;
  }
}

/**
 * The requested account does not exist on the network.
 *
 * Thrown whenever the adapter loads an account from Horizon and Horizon
 * answers 404. This covers both the user account (for example a trustline
 * preflight on an MSISDN whose account was never created) and the sponsor
 * account (a misconfigured `SPONSOR_PUBLIC_KEY`); `accountId` tells the
 * caller which one was missing. Other Horizon failures are not translated
 * to this error and keep their existing handling.
 */
export class AccountNotFoundError extends AdapterError {
  readonly accountId: string;

  constructor(accountId: string) {
    super('ACCOUNT_NOT_FOUND', `Account ${accountId} does not exist on the network.`);
    this.accountId = accountId;
  }
}

/** The configured {@link Signer} cannot sign for the requested account. */
export class SignerUnavailableError extends AdapterError {
  readonly accountId: string;

  constructor(accountId: string) {
    super(
      'SIGNER_UNAVAILABLE',
      `The configured signer cannot sign for account ${accountId}.`,
    );
    this.accountId = accountId;
  }
}

/**
 * A transaction was submitted and rejected by the network.
 *
 * Carries the Horizon result codes verbatim so a caller (or a human reading
 * logs) can see exactly what the network said.
 */
export class TransactionFailedError extends AdapterError {
  /** Transaction-level result code, e.g. `tx_failed`, `tx_bad_auth`. */
  readonly transactionResultCode?: string;
  /** Per-operation result codes in operation order, e.g. `["op_success", "op_no_trust"]`. */
  readonly operationResultCodes?: string[];

  constructor(
    message: string,
    transactionResultCode?: string,
    operationResultCodes?: string[],
  ) {
    super('TRANSACTION_FAILED', message);
    this.transactionResultCode = transactionResultCode;
    this.operationResultCodes = operationResultCodes;
  }
}

/**
 * The account was created on-chain but recording the MSISDN mapping in the
 * {@link AccountStore} failed afterwards.
 *
 * This is the reconciliation case: the account exists with sponsored
 * reserves locked, and no mapping points at it, so a retry for the same
 * MSISDN would create a second account. The error carries everything an
 * operator needs to reconcile (`accountId`, `msisdn`, and the underlying
 * `cause`) instead of losing the account ID to a stack trace.
 */
export class RegistrationFailedError extends AdapterError {
  /** The account that now exists on-chain without a mapping. */
  readonly accountId: string;
  /** The canonical E.164 MSISDN the account was created for. */
  readonly msisdn: string;
  /** The store error that caused the failure. */
  override readonly cause: unknown;

  constructor(accountId: string, msisdn: string, cause: unknown) {
    super(
      'REGISTRATION_FAILED',
      `Account ${accountId} was created on-chain with sponsored reserves for ` +
        `${msisdn}, but recording the MSISDN mapping failed. The account exists ` +
        'and requires operator reconciliation: record the mapping manually or ' +
        'reclaim the sponsorship. Underlying cause: ' +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.accountId = accountId;
    this.msisdn = msisdn;
    this.cause = cause;
  }
}

/** Required configuration is missing or inconsistent. */
export class ConfigError extends AdapterError {
  constructor(message: string) {
    super('CONFIG_INVALID', message);
  }
}

/**
 * Names for every check the SEP-10 challenge verification can fail.
 *
 * These names are a stable public contract: callers (for example the Week 3
 * session layer) branch on {@link ChallengeValidationError.failedCheck}, so
 * a name, once shipped, is never renamed or removed. The complete list with
 * meanings is documented in the integration guide's SEP-10 section.
 */
export type ChallengeFailedCheck =
  | 'deserialization'
  | 'sequence_not_zero'
  | 'source_not_server'
  | 'no_operations'
  | 'first_op_source_missing'
  | 'first_op_not_manage_data'
  | 'home_domain_mismatch'
  | 'timebounds_missing'
  | 'timebounds_expired'
  | 'timebounds_unbounded'
  | 'timebounds_window_too_wide'
  | 'nonce_invalid'
  | 'extra_op_invalid'
  | 'web_auth_domain_mismatch'
  | 'server_signature_invalid'
  | 'network_passphrase_mismatch'
  | 'client_account_mismatch'
  | 'unexpected_memo'
  | 'unexpected_client_domain'
  | 'sdk_validation';

/**
 * A SEP-10 challenge transaction failed verification and was refused before
 * signing (or, for `network_passphrase_mismatch`, before parsing).
 *
 * The adapter never signs a challenge that fails any check. `failedCheck`
 * names the first check that failed (see {@link ChallengeFailedCheck});
 * branch on it or on `code`, never on message text.
 */
export class ChallengeValidationError extends AdapterError {
  /** The first verification check that failed. Stable contract. */
  readonly failedCheck: ChallengeFailedCheck;

  constructor(failedCheck: ChallengeFailedCheck, message: string) {
    super('CHALLENGE_INVALID', `Challenge refused (${failedCheck}): ${message}`);
    this.failedCheck = failedCheck;
  }
}

/**
 * An HTTP exchange with the anchor's SEP-10 web auth endpoint failed: the
 * anchor answered with a non-success status, or with a body the adapter
 * could not use. Carries the HTTP status and the anchor's `error` string
 * verbatim (when one was provided) so logs show exactly what the anchor
 * said.
 */
export class WebAuthRequestFailedError extends AdapterError {
  /** Which leg of the flow failed. */
  readonly phase: 'challenge' | 'token';
  /** HTTP status the anchor answered with. */
  readonly httpStatus: number;
  /** The anchor's `error` field, verbatim, when the body carried one. */
  readonly anchorError?: string;

  constructor(
    phase: 'challenge' | 'token',
    httpStatus: number,
    message: string,
    anchorError?: string,
  ) {
    super(
      'WEB_AUTH_REQUEST_FAILED',
      `SEP-10 ${phase} request failed (HTTP ${httpStatus}): ${message}` +
        (anchorError ? ` Anchor said: ${JSON.stringify(anchorError)}` : ''),
    );
    this.phase = phase;
    this.httpStatus = httpStatus;
    this.anchorError = anchorError;
  }
}

/**
 * The decoded JWT's claims do not scope the token to the expected account,
 * or the token is expired.
 *
 * SEP-10 scopes a session through claims: `sub` binds the token to one
 * account (plain `G...`, or `G...:memo`, where only the account part is
 * compared), and `iat`/`exp` bound the session window. The adapter holds no
 * token state (session custody belongs to the caller), so this error is how
 * a scope violation surfaces, both from the adapter's own post-issuance
 * check and from the pure `assertTokenScope` helper callers run before each
 * use of a stored token.
 */
export class TokenScopeError extends AdapterError {
  /** The account the token was expected to be scoped to. */
  readonly accountId: string;
  /** The `sub` claim as received, if any. */
  readonly sub?: string;

  constructor(accountId: string, message: string, sub?: string) {
    super('TOKEN_SCOPE_MISMATCH', message);
    this.accountId = accountId;
    this.sub = sub;
  }
}

/**
 * Shape of the `result_codes` extras block Horizon attaches to a rejected
 * transaction submission.
 */
interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

/**
 * Translate a failed Horizon submission into a typed error.
 *
 * @param err - The error thrown by the Horizon client on submission.
 * @param context - Asset/account context so `op_no_trust` can be reported as
 *   a {@link TrustlineMissingError} with full detail.
 * @returns A typed {@link AdapterError}; never returns the raw Horizon error.
 */
export function decodeSubmissionError(
  err: unknown,
  context?: { accountId: string; assetCode: string; assetIssuer: string },
): AdapterError {
  const codes = extractResultCodes(err);
  if (codes?.operations?.includes('op_no_trust') && context) {
    return new TrustlineMissingError(
      context.accountId,
      context.assetCode,
      context.assetIssuer,
    );
  }
  if (codes) {
    return new TransactionFailedError(
      `Transaction rejected by the network: ` +
        `transaction=${codes.transaction ?? 'unknown'} ` +
        `operations=[${(codes.operations ?? []).join(', ')}]`,
      codes.transaction,
      codes.operations,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new TransactionFailedError(`Transaction submission failed: ${message}`);
}

/**
 * True if the error thrown by a Horizon client call is an HTTP 404 (the
 * account, transaction, or ledger does not exist). Checks the SDK's
 * `NotFoundError` shape (`response.status`) and a plain `status` field so
 * both `Horizon.Server` and lightweight adopter clients are recognized.
 */
export function isHorizonNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { response?: { status?: number }; status?: number; name?: string };
  return e.response?.status === 404 || e.status === 404 || e.name === 'NotFoundError';
}

/** Pull Horizon `result_codes` out of an SDK submission error, if present. */
function extractResultCodes(err: unknown): HorizonResultCodes | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const response = (err as { response?: { data?: { extras?: { result_codes?: HorizonResultCodes } } } }).response;
  return response?.data?.extras?.result_codes;
}
