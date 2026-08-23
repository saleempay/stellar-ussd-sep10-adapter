/**
 * Bounded network legs for the auth path.
 *
 * Rationale: a USSD session is hard-bounded by the gateway at 120 to 180
 * seconds. A hung anchor (or a hung toml host) must therefore become a fast
 * typed failure the session layer can render, not a silent wait until the
 * gateway kills the session and the user sees nothing. Every network leg
 * on the auth path (toml resolution, challenge GET, token POST) is bounded
 * by one timeout, {@link DEFAULT_NETWORK_TIMEOUT_MS} unless the caller
 * overrides it through the single `timeoutMs` dependency.
 */

/** Default per-leg network timeout: 10 seconds. */
export const DEFAULT_NETWORK_TIMEOUT_MS = 10_000;

/** Error raised when a leg exceeds its timeout. `name` is `TimeoutError`. */
export class NetworkTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Network leg timed out after ${timeoutMs} ms.`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Run `fetchFn` with an `AbortSignal.timeout` attached AND race it against
 * the same deadline, so the bound holds even for a transport that ignores
 * the signal (an injected test double, an exotic fetch polyfill).
 *
 * @throws NetworkTimeoutError when the deadline passes first.
 */
export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NetworkTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([
      fetchFn(input, { ...init, signal }).catch((err: unknown) => {
        throw isAbortLike(err) ? new NetworkTimeoutError(timeoutMs) : err;
      }),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** True for the adapter's own timeout error or a runtime abort/timeout error. */
export function isTimeoutError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError' || isAbortLike(err);
}

function isAbortLike(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === 'AbortError' ||
    e.name === 'TimeoutError' ||
    e.name === 'CanceledError' ||
    e.code === 'ECONNABORTED' ||
    /timeout of \d+ms exceeded/i.test(e.message ?? '')
  );
}
