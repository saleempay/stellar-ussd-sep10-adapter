/**
 * The Week 3 USSD session layer: gateway seam, session store with the
 * atomic single use signing claim, PIN consent, menu state machine, and
 * the journey composing the Weeks 1 and 2 modules unchanged.
 */

export type {
  GatewayAdapter,
  GatewayRequest,
  GatewayResponse,
  GatewayStep,
  Screen,
} from './gateway/types.js';
export { AfricasTalkingGateway, AT_HOP_HEADER } from './gateway/africasTalking.js';
export {
  createUssdRequestListener,
  DEFAULT_WATCHDOG_MS,
  type UssdHttpDeps,
} from './gateway/http.js';
export {
  parseCidrList,
  parseCidr,
  ipInCidrs,
  normalizeIp,
  type ParsedCidr,
} from './gateway/ipAllowlist.js';

export type {
  ClaimOutcome,
  MenuState,
  SessionStore,
  UssdSession,
} from './session/types.js';
export { DEFAULT_SESSION_TTL_MS, InMemorySessionStore } from './session/memoryStore.js';

export type { FailureOutcome, PinRecord, PinStore } from './pin/types.js';
export { InMemoryPinStore } from './pin/memoryStore.js';
export { JsonFilePinStore } from './pin/jsonFileStore.js';
export {
  SCRYPT_PARAMS,
  SCRYPT_MAX_NR,
  SCRYPT_MAX_P,
  hashPin,
  verifyPin,
} from './pin/hash.js';
export {
  PIN_PATTERN,
  PIN_POLICY,
  establishPin,
  hasPin,
  isWeakPin,
  isWellFormedPin,
  verifyPinAttempt,
  type PinPolicyDeps,
} from './pin/policy.js';

export { inferE164, type MsisdnInferenceConfig } from './msisdn.js';

export {
  CHAR_BUDGET,
  SCREENS,
  allScreensAtMaxLength,
  shortAccount,
} from './menu/screens.js';
export { handleStep, type JourneySeam, type MachineDeps } from './menu/machine.js';

export {
  AnchorCache,
  DEFAULT_ANCHOR_REFRESH_MS,
  type AnchorCacheDeps,
  type AnchorInfo,
} from './anchorCache.js';
export { createJourney, SESSION_LEG_TIMEOUT_MS, type JourneyDeps } from './journey.js';
