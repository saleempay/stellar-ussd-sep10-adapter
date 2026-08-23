/**
 * The menu state machine: one gateway callback in, one screen out.
 *
 * ## The journey and the 10 second budget
 *
 * The gateway expects a response within 10 seconds, so each callback does
 * at most one expensive thing:
 *
 * - `welcome` input `1`: store-only lookup (no network).
 * - `accountPrompt` input `1`: on-chain sponsored account creation (one
 *   Horizon submission, roughly one ledger close).
 * - `pinEnter` correct PIN: the signing claim, SEP-10 authentication (two
 *   HTTP legs plus one local signature), and the SEP-6 deposit call, all
 *   at session layer timeouts (2.5 seconds per leg).
 *
 * Everything else is process-local. The anchor's toml never costs a
 * callback: it is pre-fetched at startup (see `anchorCache`).
 *
 * ## Account creation gating
 *
 * Per the approved design, on-chain account creation happens only after
 * PIN establishment. This reference gates it behind PIN establishment;
 * production deployments gate it behind their own onboarding policy.
 *
 * ## PIN handling
 *
 * PIN digits flow from `step.inputs` into the PIN policy functions and
 * nowhere else. Every processed input consumed by a PIN state lands in
 * the session's `maskedHistory` as `####`; the raw gateway text is never
 * persisted. Log lines carry state names and error codes only.
 *
 * ## Replay
 *
 * A callback whose cumulative inputs do not extend the session's
 * processed count is a duplicate or replay. If the session's signing
 * claim is spent it gets the replay screen; otherwise it gets a harmless
 * re-prompt of the current state. The signing claim itself is atomic in
 * the session store, so even two simultaneous first-time callbacks cannot
 * both trigger signing.
 */

import {
  ChallengeValidationError,
  PinLockedError,
  PinRejectedError,
  SignerUnavailableError,
  TokenScopeError,
  TrustlineMissingError,
  WebAuthRequestFailedError,
} from '../../errors.js';
import type { Sep10JwtClaims } from '../../auth/token.js';
import type { GatewayStep, Screen } from '../gateway/types.js';
import { inferE164, type MsisdnInferenceConfig } from '../msisdn.js';
import { establishPin, hasPin, isWellFormedPin, verifyPinAttempt } from '../pin/policy.js';
import type { PinStore } from '../pin/types.js';
import type { MenuState, SessionStore, UssdSession } from '../session/types.js';
import { SCREENS } from './screens.js';

/**
 * The expensive operations the machine composes, implemented by
 * `journey.ts` against the real resolver, accounts, auth, and SEP-6
 * modules, and by stubs in the simulated gateway tests.
 */
export interface JourneySeam {
  /** Store-only MSISDN lookup. Never touches the network. */
  lookupAccount(msisdn: string): Promise<string | undefined>;
  /**
   * Trustline preflight for accounts that were NOT created this session
   * (a created account carries its trustline by construction). Runs in
   * the welcome callback, the only network-free callback on the returning
   * user path, so the check gets its own budget instead of adding a
   * fourth leg to the final callback.
   *
   * @throws TrustlineMissingError when the trustline is absent.
   */
  checkTrustline(accountId: string): Promise<void>;
  /** Sponsored on-chain account creation for an unmapped MSISDN. */
  createAccount(msisdn: string): Promise<{ accountId: string; creationTxHash?: string }>;
  /**
   * SEP-10 authenticate through the signer seam, then the SEP-6 deposit,
   * at session layer timeouts. Returns the anchor JWT (custodied in the
   * session record), its claims, and the deposit reference for the END
   * screen.
   */
  authenticateAndDeposit(
    accountId: string,
  ): Promise<{ token: string; claims: Sep10JwtClaims; depositRef: string }>;
}

/** Dependencies for {@link handleStep}. */
export interface MachineDeps {
  sessions: SessionStore;
  pins: PinStore;
  journey: JourneySeam;
  msisdn: MsisdnInferenceConfig;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Structured event sink: state names, error codes, failedCheck names.
   * NEVER user input. The no plaintext PIN test sweeps this output.
   */
  log?: (line: string) => void;
}

/** Mask used for PIN positions in persisted history. */
const PIN_MASK = '####';

/** States whose input is a PIN and must be masked. */
const PIN_STATES: ReadonlySet<MenuState> = new Set(['pinSetup1', 'pinSetup2', 'pinEnter']);

