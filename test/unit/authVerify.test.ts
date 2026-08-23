/**
 * Challenge verification: every failure mode named in the stable
 * `failedCheck` contract, exercised against tampered fixtures, plus the
 * happy path. Fixtures are built with the SDK's own `buildChallengeTx` (the
 * anchor side of the protocol) or hand-built where tampering requires it.
 * No network anywhere in this file.
 */
import { randomBytes } from 'node:crypto';
import {
  Account,
  BASE_FEE,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { ChallengeValidationError, type ChallengeFailedCheck } from '../../src/errors.js';
import type { WebAuthConfig } from '../../src/auth/toml.js';
import { verifyChallenge } from '../../src/auth/verify.js';

const NET = Networks.TESTNET;
const serverKp = Keypair.random();
const clientKp = Keypair.random();

const anchor: WebAuthConfig = {
  homeDomain: 'testanchor.stellar.org',
  webAuthEndpoint: 'https://testanchor.stellar.org/auth',
  signingKey: serverKp.publicKey(),
  webAuthDomain: 'testanchor.stellar.org',
};

function goodChallenge(overrides?: { server?: Keypair; client?: string; homeDomain?: string; webAuthDomain?: string; net?: string; memo?: string }): string {
  return WebAuth.buildChallengeTx(
    overrides?.server ?? serverKp,
    overrides?.client ?? clientKp.publicKey(),
    overrides?.homeDomain ?? anchor.homeDomain,
    300,
    overrides?.net ?? NET,
    overrides?.webAuthDomain ?? anchor.webAuthDomain,
    overrides?.memo ?? null,
  );
}

/** Hand-built challenge-shaped transaction for tampering with structure. */
function rawChallenge(opts: {
  sequence?: string;
  timebounds?: { minTime: number; maxTime: number } | 'infinite';
  firstOp?: ReturnType<typeof Operation.manageData>;
  extraOps?: Array<ReturnType<typeof Operation.manageData>>;
  memo?: Memo;
  sign?: boolean;
  omitWebAuthDomainOp?: boolean;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const account = new Account(serverKp.publicKey(), opts.sequence ?? '-1');
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NET,
    ...(opts.timebounds === 'infinite'
      ? {}
      : { timebounds: opts.timebounds ?? { minTime: now, maxTime: now + 300 } }),
  });
  builder.addOperation(
    opts.firstOp ??
      Operation.manageData({
        name: `${anchor.homeDomain} auth`,
        value: randomBytes(48).toString('base64'),
        source: clientKp.publicKey(),
      }),
  );
  if (!opts.omitWebAuthDomainOp) {
    builder.addOperation(
      Operation.manageData({
        name: 'web_auth_domain',
        value: anchor.webAuthDomain,
        source: serverKp.publicKey(),
      }),
    );
  }
  for (const op of opts.extraOps ?? []) builder.addOperation(op);
  if (opts.memo) builder.addMemo(opts.memo);
  if (opts.timebounds === 'infinite') builder.setTimeout(TimeoutInfinite);
  const tx = builder.build();
  if (opts.sign !== false) tx.sign(serverKp);
  return tx.toEnvelope().toXDR('base64');
}

function failedCheckOf(challengeXdr: string, expectedAccountId = clientKp.publicKey(), nowSeconds?: number): ChallengeFailedCheck {
  try {
    verifyChallenge({
      challengeXdr,
      expectedAccountId,
      anchor,
      networkPassphrase: NET,
      ...(nowSeconds === undefined ? {} : { nowSeconds }),
    });
  } catch (err) {
    expect(err).toBeInstanceOf(ChallengeValidationError);
    return (err as ChallengeValidationError).failedCheck;
  }
  throw new Error('expected verifyChallenge to refuse the challenge');
}

