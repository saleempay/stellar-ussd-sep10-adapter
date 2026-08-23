import type { ClaimOutcome, SessionStore, UssdSession } from './types.js';

/** Default absolute session TTL: 120 seconds, deliberately conservative. */
export const DEFAULT_SESSION_TTL_MS = 120_000;

/**
 * In-memory reference {@link SessionStore}. **Primary reference store.**
 *
 * Expiry is enforced lazily on access against the absolute TTL, plus a
 * sweep of expired records on every write so an abandoned session cannot
 * linger beyond the next store activity.
 *
 * ## Atomicity of `claimSigning`
 *
 * The method is `async` to satisfy the interface, but its read-check-write
 * runs synchronously before the first `await` point: under Node's single
 * threaded event loop no other callback can interleave between the check
 * and the write, so exactly one caller observes `signingClaimed === false`.
 * This is the property the concurrency unit test hammers. A distributed
 * implementation must provide the same guarantee with a real
 * compare-and-set.
 */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, UssdSession>();
  readonly #responses = new Map<string, Map<string, string>>();
  readonly #ttlMs: number;

  constructor(ttlMs: number = DEFAULT_SESSION_TTL_MS) {
    this.#ttlMs = ttlMs;
  }

  /** The absolute TTL this store enforces. */
  get ttlMs(): number {
    return this.#ttlMs;
  }

  async get(sessionId: string, now: number): Promise<UssdSession | undefined> {
    const session = this.#live(sessionId, now);
    return session === undefined ? undefined : { ...session };
  }

  async put(session: UssdSession): Promise<void> {
    this.#sweep(session.lastSeenAt);
    this.#sessions.set(session.sessionId, { ...session });
  }

  async claimSigning(sessionId: string, now: number): Promise<ClaimOutcome> {
    // Synchronous read-check-write: no await between the read and the
    // mutation, so callers serialize on the event loop.
    const session = this.#live(sessionId, now);
    if (session === undefined) return 'missing';
    if (session.signingClaimed) return 'already_claimed';
    session.signingClaimed = true;
    return 'claimed';
  }

  async recordResponse(sessionId: string, stepKey: string, rendered: string): Promise<void> {
    let cache = this.#responses.get(sessionId);
    if (cache === undefined) {
      cache = new Map();
      this.#responses.set(sessionId, cache);
    }
    cache.set(stepKey, rendered);
  }

  async getResponse(sessionId: string, stepKey: string): Promise<string | undefined> {
    return this.#responses.get(sessionId)?.get(stepKey);
  }

  async delete(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#responses.delete(sessionId);
  }

  /** Number of live records. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#sessions.size;
  }

  #live(sessionId: string, now: number): UssdSession | undefined {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return undefined;
    if (now - session.createdAt >= this.#ttlMs) {
      this.#sessions.delete(sessionId);
      this.#responses.delete(sessionId);
      return undefined;
    }
    return session;
  }

  #sweep(now: number): void {
    for (const [id, session] of this.#sessions) {
      if (now - session.createdAt >= this.#ttlMs) {
        this.#sessions.delete(id);
        this.#responses.delete(id);
      }
    }
  }
}
