import { describe, expect, it } from 'vitest';

import { InvalidMsisdnError } from '../../src/errors.js';
import { inferE164 } from '../../src/ussd/msisdn.js';

const cfg = { defaultCountryCode: '999' };

describe('inferE164', () => {
  it('passes through E.164 untouched', () => {
    expect(inferE164('+999700000001', cfg)).toBe('+999700000001');
  });

  it('still normalizes formatting noise on E.164 input', () => {
    expect(inferE164('+999 700-000 001', cfg)).toBe('+999700000001');
  });

  it('converts national format using the configured country code', () => {
    expect(inferE164('0700000001', cfg)).toBe('+999700000001');
  });

  it('strips formatting noise from national format before converting', () => {
    expect(inferE164('0700 000-001', cfg)).toBe('+999700000001');
  });

  it('refuses bare digits without + or leading zero (ambiguous)', () => {
    expect(() => inferE164('999700000001', cfg)).toThrow(InvalidMsisdnError);
  });

  it('refuses empty input', () => {
    expect(() => inferE164('', cfg)).toThrow(InvalidMsisdnError);
  });

  it('refuses a national number that converts to invalid E.164 (too long)', () => {
    expect(() => inferE164('070000000112345', cfg)).toThrow(InvalidMsisdnError);
  });

  it('refuses letters in national format', () => {
    expect(() => inferE164('07000abc01', cfg)).toThrow(InvalidMsisdnError);
  });
});
