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

  it('the confirmation screen fits the budget at maximum runtime values', () => {
    // The parametrised budget test above already covers this screen through
    // allScreensAtMaxLength(). This asserts it directly and by name, because
    // the wording changed after the Week 3 run (it used to read "Deposit
    // started", which overstated a testnet demonstration the anchor reports
    // as incomplete) and the replacement is 33 characters longer. The
    // guarantee should be legible on its own rather than implied by a loop.
    //
    // Longest possible runtime values: a full 56 character account id, which
    // shortAccount renders as 10 characters, and an 8 character deposit
    // reference (journey.ts truncates the SEP-6 id to 8).
    const longestAccount = 'G'.padEnd(56, 'X');
    const longestRef = 'X'.repeat(8);
    const screen = SCREENS.endConfirm(longestAccount, longestRef);

    expect(screen.text).toBe(
      'Signed in as GXXX..XXXX\nVerified by the anchor. Test only, no funds move\nRef XXXXXXXX',
    );
    expect(screen.text.length + PREFIX_LENGTH).toBe(89);
    expect(screen.text.length + PREFIX_LENGTH).toBeLessThanOrEqual(CHAR_BUDGET);

    // The values stay templated: neither the example account fragment nor
    // the example reference may be baked into the catalogue.
    const other = SCREENS.endConfirm('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW', 'ab12cd34');
    expect(other.text).toContain('GABC..TUVW');
    expect(other.text).toContain('Ref ab12cd34');
    expect(other.text).toContain('Verified by the anchor. Test only, no funds move');
  });

  it('the confirmation screen does not claim funds moved', () => {
    // The reason the wording changed. No screen in the catalogue may state
    // or imply that value was transferred: this sprint is testnet only and
    // the one deposit it initiates is reported by the anchor as incomplete.
    const screen = SCREENS.endConfirm('G'.padEnd(56, 'X'), 'X'.repeat(8));
    expect(screen.text).not.toMatch(/deposit(ed)? (started|sent|complete)/i);
    expect(screen.text.toLowerCase()).toContain('no funds move');
  });

  it('shortAccount shows first and last four characters only', () => {
    const account = 'GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM';
    expect(shortAccount(account)).toBe('GAA3..EAFM');
  });
});