/**
 * Process one gateway callback and produce the screen to render.
 *
 * This function owns session lifecycle (create on dial, expire on TTL),
 * state transitions, and journey error mapping. It does not render
 * gateway syntax (the gateway adapter does) and does not know about HTTP.
 */
export async function handleStep(deps: MachineDeps, step: GatewayStep): Promise<Screen> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? (() => undefined);

  let session = await deps.sessions.get(step.sessionId, now);

  // Initial dial: create the session. A duplicate dial callback for a live
  // session re-renders the welcome screen without touching state.
  if (step.inputs.length === 0) {
    if (session === undefined) {
      session = {
        sessionId: step.sessionId,
        msisdn: inferE164(step.msisdnRaw, deps.msisdn),
        state: 'welcome',
        processedInputs: 0,
        maskedHistory: [],
        pinVerified: false,
        signingClaimed: false,
        createdAt: now,
        lastSeenAt: now,
      };
      await deps.sessions.put(session);
      log(`session=${step.sessionId} event=start state=welcome`);
    }
    return SCREENS.welcome();
  }

  // Inputs but no live session: expired mid-flow or unknown.
  if (session === undefined) {
    log(`session=${step.sessionId} event=expired`);
    return SCREENS.endTimeout();
  }

  // Duplicate or replayed callback: does not extend the processed count.
  if (step.inputs.length <= session.processedInputs) {
    if (session.signingClaimed || session.state === 'done') {
      log(`session=${step.sessionId} event=replay state=${session.state}`);
      return SCREENS.endReplay();
    }
    log(`session=${step.sessionId} event=duplicate state=${session.state}`);
    return promptFor(session.state);
  }

  const input = step.inputs[step.inputs.length - 1] ?? '';
  const stateBefore = session.state;
  const screen = await transition(deps, session, step, input, now, log);

  session.processedInputs = step.inputs.length;
  session.maskedHistory.push(PIN_STATES.has(stateBefore) ? PIN_MASK : input);
  session.lastSeenAt = now;
  if (screen.kind === 'end') {
    session.state = 'done';
    // The JWT dies with the journey: nothing after an END screen may use it.
    delete session.token;
    delete session.claims;
  }
  await deps.sessions.put(session);
  log(`session=${step.sessionId} event=step state=${stateBefore}>${session.state}`);
  return screen;
}

