/**
 * Helpers for the live-testnet integration test. Test-only code.
 */

/** Minimal SEP-1 stellar.toml reads: top-level key + [[CURRENCIES]] lookup. */
export function parseStellarToml(toml: string): {
  webAuthEndpoint?: string;
  transferServer?: string;
  currencies: Array<{ code?: string; issuer?: string }>;
} {
  const webAuth = /^WEB_AUTH_ENDPOINT\s*=\s*"([^"]+)"/m.exec(toml);
  const transferServer = /^TRANSFER_SERVER\s*=\s*"([^"]+)"/m.exec(toml);

  const currencies: Array<{ code?: string; issuer?: string }> = [];
  const blocks = toml.split(/^\[\[CURRENCIES\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    // Stop each block at the next section header so keys don't bleed across.
    const body = block.split(/^\[/m)[0] ?? '';
    const code = /^code\s*=\s*"([^"]+)"/m.exec(body)?.[1];
    const issuer = /^issuer\s*=\s*"([^"]+)"/m.exec(body)?.[1];
    currencies.push({ code, issuer });
  }
  return { webAuthEndpoint: webAuth?.[1], transferServer: transferServer?.[1], currencies };
}

/** One captured HTTP exchange, for embedding in EVIDENCE.md. */
export interface CapturedExchange {
  at: string;
  method: string;
  url: string;
  status: number;
  requestBody?: unknown;
  responseBody?: unknown;
}

/**
 * A fetch that records every exchange it carries (timestamps, bodies,
 * status) into `captures`, for evidence authoring. Raw captures land only
 * in gitignored test-output; anything embedded in a committed file has its
 * JWT signature segments redacted first.
 */
export function capturingFetch(captures: CapturedExchange[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const at = new Date().toISOString();
    const res = await fetch(input as string | URL, init);
    const text = await res.clone().text().catch(() => undefined);
    let responseBody: unknown = text;
    if (text !== undefined) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        // Keep the raw text.
      }
    }
    captures.push({
      at,
      method: init?.method ?? 'GET',
      url: String(input),
      status: res.status,
      requestBody: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      responseBody,
    });
    return res;
  }) as typeof fetch;
}

/** Raw Horizon GET, returning parsed JSON. Throws on non-2xx. */
export async function horizonJson(horizonUrl: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${horizonUrl}${path}`);
  if (!res.ok) {
    throw new Error(`Horizon GET ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** A clearly-fictional testnet MSISDN: +999 (unassigned country code) + 8 random digits. */
export function randomTestMsisdn(): string {
  const digits = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('');
  return `+999${digits}`;
}

export function stellarExpertTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
