/**
 * Africa's Talking reference implementation of the gateway seam.
 *
 * Contract implemented here, from the provider's own documentation
 * (developers.africastalking.com/docs/ussd/overview and
 * /docs/ussd/handle_sessions, fetched 23 Aug 2026):
 *
 * - Callbacks are HTTP POST, `application/x-www-form-urlencoded`, with
 *   fields `sessionId`, `phoneNumber`, `networkCode`, `serviceCode`, and
 *   `text`. `text` is the empty string on the initial dial; afterwards it
 *   is every user input in the session joined with `*`.
 * - The response is `text/plain` beginning with `CON ` (session continues)
 *   or `END ` (final screen). A malformed response or a 40x status makes
 *   the gateway terminate the session.
 * - The optional response header `at-ussd-hop-metadata` (at most 99
 *   characters, no `|`) labels the step and is echoed on the next callback
 *   and shown on the provider dashboard, so it carries state names only.
 * - The application must respond within 10 seconds.
 *
 * Character budget: menu length is telco-dependent (Safaricom KE 160,
 * Airtel KE 184, with automatic pagination beyond that, per the provider's
 * help centre article 1284096). This layer enforces nothing at render time;
 * the screen catalogue is budgeted at authoring time and asserted by unit
 * test against the 160 character Safaricom floor.
 */

import { GatewayRequestError } from '../../errors.js';
import type {
  GatewayAdapter,
  GatewayRequest,
  GatewayResponse,
  GatewayStep,
  Screen,
} from './types.js';

/** Response header used for step tracking. State names only, never data. */
export const AT_HOP_HEADER = 'at-ussd-hop-metadata';

/** Documented cap on the hop header value. */
const HOP_MAX_LENGTH = 99;

/** Africa's Talking {@link GatewayAdapter}. Stateless. */
export class AfricasTalkingGateway implements GatewayAdapter {
  readonly name = 'africastalking';

  parseStep(req: GatewayRequest): GatewayStep {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(req.body);
    } catch (cause) {
      throw new GatewayRequestError(
        `Callback body is not decodable as application/x-www-form-urlencoded: ${String(cause)}`,
      );
    }

    const sessionId = params.get('sessionId');
    if (sessionId === null || sessionId === '') {
      throw new GatewayRequestError('Callback is missing the required sessionId field.');
    }
    const phoneNumber = params.get('phoneNumber');
    if (phoneNumber === null || phoneNumber === '') {
      throw new GatewayRequestError('Callback is missing the required phoneNumber field.');
    }

    // `text` is genuinely absent only on malformed requests; on the initial
    // dial it is present and empty. Treat absent as empty for tolerance:
    // both mean "no inputs yet" and nothing downstream can tell them apart.
    const rawText = params.get('text') ?? '';
    const inputs = rawText === '' ? [] : rawText.split('*');

    return {
      sessionId,
      msisdnRaw: phoneNumber,
      networkCode: params.get('networkCode') ?? undefined,
      serviceCode: params.get('serviceCode') ?? undefined,
      inputs,
      rawText,
    };
  }

  renderResponse(screen: Screen): GatewayResponse {
    const prefix = screen.kind === 'con' ? 'CON ' : 'END ';
    const headers: Record<string, string> = {
      'content-type': 'text/plain; charset=utf-8',
    };
    if (screen.hop !== undefined) {
      headers[AT_HOP_HEADER] = sanitizeHop(screen.hop);
    }
    return { status: 200, headers, body: prefix + screen.text };
  }
}

/** Enforce the documented header constraints: no pipe, at most 99 chars. */
function sanitizeHop(hop: string): string {
  return hop.replaceAll('|', '_').slice(0, HOP_MAX_LENGTH);
}
