/**
 * The callback HTTP handler: one POST route, gateway-agnostic.
 *
 * ## Deadline watchdog
 *
 * The gateway expects a response within 10 seconds and terminates the
 * session on silence. The handler races the machine against a watchdog
 * (default 8.5 seconds): if the journey is still in flight when the
 * watchdog fires, the gateway receives a well formed busy END screen
 * instead of a timeout. The in-flight work is NOT cancelled; when it
 * completes, its real response lands in the idempotency cache, and the
 * signing claim it may have spent stays spent, which is exactly the
 * replay safety property doing its job.
 *
 * ## Idempotency
 *
 * The provider documents no retry policy, so the handler defends against
 * duplicate deliveries whatever their cause: the rendered response for
 * each processed step is cached under a key derived from the step's
 * cumulative input, and an identical POST is answered from the cache
 * without re-running anything. The key is a SHA-256 digest, never the
 * raw text: PIN digits must not reach the store even as cache keys.
 *
 * ## Callback authentication (finding 2)
 *
 * The callback body is attacker-controllable: `phoneNumber`, the identity
 * the whole session is scoped to, is a form field, and Africa's Talking
 * does not sign its callbacks. Two layers guard the surface, and both
 * ship:
 *
 * 1. **A required, unguessable callback path.** There is no fixed default;
 *    the listener refuses to start without a `callbackPath`, and the guide
 *    tells deployers to use a long random segment. This is a capability
 *    URL: possession of the path is the credential, so the path must never
 *    be logged or committed.
 * 2. **An optional IP allowlist**, off by default, keyed to CIDR ranges the
 *    deployer configures ({@link UssdHttpDeps.allowedCidrs}). When set, a
 *    request from outside the ranges is refused BEFORE the body is parsed,
 *    so a forged callback never reaches the session logic. The ranges are
 *    deployment-specific (the provider publishes none), so this cannot ship
 *    on by default; the guide assigns it to the deployer for production.
 *
 * Neither layer is a substitute for the other, and the guide names the
 * residual network responsibility explicitly.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ConfigError, GatewayRequestError } from '../../errors.js';
import { handleStep, type MachineDeps } from '../menu/machine.js';
import { SCREENS } from '../menu/screens.js';
import type { SessionStore } from '../session/types.js';
import { ipInCidrs, normalizeIp, type ParsedCidr } from './ipAllowlist.js';
import type { GatewayAdapter, GatewayResponse } from './types.js';

/** Default watchdog: answer busy at 8.5 seconds, inside the gateway's 10. */
export const DEFAULT_WATCHDOG_MS = 8_500;

/** Maximum accepted callback body: far above any real gateway callback. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Shortest callback path the listener will start with. A fixed short path
 * like `/ussd/callback` is guessable and gives the capability-URL layer no
 * strength, so it is refused; deployers use a long random segment.
 */
const MIN_CALLBACK_PATH_LENGTH = 12;

/** Dependencies for {@link createUssdRequestListener}. */
export interface UssdHttpDeps {
  gateway: GatewayAdapter;
  machine: MachineDeps;
  sessions: SessionStore;
  /**
   * Callback route, exact match, e.g. `/ussd/<long-random-segment>`.
   * Required: there is no default, and the listener refuses to start if it
   * is missing or shorter than {@link MIN_CALLBACK_PATH_LENGTH}. Treat it
   * as a secret (a capability URL): never log or commit it.
   */
  callbackPath: string;
  /**
   * Optional IP allowlist, parsed CIDR ranges. Off when empty or omitted.
   * When set, a request whose client IP is outside every range is refused
   * before its body is parsed. Ranges are deployment-specific; the deployer
   * supplies them (see the integration guide).
   */
  allowedCidrs?: readonly ParsedCidr[];
  /** Watchdog override; default {@link DEFAULT_WATCHDOG_MS}. */
  watchdogMs?: number;
  /** Structured event sink. Never receives user input, never the path. */
  log?: (line: string) => void;
}

