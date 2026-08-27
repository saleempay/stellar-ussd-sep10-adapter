/**
 * Optional IP allowlist for the callback surface (finding 2, layer 2).
 *
 * Africa's Talking does not sign its callbacks and does not publish a fixed
 * egress range in its public documentation (its guidance is username plus
 * API key for the outbound direction, and "whitelist our IP" for SIP
 * trunks without listing the range). So the ranges are inherently
 * deployment-specific: the deployer obtains them from the provider and sets
 * them, and this module only does the matching. Zero dependencies, IPv4
 * CIDR plus exact/prefix IPv6, with IPv4-mapped IPv6 normalized.
 *
 * This is a network control, not a substitute for the unguessable callback
 * path; both layers ship. It defaults OFF: an empty list matches nothing
 * special, so callers treat "no CIDRs configured" as "allowlist disabled".
 */

/** A parsed CIDR: base address bytes and a prefix length in bits. */
export interface ParsedCidr {
  bytes: Uint8Array;
  prefixBits: number;
  /** The original text, for diagnostics. */
  source: string;
}

/**
 * Parse a comma-separated CIDR list (e.g. `"196.216.0.0/16, 10.0.0.0/8"`).
 * Entries without a `/` are treated as a single host (full-length prefix).
 * Unparseable entries are skipped, so one typo cannot silently widen the
 * allowlist to everything.
 */
export function parseCidrList(spec: string | undefined): ParsedCidr[] {
  if (spec === undefined) return [];
  const out: ParsedCidr[] = [];
  for (const raw of spec.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const parsed = parseCidr(entry);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/** Parse a single CIDR or bare address. Returns undefined if unparseable. */
export function parseCidr(entry: string): ParsedCidr | undefined {
  const slash = entry.indexOf('/');
  const addr = slash === -1 ? entry : entry.slice(0, slash);
  const bytes = addressToBytes(addr);
  if (bytes === undefined) return undefined;
  const maxBits = bytes.length * 8;
  let prefixBits = maxBits;
  if (slash !== -1) {
    const n = Number(entry.slice(slash + 1));
    if (!Number.isInteger(n) || n < 0 || n > maxBits) return undefined;
    prefixBits = n;
  }
  return { bytes, prefixBits, source: entry };
}

/** True when `ip` falls in any of the ranges. Empty list is always false. */
export function ipInCidrs(ip: string | undefined, cidrs: readonly ParsedCidr[]): boolean {
  if (ip === undefined || cidrs.length === 0) return false;
  const ipBytes = addressToBytes(normalizeIp(ip));
  if (ipBytes === undefined) return false;
  return cidrs.some((c) => c.bytes.length === ipBytes.length && prefixMatch(ipBytes, c));
}

/** Strip an IPv4-mapped IPv6 prefix (`::ffff:1.2.3.4` -> `1.2.3.4`). */
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return m?.[1] ?? ip;
}

function prefixMatch(ipBytes: Uint8Array, cidr: ParsedCidr): boolean {
  let bitsLeft = cidr.prefixBits;
  for (let i = 0; i < ipBytes.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if (((ipBytes[i] ?? 0) & mask) !== ((cidr.bytes[i] ?? 0) & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

/** Convert an IPv4 or IPv6 address to bytes, or undefined if invalid. */
function addressToBytes(addr: string): Uint8Array | undefined {
  if (addr.includes('.') && !addr.includes(':')) return ipv4ToBytes(addr);
  if (addr.includes(':')) return ipv6ToBytes(addr);
  return undefined;
}

function ipv4ToBytes(addr: string): Uint8Array | undefined {
  const parts = addr.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255 || !/^\d+$/.test(parts[i] ?? '')) {
      return undefined;
    }
    bytes[i] = n;
  }
  return bytes;
}

function ipv6ToBytes(addr: string): Uint8Array | undefined {
  const halves = addr.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] ?? '').split(':')) : [];
  const groups: string[] = [];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return undefined;
    groups.push(...head, ...Array<string>(fill).fill('0'), ...tail);
  } else {
    groups.push(...head);
  }
  if (groups.length !== 8) return undefined;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i] ?? '';
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined;
    const n = parseInt(g, 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}
