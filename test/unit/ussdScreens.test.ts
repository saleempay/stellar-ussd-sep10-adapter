import { describe, expect, it } from 'vitest';

import {
  CHAR_BUDGET,
  PREFIX_LENGTH,
  SCREENS,
  allScreensAtMaxLength,
  shortAccount,
} from '../../src/ussd/menu/screens.js';

describe('screen catalogue budget', () => {
  // Budget source: Africa's Talking help centre article 1284096 ("What is
  // the character limit for USSD menus and user input in Kenya?"):
  // Safaricom KE 160 characters, Airtel KE 184. The catalogue is budgeted
  // against the 160 character Safaricom floor including the CON/END
  // prefix, and never relies on automatic pagination.
  it.each(allScreensAtMaxLength().map((s) => [s.hop ?? s.text.slice(0, 20), s] as const))(
    'screen %s fits the 160 character Safaricom floor with its prefix',
    (_label, screen) => {
      expect(screen.text.length + PREFIX_LENGTH).toBeLessThanOrEqual(CHAR_BUDGET);
    },
  );

  it('covers a meaningful catalogue (guard against an emptied list)', () => {
    expect(allScreensAtMaxLength().length).toBeGreaterThanOrEqual(20);
  });

  it.each(allScreensAtMaxLength().map((s) => [s.hop ?? '?', s] as const))(
    'screen %s uses no special characters the telcos cannot render',
    (_label, screen) => {
      // Provider docs: menus should not contain special characters. The
      // catalogue sticks to ASCII letters, digits, newline, and . , : '.
      expect(screen.text).toMatch(/^[A-Za-z0-9 .,:'\n]+$/);
    },
  );

  it('hop labels satisfy the documented header constraints', () => {
    for (const screen of allScreensAtMaxLength()) {
      if (screen.hop !== undefined) {
        expect(screen.hop.length).toBeLessThanOrEqual(99);
        expect(screen.hop).not.toContain('|');
      }
    }
  });

  it('the weak-PIN rejection screen is digit-free (no info leak, F4)', () => {
    // Hard rule: a weak-PIN rejection must not reveal which pattern or which
    // digits triggered it. A digit-free screen cannot echo any attempted
    // digit or hint at the rule.
    expect(SCREENS.pinSetupWeak().text).not.toMatch(/[0-9]/);
  });

  it('shortAccount shows first and last four characters only', () => {
    const account = 'GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM';
    expect(shortAccount(account)).toBe('GAA3..EAFM');
  });
});