/**
 * Build a `node:http` request listener for gateway callbacks.
 *
 * The listener is transport only: parsing and rendering belong to the
 * gateway adapter, all session logic to the machine. Mount it on a plain
 * `http.createServer(listener)`; live sandbox testing exposes that server
 * through an ephemeral tunnel whose URL is pasted into the provider
 * dashboard and never committed anywhere.
 */
export function createUssdRequestListener(
  deps: UssdHttpDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  // Refuse to start without an unguessable callback path (finding 2). There
  // is deliberately no default: a fixed path gives the capability-URL layer
  // no strength. The message names no path value.
  const callbackPath = deps.callbackPath;
  if (typeof callbackPath !== 'string' || !callbackPath.startsWith('/')) {
    throw new ConfigError(
      'USSD callback path is required and must start with "/". Set a long ' +
        'random segment (for example /ussd/<32 random chars>); there is no default.',
    );
  }
  if (callbackPath.length < MIN_CALLBACK_PATH_LENGTH) {
    throw new ConfigError(
      `USSD callback path is too short to be unguessable (need at least ` +
        `${MIN_CALLBACK_PATH_LENGTH} characters). Use a long random segment.`,
    );
  }

  const allowedCidrs = deps.allowedCidrs ?? [];
  const watchdogMs = deps.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  const log = deps.log ?? (() => undefined);

  return (req, res) => {
    void handle(req, res).catch((err) => {
      // Last resort: never leave the gateway hanging.
      log(`http event=unhandledError name=${err instanceof Error ? err.name : 'unknown'}`);
      if (!res.headersSent) {
        writeResponse(res, deps.gateway.renderResponse(SCREENS.endServiceDown()));
      } else {
        res.end();
      }
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Layer 2: IP allowlist, refused BEFORE the body is read or parsed, so
    // a forged callback never reaches the session logic. Off when no ranges
    // are configured.
    if (allowedCidrs.length > 0) {
      const clientIp = req.socket.remoteAddress;
      if (!ipInCidrs(clientIp, allowedCidrs)) {
        log(`http event=ipRejected ip=${clientIp === undefined ? 'unknown' : normalizeIp(clientIp)}`);
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('forbidden');
        return;
      }
    }

    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== callbackPath) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('payload too large');
      return;
    }

    let step;
    try {
      step = deps.gateway.parseStep({ headers: req.headers, body });
    } catch (err) {
      if (err instanceof GatewayRequestError) {
        log(`http event=badRequest code=${err.code}`);
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bad request');
        return;
      }
      throw err;
    }

    // Idempotency: an identical POST replays the cached response. The key
    // hashes the cumulative text so PIN digits never appear in the store.
    const stepKey = `${step.inputs.length}:${sha256(step.rawText)}`;
    const cached = await deps.sessions.getResponse(step.sessionId, stepKey);
    if (cached !== undefined) {
      log(`http session=${step.sessionId} event=cacheHit`);
      writeResponse(res, JSON.parse(cached) as GatewayResponse);
      return;
    }

    // Race the machine against the watchdog. The machine promise records
    // its own outcome into the cache even when the watchdog answers first.
    const work = handleStep(deps.machine, step).then((screen) => {
      const rendered = deps.gateway.renderResponse(screen);
      return deps.sessions
        .recordResponse(step.sessionId, stepKey, JSON.stringify(rendered))
        .then(() => rendered);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<GatewayResponse>((resolve) => {
      timer = setTimeout(() => {
        log(`http session=${step.sessionId} event=watchdog ms=${watchdogMs}`);
        resolve(deps.gateway.renderResponse(SCREENS.endBusy()));
      }, watchdogMs);
    });

    try {
      const response = await Promise.race([
        work.catch((err) => {
          log(
            `http session=${step.sessionId} event=machineError code=${(err as { code?: string })?.code ?? 'unknown'}`,
          );
          return deps.gateway.renderResponse(SCREENS.endServiceDown());
        }),
        watchdog,
      ]);
      writeResponse(res, response);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Detach the still running work from this request's error path.
      work.catch(() => undefined);
    }
  }
}

function writeResponse(res: ServerResponse, response: GatewayResponse): void {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('body too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