describe('verifyChallenge', () => {
  it('accepts a well-formed challenge and returns the client account and matched domain', () => {
    const result = verifyChallenge({
      challengeXdr: goodChallenge(),
      expectedAccountId: clientKp.publicKey(),
      anchor,
      networkPassphrase: NET,
    });
    expect(result.clientAccountId).toBe(clientKp.publicKey());
    expect(result.matchedHomeDomain).toBe(anchor.homeDomain);
  });

  it('refuses garbage XDR: deserialization', () => {
    expect(failedCheckOf('not xdr at all')).toBe('deserialization');
  });

  it('refuses a fee-bump envelope: deserialization', () => {
    const inner = new TransactionBuilder(new Account(serverKp.publicKey(), '0'), {
      fee: BASE_FEE,
      networkPassphrase: NET,
      timebounds: { minTime: 0, maxTime: 0 },
    })
      .addOperation(Operation.bumpSequence({ bumpTo: '1' }))
      .build();
    inner.sign(serverKp);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(serverKp, '200', inner, NET);
    feeBump.sign(serverKp);
    const xdr = feeBump.toEnvelope().toXDR('base64');
    const err = (() => {
      try {
        verifyChallenge({ challengeXdr: xdr, expectedAccountId: clientKp.publicKey(), anchor, networkPassphrase: NET });
      } catch (e) {
        return e as ChallengeValidationError;
      }
      throw new Error('expected refusal');
    })();
    expect(err.failedCheck).toBe('deserialization');
    expect(err.message).toMatch(/fee-bump/);
  });

  it('refuses a nonzero sequence number: sequence_not_zero', () => {
    expect(failedCheckOf(rawChallenge({ sequence: '5' }))).toBe('sequence_not_zero');
  });

  it('refuses a challenge whose source is not the anchor SIGNING_KEY: source_not_server', () => {
    const evilServer = Keypair.random();
    expect(failedCheckOf(goodChallenge({ server: evilServer }))).toBe('source_not_server');
  });

  it('refuses a first operation with no source account: first_op_source_missing', () => {
    const xdr = rawChallenge({
      firstOp: Operation.manageData({
        name: `${anchor.homeDomain} auth`,
        value: randomBytes(48).toString('base64'),
      }),
    });
    expect(failedCheckOf(xdr)).toBe('first_op_source_missing');
  });

  it('refuses a first operation that is not manage_data: first_op_not_manage_data', () => {
    const xdr = rawChallenge({
      firstOp: Operation.bumpSequence({ bumpTo: '1', source: clientKp.publicKey() }) as never,
    });
    expect(failedCheckOf(xdr)).toBe('first_op_not_manage_data');
  });

  it('refuses a challenge built for another home domain: home_domain_mismatch', () => {
    expect(failedCheckOf(goodChallenge({ homeDomain: 'evil.example.com' }))).toBe(
      'home_domain_mismatch',
    );
  });

  it("accepts the reviewer's mixed-case probe: 'TestAnchor.Stellar.org auth' against a lowercase config", () => {
    const xdr = goodChallenge({ homeDomain: 'TestAnchor.Stellar.org', webAuthDomain: 'TestAnchor.Stellar.org' });
    const result = verifyChallenge({ challengeXdr: xdr, expectedAccountId: clientKp.publicKey(), anchor, networkPassphrase: NET });
    expect(result.clientAccountId).toBe(clientKp.publicKey());
    expect(result.matchedHomeDomain).toBe(anchor.homeDomain);
  });

  it('accepts a mixed-case configured home domain against a lowercase challenge', () => {
    const upper = { ...anchor, homeDomain: 'TESTANCHOR.STELLAR.ORG', webAuthDomain: 'TESTANCHOR.STELLAR.ORG' };
    const result = verifyChallenge({ challengeXdr: goodChallenge(), expectedAccountId: clientKp.publicKey(), anchor: upper, networkPassphrase: NET });
    expect(result.matchedHomeDomain).toBe('TESTANCHOR.STELLAR.ORG');
  });

  it('still refuses a genuinely wrong domain regardless of case: home_domain_mismatch', () => {
    expect(failedCheckOf(goodChallenge({ homeDomain: 'EVIL.EXAMPLE.COM' }))).toBe('home_domain_mismatch');
  });

  it('refuses infinite timebounds: timebounds_missing', () => {
    expect(failedCheckOf(rawChallenge({ timebounds: 'infinite' }))).toBe('timebounds_missing');
  });

  it('refuses an expired challenge: timebounds_expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const xdr = rawChallenge({ timebounds: { minTime: now - 7200, maxTime: now - 6300 } });
    expect(failedCheckOf(xdr)).toBe('timebounds_expired');
  });

  it('refuses a not-yet-valid challenge beyond the grace window: timebounds_expired', () => {
    const xdr = goodChallenge();
    const farPast = Math.floor(Date.now() / 1000) - 3600;
    expect(failedCheckOf(xdr, clientKp.publicKey(), farPast)).toBe('timebounds_expired');
  });

  it("refuses the reviewer's probe: minTime 0 with maxTime a year out: timebounds_unbounded", () => {
    const now = Math.floor(Date.now() / 1000);
    const xdr = rawChallenge({ timebounds: { minTime: 0, maxTime: now + 365 * 86400 } });
    expect(failedCheckOf(xdr)).toBe('timebounds_unbounded');
  });

  it('accepts a 15 minute window', () => {
    const now = Math.floor(Date.now() / 1000);
    const xdr = rawChallenge({ timebounds: { minTime: now, maxTime: now + 900 } });
    expect(verifyChallenge({ challengeXdr: xdr, expectedAccountId: clientKp.publicKey(), anchor, networkPassphrase: NET }).clientAccountId).toBe(clientKp.publicKey());
  });

  it('accepts a window of exactly 1200 seconds (boundary)', () => {
    const now = Math.floor(Date.now() / 1000);
    const xdr = rawChallenge({ timebounds: { minTime: now, maxTime: now + 1200 } });
    expect(verifyChallenge({ challengeXdr: xdr, expectedAccountId: clientKp.publicKey(), anchor, networkPassphrase: NET }).clientAccountId).toBe(clientKp.publicKey());
  });

  it('refuses a 21 minute window: timebounds_window_too_wide', () => {
    const now = Math.floor(Date.now() / 1000);
    const xdr = rawChallenge({ timebounds: { minTime: now, maxTime: now + 1260 } });
    expect(failedCheckOf(xdr)).toBe('timebounds_window_too_wide');
  });

  it('accepts clock skew inside the documented 300 second grace', () => {
    const skewed = Math.floor(Date.now() / 1000) - 200;
    const result = verifyChallenge({
      challengeXdr: goodChallenge(),
      expectedAccountId: clientKp.publicKey(),
      anchor,
      networkPassphrase: NET,
      nowSeconds: skewed,
    });
    expect(result.clientAccountId).toBe(clientKp.publicKey());
  });

  it('refuses a short nonce: nonce_invalid', () => {
    const xdr = rawChallenge({
      firstOp: Operation.manageData({
        name: `${anchor.homeDomain} auth`,
        value: randomBytes(16).toString('base64'),
        source: clientKp.publicKey(),
      }),
    });
    expect(failedCheckOf(xdr)).toBe('nonce_invalid');
  });

  it('refuses a subsequent operation not sourced by the server: extra_op_invalid', () => {
    const xdr = rawChallenge({
      extraOps: [
        Operation.manageData({ name: 'smuggled', value: 'x', source: clientKp.publicKey() }),
      ],
    });
    expect(failedCheckOf(xdr)).toBe('extra_op_invalid');
  });

  it('refuses a subsequent operation that is not manage_data: extra_op_invalid', () => {
    const xdr = rawChallenge({
      extraOps: [Operation.bumpSequence({ bumpTo: '1', source: serverKp.publicKey() }) as never],
    });
    expect(failedCheckOf(xdr)).toBe('extra_op_invalid');
  });

  it('refuses a wrong web_auth_domain value: web_auth_domain_mismatch', () => {
    expect(failedCheckOf(goodChallenge({ webAuthDomain: 'evil.example.com' }))).toBe(
      'web_auth_domain_mismatch',
    );
  });

  it('refuses an unsigned challenge: server_signature_invalid', () => {
    expect(failedCheckOf(rawChallenge({ sign: false }))).toBe('server_signature_invalid');
  });

  it('refuses a challenge signed for another network: server_signature_invalid', () => {
    const xdr = goodChallenge({ net: Networks.PUBLIC });
    expect(failedCheckOf(xdr)).toBe('server_signature_invalid');
  });

  it('refuses a challenge naming a different client account: client_account_mismatch', () => {
    const otherClient = Keypair.random().publicKey();
    expect(failedCheckOf(goodChallenge({ client: otherClient }))).toBe('client_account_mismatch');
  });

  it('refuses an unsolicited memo: unexpected_memo', () => {
    expect(failedCheckOf(goodChallenge({ memo: '7' }))).toBe('unexpected_memo');
  });

  it("refuses the reviewer's probe: a client_domain op from an arbitrary keypair: unexpected_client_domain", () => {
    const arbitrary = Keypair.random();
    const xdr = rawChallenge({
      extraOps: [
        Operation.manageData({ name: 'client_domain', value: 'wallet.example.com', source: arbitrary.publicKey() }),
      ],
    });
    expect(failedCheckOf(xdr)).toBe('unexpected_client_domain');
  });

  it('refuses a client_domain op even when sourced by the server: unexpected_client_domain', () => {
    const xdr = rawChallenge({
      extraOps: [
        Operation.manageData({ name: 'client_domain', value: 'wallet.example.com', source: serverKp.publicKey() }),
      ],
    });
    expect(failedCheckOf(xdr)).toBe('unexpected_client_domain');
  });

  it('surfaces a residual SDK refusal as sdk_validation', () => {
    // A muxed client account combined with a memo passes every explicit
    // adapter pre-check (the memo check runs after the SDK gate) but the
    // SDK reader refuses the combination outright.
    const muxedClient = new MuxedAccount(new Account(clientKp.publicKey(), '0'), '7').accountId();
    const xdr = rawChallenge({
      firstOp: Operation.manageData({
        name: `${anchor.homeDomain} auth`,
        value: randomBytes(48).toString('base64'),
        source: muxedClient,
      }),
      memo: Memo.id('7'),
    });
    expect(failedCheckOf(xdr, muxedClient)).toBe('sdk_validation');
  });
});
