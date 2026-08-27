/**
 * The gateway seam: the two functions a commercial USSD gateway
 * integration implements.
 *
 * Everything above this seam (session store, menu machine, journey) is
 * gateway-agnostic. Adding a second gateway is one new file implementing
 * {@link GatewayAdapter} plus a configuration switch; nothing else changes.
 * The reference implementation is {@link AfricasTalkingGateway}.
 */

/**
 * One normalized USSD step, parsed from a gateway callback.
 *
 * Gateways deliver the user's inputs differently (Africa's Talking sends
 * the whole session history joined with `*`); the adapter normalizes to an
 * ordered array so the machine never sees gateway syntax.
 */
export interface GatewayStep {
  /** Gateway session identifier, constant across the session's callbacks. */
  sessionId: string;
  /**
   * The subscriber's number exactly as the gateway delivered it. May be
   * E.164 or national format; normalization is the session layer's job
   * (see `inferE164`), never the gateway adapter's.
   */
  msisdnRaw: string;
  /** Mobile network code, when the gateway supplies one. */
  networkCode?: string;
  /** The service code dialed, when the gateway supplies it. */
  serviceCode?: string;
  /**
   * The user's inputs so far, oldest first. Empty on the initial dial.
   * Each element is one response the user typed to one screen.
   */
  inputs: string[];
  /**
   * The gateway's own cumulative text field, verbatim, for idempotency
   * keying. Never logged or stored raw once a PIN may be present; the
   * session layer masks PIN positions before persistence.
   */
  rawText: string;
}

/** What the session layer asks the gateway to render. */
export interface Screen {
  /** `con` keeps the session open for input; `end` closes it. */
  kind: 'con' | 'end';
  /** Screen text, without any gateway prefix. */
  text: string;
  /**
   * Short state label for the gateway's step-tracking channel (Africa's
   * Talking: the `at-ussd-hop-metadata` response header). State names
   * only; never data, never anything sensitive.
   */
  hop?: string;
}

/** A rendered gateway response, ready for the HTTP layer to write. */
export interface GatewayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The raw material of a gateway callback, as the HTTP layer received it. */
export interface GatewayRequest {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * A commercial USSD gateway integration: parse a callback into a
 * {@link GatewayStep}, render a {@link Screen} into the gateway's response
 * grammar. Implementations must be stateless; all session state lives in
 * the session store.
 */
export interface GatewayAdapter {
  /** Stable lowercase identifier, used in configuration. */
  readonly name: string;
  /**
   * Parse one callback.
   *
   * @throws GatewayRequestError when a required field is missing or the
   *   body is not decodable in this gateway's format.
   */
  parseStep(req: GatewayRequest): GatewayStep;
  /** Render a screen in this gateway's response grammar. */
  renderResponse(screen: Screen): GatewayResponse;
}
