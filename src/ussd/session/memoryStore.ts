import type { ClaimOutcome, SessionStore, UssdSession } from './types.js';

/** Default absolute session TTL: 120 seconds, deliberately conservative. */
export const DEFAULT_SESSION_TTL_MS = 120_000;

/** Options for {@link InMemorySessionStore}. */
export interface InMemorySessionStoreOptions {
  /**
   * Absolute TTL of one cached response, counted from the moment it is
   * recorded. Default: the session TTL, so a gateway retry can be answered
   * from the cache for as long as its session could have lived. Cached
   * responses are evicted on their own clock, independently of the session
   * they were recorded under, so a response recorded under a session id
   * that was never `put` (a custom step handler, or the timeout screen for
   * an unknown session) cannot outlive this bound.
   */
  responseTtlMs?: number;
  /** Clock for the response cache. Defaults to `Date.now`. */
  now?: () => number;
}

/** One cached response with its own expiry. */
interface CachedResponse {
  rendered: string;
  expiresAt: number;
}

/**
 * In-memory reference {@link SessionStore}. **Primary reference store.**
 *
 * Expiry is enforced lazily on access against the absolute TTL, plus a
 * sweep of expired records on every write so an abandoned session cannot
 * linger beyond the next store activity.
 *
 * ## Response cache expiry
 *
 * Cached responses carry their own timestamp and are swept on their own
 * TTL ({@link InMemorySessionStoreOptions.responseTtlMs}), independently
 * of the session sweep: on every `recordResponse` every expired cached
 * response is dropped, and `getResponse` never returns an expired one.
 * Session paths still drop a session's cache when the session itself
 * expires, is swept or is deleted. The two sweeps are independent because
 * the listener caches a response for every processed callback, including
 * callbacks that never create a session record: the timeout screen for an
 * unknown session id, and every step of a caller supplied step handler
 * that does not use this store's session records. Without an own TTL
 * those entries would live for the life of the process and would answer
 * a later session that happened to reuse the id.
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
  readonly #responses = new Map<string, Map<string, CachedResponse>>();
  readonly #ttlMs: number;
  readonly #responseTtlMs: number;
  readonly #now: () => number;

  constructor(ttlMs: number = DEFAULT_SESSION_TTL_MS, options: InMemorySessionStoreOptions = {}) {
    this.#ttlMs = ttlMs;
    this.#responseTtlMs = options.responseTtlMs ?? ttlMs;
    this.#now = options.now ?? Date.now;
  }

  /** The absolute TTL this store enforces. */
  get ttlMs(): number {
    return this.#ttlMs;
  }

  /** The absolute TTL of one cached response. */
  get responseTtlMs(): number {
    return this.#responseTtlMs;
  }

  async get(sessionId: string, now: number): Promise<UssdSession | undefined> {
    const session = this.#live(sessionId, now);
    return session === undefined ? undefined : { ...session };
  }

  async put(session: UssdSession): Promise<void> {
    this.#sweep(session.lastSeenAt);
    // Monotonic signing latch: once the claim is spent, a put may never
    // clear it back to false. Today every post-claim path ends the session,
    // so a stale pre-claim copy is never written back; this guard keeps the
    // latch safe even if a future non-terminal path did write one, rather
    // than resting the whole replay-safety property on that coupling.
    const existing = this.#sessions.get(session.sessionId);
    const signingClaimed = session.signingClaimed || existing?.signingClaimed === true;
    this.#sessions.set(session.sessionId, { ...session, signingClaimed });
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
    const now = this.#now();
    this.#sweepResponses(now);
    let cache = this.#responses.get(sessionId);
    if (cache === undefined) {
      cache = new Map();
      this.#responses.set(sessionId, cache);
    }
    cache.set(stepKey, { rendered, expiresAt: now + this.#responseTtlMs });
  }

  async getResponse(sessionId: string, stepKey: string): Promise<string | undefined> {
    const cache = this.#responses.get(sessionId);
    const entry = cache?.get(stepKey);
    if (cache === undefined || entry === undefined) return undefined;
    if (this.#now() >= entry.expiresAt) {
      cache.delete(stepKey);
      if (cache.size === 0) this.#responses.delete(sessionId);
      return undefined;
    }
    return entry.rendered;
  }

  async delete(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    this.#responses.delete(sessionId);
  }

  /** Number of live records. Exposed for tests and diagnostics. */
  get size(): number {
    return this.#sessions.size;
  }

  /**
   * Number of cached responses currently held in memory, expired or not.
   * Exposed for tests and diagnostics: this is what the eviction tests
   * assert on, so it counts what is held, never what would be live.
   */
  get responseCount(): number {
    let count = 0;
    for (const cache of this.#responses.values()) count += cache.size;
    return count;
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

  /** Drop every cached response past its own expiry, whatever its session. */
  #sweepResponses(now: number): void {
    for (const [id, cache] of this.#responses) {
      for (const [key, entry] of cache) {
        if (now >= entry.expiresAt) cache.delete(key);
      }
      if (cache.size === 0) this.#responses.delete(id);
    }
  }
}
