import { describe, expect, it } from 'vitest';

import {
  ipInCidrs,
  normalizeIp,
  parseCidr,
  parseCidrList,
} from '../../src/ussd/gateway/ipAllowlist.js';

describe('parseCidrList', () => {
  it('parses a comma-separated list, trimming whitespace', () => {
    const cidrs = parseCidrList('10.0.0.0/8, 196.216.0.0/16');
    expect(cidrs).toHaveLength(2);
    expect(cidrs.map((c) => c.source)).toEqual(['10.0.0.0/8', '196.216.0.0/16']);
  });

  it('returns an empty list for undefined or empty input (allowlist off)', () => {
    expect(parseCidrList(undefined)).toEqual([]);
    expect(parseCidrList('')).toEqual([]);
    expect(parseCidrList('  ,  ')).toEqual([]);
  });

  it('skips unparseable entries rather than widening the allowlist', () => {
    // A typo must never become a match-everything wildcard.
    const cidrs = parseCidrList('10.0.0.0/8, not-an-ip, 999.1.1.1/8, 10.0.0.0/40');
    expect(cidrs.map((c) => c.source)).toEqual(['10.0.0.0/8']);
  });

  it('treats a bare address as a single host', () => {
    const cidr = parseCidr('203.0.113.7');
    expect(cidr?.prefixBits).toBe(32);
  });
});

describe('ipInCidrs (IPv4)', () => {
  const ranges = parseCidrList('196.216.0.0/16, 10.0.0.0/8');

  it('matches an address inside a range', () => {
    expect(ipInCidrs('196.216.4.9', ranges)).toBe(true);
    expect(ipInCidrs('10.255.1.2', ranges)).toBe(true);
  });

  it('rejects an address outside every range', () => {
    expect(ipInCidrs('127.0.0.1', ranges)).toBe(false);
    expect(ipInCidrs('8.8.8.8', ranges)).toBe(false);
    expect(ipInCidrs('196.217.0.1', ranges)).toBe(false);
  });

  it('an empty allowlist matches nothing (off)', () => {
    expect(ipInCidrs('10.0.0.1', [])).toBe(false);
  });

  it('undefined client IP never matches', () => {
    expect(ipInCidrs(undefined, ranges)).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 before matching', () => {
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(ipInCidrs('::ffff:10.1.2.3', ranges)).toBe(true);
  });

  it('a /32 host range matches only that host', () => {
    const host = parseCidrList('203.0.113.7/32');
    expect(ipInCidrs('203.0.113.7', host)).toBe(true);
    expect(ipInCidrs('203.0.113.8', host)).toBe(false);
  });

  it('handles a non-byte-aligned prefix', () => {
    const r = parseCidrList('192.168.8.0/22'); // covers .8.0 - .11.255
    expect(ipInCidrs('192.168.10.5', r)).toBe(true);
    expect(ipInCidrs('192.168.12.5', r)).toBe(false);
  });
});

describe('ipInCidrs (IPv6)', () => {
  it('matches inside an IPv6 range and rejects outside', () => {
    const r = parseCidrList('2001:db8::/32');
    expect(ipInCidrs('2001:db8:1234::1', r)).toBe(true);
    expect(ipInCidrs('2001:dead::1', r)).toBe(false);
  });

  it('does not cross address families', () => {
    const v4 = parseCidrList('10.0.0.0/8');
    expect(ipInCidrs('::1', v4)).toBe(false);
    const v6 = parseCidrList('2001:db8::/32');
    expect(ipInCidrs('10.0.0.1', v6)).toBe(false);
  });
});
