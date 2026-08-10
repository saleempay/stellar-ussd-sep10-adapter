/**
 * Helpers for the live-testnet integration test. Test-only code.
 */

/** Minimal SEP-1 stellar.toml reads: top-level key + [[CURRENCIES]] lookup. */
export function parseStellarToml(toml: string): {
  webAuthEndpoint?: string;
  currencies: Array<{ code?: string; issuer?: string }>;
} {
  const webAuth = /^WEB_AUTH_ENDPOINT\s*=\s*"([^"]+)"/m.exec(toml);

  const currencies: Array<{ code?: string; issuer?: string }> = [];
  const blocks = toml.split(/^\[\[CURRENCIES\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    // Stop each block at the next section header so keys don't bleed across.
    const body = block.split(/^\[/m)[0] ?? '';
    const code = /^code\s*=\s*"([^"]+)"/m.exec(body)?.[1];
    const issuer = /^issuer\s*=\s*"([^"]+)"/m.exec(body)?.[1];
    currencies.push({ code, issuer });
  }
  return { webAuthEndpoint: webAuth?.[1], currencies };
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
