/**
 * The screen catalogue: every text the reference menu can render.
 *
 * ## Character budget
 *
 * The menu length limit is telco-dependent: Safaricom KE 160 characters,
 * Airtel KE 184, with automatic pagination ("98:More 00:Back") beyond
 * that, per the provider's help centre (article 1284096). This catalogue
 * is budgeted against the 160 character Safaricom floor INCLUDING the
 * four character `CON `/`END ` prefix, and never relies on automatic
 * pagination. A unit test asserts the budget over every screen the
 * catalogue can produce, at the longest dynamic values possible.
 *
 * Screens use plain ASCII and no special characters (telcos are unable to
 * render them, per the provider docs).
 */

import type { Screen } from '../gateway/types.js';

/** The strictest documented per-menu character limit (Safaricom KE). */
export const CHAR_BUDGET = 160;

/** Length of the gateway response prefix (`CON ` or `END `). */
export const PREFIX_LENGTH = 4;

/** Compact display form of an account id: first 4 and last 4 characters. */
export function shortAccount(accountId: string): string {
  return `${accountId.slice(0, 4)}..${accountId.slice(-4)}`;
}

export const SCREENS = {
  welcome(): Screen {
    return {
      kind: 'con',
      hop: 'welcome',
      text: 'Saleem Stellar test\n1. Sign in and deposit\n2. About',
    };
  },

  invalidChoice(prompt: Screen): Screen {
    return { ...prompt, text: `Invalid choice\n${prompt.text}` };
  },

  pinSetup1(): Screen {
    return { kind: 'con', hop: 'pinSetup1', text: 'Create a 4 digit PIN' };
  },

  pinSetupBadFormat(): Screen {
    return {
      kind: 'con',
      hop: 'pinSetup1',
      text: 'PIN must be exactly 4 digits\nCreate a 4 digit PIN',
    };
  },

  pinSetup2(): Screen {
    return { kind: 'con', hop: 'pinSetup2', text: 'Enter the PIN again' };
  },

  pinSetupMismatch(): Screen {
    return {
      kind: 'con',
      hop: 'pinSetup1',
      text: 'PINs did not match\nCreate a 4 digit PIN',
    };
  },

  accountPrompt(): Screen {
    return {
      kind: 'con',
      hop: 'accountPrompt',
      text: 'PIN saved\n1. Create your account and continue',
    };
  },

  accountReady(): Screen {
    return { kind: 'con', hop: 'pinEnter', text: 'Account ready\nEnter your PIN' };
  },

  pinEnter(): Screen {
    return { kind: 'con', hop: 'pinEnter', text: 'Enter your PIN' };
  },

  pinEnterBadFormat(): Screen {
    return {
      kind: 'con',
      hop: 'pinEnter',
      text: 'PIN must be exactly 4 digits\nEnter your PIN',
    };
  },

  pinWrong(attemptsLeft: number): Screen {
    const plural = attemptsLeft === 1 ? 'attempt' : 'attempts';
    return {
      kind: 'con',
      hop: 'pinEnter',
      text: `Wrong PIN. ${attemptsLeft} ${plural} left\nEnter your PIN`,
    };
  },

  endConfirm(accountId: string, depositRef: string): Screen {
    return {
      kind: 'end',
      hop: 'confirm',
      text: `Signed in as ${shortAccount(accountId)}\nDeposit started\nRef ${depositRef}`,
    };
  },

  endInfo(): Screen {
    return {
      kind: 'end',
      hop: 'info',
      text: 'Test service for the Stellar USSD adapter. No funds move',
    };
  },

  endTimeout(): Screen {
    return {
      kind: 'end',
      hop: 'timeout',
      text: 'Session expired. Dial again to start over',
    };
  },

  endNoTrustline(): Screen {
    return {
      kind: 'end',
      hop: 'noTrustline',
      text: 'Your account cannot hold this asset yet. Try again later',
    };
  },

  endAuthRefused(): Screen {
    return {
      kind: 'end',
      hop: 'authRefused',
      text: 'Sign in refused by the anchor. Nothing was sent. Try again later',
    };
  },

  endAnchorDown(): Screen {
    return {
      kind: 'end',
      hop: 'anchorDown',
      text: 'Anchor not reachable. Try again later',
    };
  },

  endSignerDown(): Screen {
    return {
      kind: 'end',
      hop: 'signerDown',
      text: 'Signing service unavailable. Try again later',
    };
  },

  endAccountFailed(): Screen {
    return {
      kind: 'end',
      hop: 'accountFailed',
      text: 'Could not create your account. Try again later',
    };
  },

  endLocked(): Screen {
    return {
      kind: 'end',
      hop: 'locked',
      text: 'Too many wrong PINs. Try again in 15 minutes',
    };
  },

  endReplay(): Screen {
    return { kind: 'end', hop: 'replay', text: 'This step was already completed' };
  },

  endBusy(): Screen {
    return { kind: 'end', hop: 'busy', text: 'Still processing your last request' };
  },
} as const;

/**
 * Every screen the catalogue can produce, instantiated at the longest
 * dynamic values, for the budget test.
 */
export function allScreensAtMaxLength(): Screen[] {
  const longestAccount = 'G'.padEnd(56, 'X');
  return [
    SCREENS.welcome(),
    SCREENS.invalidChoice(SCREENS.welcome()),
    SCREENS.pinSetup1(),
    SCREENS.pinSetupBadFormat(),
    SCREENS.pinSetup2(),
    SCREENS.pinSetupMismatch(),
    SCREENS.accountPrompt(),
    SCREENS.accountReady(),
    SCREENS.pinEnter(),
    SCREENS.pinEnterBadFormat(),
    SCREENS.pinWrong(2),
    SCREENS.pinWrong(1),
    SCREENS.endConfirm(longestAccount, 'X'.repeat(8)),
    SCREENS.endInfo(),
    SCREENS.endTimeout(),
    SCREENS.endNoTrustline(),
    SCREENS.endAuthRefused(),
    SCREENS.endAnchorDown(),
    SCREENS.endSignerDown(),
    SCREENS.endAccountFailed(),
    SCREENS.endLocked(),
    SCREENS.endReplay(),
    SCREENS.endBusy(),
  ];
}