/** The per-state transition logic. Mutates `session` fields; caller persists. */
async function transition(
  deps: MachineDeps,
  session: UssdSession,
  step: GatewayStep,
  input: string,
  now: number,
  log: (line: string) => void,
): Promise<Screen> {
  switch (session.state) {
    case 'welcome': {
      if (input === '1') {
        session.accountId = await deps.journey.lookupAccount(session.msisdn);
        if (session.accountId !== undefined) {
          // Returning user: trustline preflight on this callback's budget
          // (SOW error handling for a missing trustline).
          try {
            await deps.journey.checkTrustline(session.accountId);
          } catch (err) {
            if (err instanceof TrustlineMissingError) {
              log(`session=${session.sessionId} event=noTrustline`);
              return SCREENS.endNoTrustline();
            }
            const code = (err as { code?: string })?.code ?? 'unknown';
            log(`session=${session.sessionId} event=trustlineCheckFailed code=${code}`);
            return SCREENS.endServiceDown();
          }
        }
        if (await hasPin({ store: deps.pins }, session.msisdn)) {
          session.state = 'pinEnter';
          return SCREENS.pinEnter();
        }
        session.state = 'pinSetup1';
        return SCREENS.pinSetup1();
      }
      if (input === '2') {
        return SCREENS.endInfo();
      }
      return SCREENS.invalidChoice(SCREENS.welcome());
    }

    case 'pinSetup1': {
      if (!isWellFormedPin(input)) {
        return SCREENS.pinSetupBadFormat();
      }
      session.state = 'pinSetup2';
      return SCREENS.pinSetup2();
    }

    case 'pinSetup2': {
      // The first entry is re-delivered in the cumulative input list, so
      // no PIN is ever stored between the two setup callbacks.
      const first = step.inputs[step.inputs.length - 2];
      if (first === undefined || input !== first || !isWellFormedPin(input)) {
        session.state = 'pinSetup1';
        return SCREENS.pinSetupMismatch();
      }
      await establishPin({ store: deps.pins, now: () => now }, session.msisdn, input);
      session.state = 'accountPrompt';
      return SCREENS.accountPrompt();
    }

    case 'accountPrompt': {
      if (input !== '1') {
        return SCREENS.invalidChoice(SCREENS.accountPrompt());
      }
      if (session.accountId === undefined) {
        try {
          const created = await deps.journey.createAccount(session.msisdn);
          session.accountId = created.accountId;
          log(
            `session=${session.sessionId} event=accountCreated tx=${created.creationTxHash ?? 'none'}`,
          );
        } catch (err) {
          return mapJourneyError(session.sessionId, 'create', err, log);
        }
      }
      session.state = 'pinEnter';
      return SCREENS.accountReady();
    }

    case 'pinEnter': {
      if (!isWellFormedPin(input)) {
        return SCREENS.pinEnterBadFormat();
      }
      try {
        await verifyPinAttempt({ store: deps.pins, now: () => now }, session.msisdn, input);
      } catch (err) {
        if (err instanceof PinRejectedError) {
          log(`session=${session.sessionId} event=pinRejected left=${err.attemptsLeft}`);
          return SCREENS.pinWrong(err.attemptsLeft);
        }
        if (err instanceof PinLockedError) {
          log(`session=${session.sessionId} event=pinLocked`);
          return SCREENS.endLocked();
        }
        throw err;
      }
      session.pinVerified = true;

      // Divergence path: PIN exists but the account mapping does not.
      if (session.accountId === undefined) {
        session.state = 'accountPrompt';
        return SCREENS.accountPrompt();
      }

      // The single use signing claim, atomic in the store.
      const claim = await deps.sessions.claimSigning(session.sessionId, now);
      if (claim === 'missing') {
        return SCREENS.endTimeout();
      }
      if (claim === 'already_claimed') {
        log(`session=${session.sessionId} event=replayRejected`);
        return SCREENS.endReplay();
      }
      session.signingClaimed = true;

      try {
        const result = await deps.journey.authenticateAndDeposit(session.accountId);
        session.token = result.token;
        session.claims = result.claims;
        log(`session=${session.sessionId} event=journeyComplete`);
        return SCREENS.endConfirm(session.accountId, result.depositRef);
      } catch (err) {
        return mapJourneyError(session.sessionId, 'journey', err, log);
      }
    }

    case 'done': {
      log(`session=${session.sessionId} event=replay state=done`);
      return SCREENS.endReplay();
    }
  }
}

/** The prompt screen for a state, for harmless duplicate re-prompts. */
function promptFor(state: MenuState): Screen {
  switch (state) {
    case 'welcome':
      return SCREENS.welcome();
    case 'pinSetup1':
      return SCREENS.pinSetup1();
    case 'pinSetup2':
      return SCREENS.pinSetup2();
    case 'accountPrompt':
      return SCREENS.accountPrompt();
    case 'pinEnter':
      return SCREENS.pinEnter();
    case 'done':
      return SCREENS.endReplay();
  }
}

/**
 * Map a journey failure to its END screen. Every one of the 20 stable
 * failedCheck names maps to the same refusal screen: none of them is
 * actionable by the user, so the name goes to the structured log and the
 * user sees plain language. The error taxonomy below the screen stays
 * fully typed for programmatic callers.
 */
function mapJourneyError(
  sessionId: string,
  phase: 'create' | 'journey',
  err: unknown,
  log: (line: string) => void,
): Screen {
  if (err instanceof ChallengeValidationError) {
    log(`session=${sessionId} event=authRefused failedCheck=${err.failedCheck}`);
    return SCREENS.endAuthRefused();
  }
  if (err instanceof TokenScopeError) {
    log(`session=${sessionId} event=authRefused code=${err.code}`);
    return SCREENS.endAuthRefused();
  }
  if (err instanceof WebAuthRequestFailedError) {
    log(
      `session=${sessionId} event=anchorDown phase=${err.phase} timedOut=${String(err.timedOut)}`,
    );
    return SCREENS.endAnchorDown();
  }
  if (err instanceof TrustlineMissingError) {
    log(`session=${sessionId} event=noTrustline`);
    return SCREENS.endNoTrustline();
  }
  if (err instanceof SignerUnavailableError) {
    log(`session=${sessionId} event=signerDown`);
    return SCREENS.endSignerDown();
  }
  const code = (err as { code?: string })?.code ?? 'unknown';
  log(`session=${sessionId} event=${phase}Failed code=${code}`);
  return phase === 'create' ? SCREENS.endAccountFailed() : SCREENS.endServiceDown();
}
