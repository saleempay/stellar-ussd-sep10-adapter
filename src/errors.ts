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

/** Required configuration is missing or inconsistent. */
export class ConfigError extends AdapterError {
  constructor(message: string) {
    super('CONFIG_INVALID', message);
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

/** Pull Horizon `result_codes` out of an SDK submission error, if present. */
function extractResultCodes(err: unknown): HorizonResultCodes | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const response = (err as { response?: { data?: { extras?: { result_codes?: HorizonResultCodes } } } }).response;
  return response?.data?.extras?.result_codes;
}
