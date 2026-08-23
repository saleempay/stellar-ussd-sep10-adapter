/**
 * National-format MSISDN inference for gateway callbacks.
 *
 * The library boundary below this layer is strict E.164 and deliberately
 * does not guess country codes (see `InvalidMsisdnError`). Commercial USSD
 * gateways may deliver the subscriber number in national format (leading
 * zero, no `+`). Per the settled sprint constraint, converting national
 * format to E.164 is THIS layer's job, and it happens before any call
 * touches the resolver.
 *
 * The inference is deliberately simple and explicit: a configured default
 * country calling code, applied only to inputs that look like national
 * format. Numbers already carrying `+` pass through untouched (the
 * resolver's own strict validation still applies). Anything else is
 * refused rather than guessed.
 */

import { InvalidMsisdnError } from '../errors.js';
import { normalizeMsisdn } from '../resolver/resolver.js';

/** Configuration for {@link inferE164}. */
export interface MsisdnInferenceConfig {
  /**
   * Country calling code (digits only, no `+`) applied to national-format
   * inputs, e.g. `"999"` for the documentation convention or `"254"` for a
   * Kenyan deployment. The deployment configures exactly one: a USSD
   * service code is provisioned per country, so the country is a property
   * of the deployment, not of the individual callback.
   */
  defaultCountryCode: string;
}

/**
 * Convert a gateway-delivered subscriber number to canonical E.164.
 *
 * - `+...` input: already international; delegated to the strict
 *   normalizer unchanged.
 * - `0...` input (national format): the leading zero is dropped and the
 *   configured country code is prefixed, then the strict normalizer runs.
 * - Bare digits without `+` or leading zero: refused. Such input is
 *   ambiguous (it may already carry a country code or may not) and this
 *   layer does not guess.
 *
 * @throws InvalidMsisdnError when the input is refused or the result is
 *   not valid E.164.
 */
export function inferE164(raw: string, config: MsisdnInferenceConfig): string {
  const trimmed = raw.replace(/[\s().-]/g, '');

  if (trimmed.startsWith('+')) {
    return normalizeMsisdn(trimmed);
  }

  if (/^0\d+$/.test(trimmed)) {
    return normalizeMsisdn(`+${config.defaultCountryCode}${trimmed.slice(1)}`);
  }

  throw new InvalidMsisdnError(raw);
}
