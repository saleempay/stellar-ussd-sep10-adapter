/**
 * Live Stellar TESTNET integration test.
 *
 * Skipped unless RUN_TESTNET_E2E=1 (see package script `test:e2e`). When it
 * runs it:
 *
 *   1. reads the SRT issuer and SEP-10 WEB_AUTH_ENDPOINT from the live
 *      testanchor.stellar.org stellar.toml (liveness observation only —
 *      nothing is built against the endpoint in Week 1);
 *   2. resolves a fresh fictional MSISDN → miss → creates the account
 *      on-chain with sponsored reserves and an SRT trustline;
 *   3. resolves the same MSISDN again → hit, no second creation;
 *   4. verifies the trustline preflight both ways (present on the new
 *      account, TrustlineMissingError on the sponsor);
 *   5. captures raw Horizon JSON (transaction, accounts before/after,
 *      ledger) into test-output/e2e-evidence.json and prints every
 *      transaction hash with its stellar.expert link.
 *
 * Everything printed as an on-chain claim is read back from Horizon —
 * nothing is fabricated. Requires a funded sponsor in .env
 * (node scripts/setup-sponsor.mjs).
 */
import { Horizon } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  InMemoryAccountStore,
  LocalKeypairSigner,
  TrustlineMissingError,
  assertTrustline,
  loadConfig,
  resolveOrCreateAccount,
} from '../../src/index.js';
import { horizonJson, parseStellarToml, randomTestMsisdn, stellarExpertTxUrl } from './helpers.js';

const TEST_ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';

const enabled = process.env.RUN_TESTNET_E2E === '1';

describe.skipIf(!enabled)('live testnet end-to-end (Week 1)', () => {
  it('resolves, creates with sponsored reserves, establishes the trustline', async () => {
    if (existsSync('.env')) process.loadEnvFile('.env');

    // --- Anchor toml: SRT issuer + SEP-10 endpoint liveness observation ---
    const tomlFetchedAt = new Date().toISOString();
    const tomlRes = await fetch(`https://${TEST_ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`);
    expect(tomlRes.ok).toBe(true);
    const toml = parseStellarToml(await tomlRes.text());

    const srt = toml.currencies.find((c) => c.code === 'SRT');
    expect(srt?.issuer, 'SRT issuer must be declared in the live stellar.toml').toMatch(/^G[A-Z2-7]{55}$/);
    const assetIssuer = srt!.issuer!;

    expect(toml.webAuthEndpoint, 'SEP-10 WEB_AUTH_ENDPOINT must be declared').toBeTruthy();
    // Liveness only: does the declared endpoint respond at all? Week 2 builds
    // the actual challenge flow; nothing here depends on the response body.
    const webAuthProbedAt = new Date().toISOString();
    const webAuthRes = await fetch(toml.webAuthEndpoint!, { method: 'GET' });
    const webAuthObservation = {
      endpoint: toml.webAuthEndpoint,
      probedAt: webAuthProbedAt,
      httpStatus: webAuthRes.status,
      responds: webAuthRes.status > 0,
    };

    // --- Config and dependencies ---
    const config = loadConfig({ ...process.env, ASSET_ISSUER: assetIssuer, ASSET_CODE: 'SRT' });
    const secret = process.env.SPONSOR_SECRET_KEY;
    expect(secret, 'Run `node scripts/setup-sponsor.mjs` and fill .env first').toBeTruthy();

    const signer = new LocalKeypairSigner();
    const sponsorPublicKey = signer.importSecret(secret!);
    expect(sponsorPublicKey).toBe(config.sponsorPublicKey);

    const horizon = new Horizon.Server(config.horizonUrl);
    const deps = {
      store: new InMemoryAccountStore(),
      signer,
      horizon,
      networkPassphrase: config.networkPassphrase,
      sponsorPublicKey,
      asset: config.asset,
    };

    // --- Baselines (raw Horizon JSON) ---
    const sponsorBefore = await horizonJson(config.horizonUrl, `/accounts/${sponsorPublicKey}`);

    // --- Resolve → miss → create ---
    const msisdn = randomTestMsisdn();
    const first = await resolveOrCreateAccount(deps, msisdn);
    expect(first.created).toBe(true);
    expect(first.creationTxHash).toMatch(/^[0-9a-f]{64}$/);

    // --- Read every claim back from Horizon ---
    const creationTx = await horizonJson(config.horizonUrl, `/transactions/${first.creationTxHash}`);
    expect(creationTx.hash).toBe(first.creationTxHash);
    expect(creationTx.successful).toBe(true);

    const creationOps = await horizonJson(
      config.horizonUrl,
      `/transactions/${first.creationTxHash}/operations`,
    );

    const newAccount = await horizonJson(config.horizonUrl, `/accounts/${first.accountId}`);
    const sponsorAfter = await horizonJson(config.horizonUrl, `/accounts/${sponsorPublicKey}`);
    const ledger = await horizonJson(config.horizonUrl, `/ledgers/${creationTx.ledger}`);

    // --- Resolve again → hit ---
    const second = await resolveOrCreateAccount(deps, msisdn);
    expect(second.created).toBe(false);
    expect(second.accountId).toBe(first.accountId);

    // --- Trustline surfaces both ways ---
    await assertTrustline(horizon, first.accountId, config.asset);
    await expect(assertTrustline(horizon, sponsorPublicKey, config.asset)).rejects.toThrow(
      TrustlineMissingError,
    );

    // --- Persist raw evidence for EVIDENCE.md authoring ---
    mkdirSync('test-output', { recursive: true });
    const evidence = {
      ranAt: new Date().toISOString(),
      network: { horizonUrl: config.horizonUrl, networkPassphrase: config.networkPassphrase },
      anchorToml: {
        homeDomain: TEST_ANCHOR_HOME_DOMAIN,
        fetchedAt: tomlFetchedAt,
        srtIssuer: assetIssuer,
        webAuthObservation,
      },
      msisdn,
      resolution: { first, second },
      raw: { creationTx, creationOps, newAccount, sponsorBefore, sponsorAfter, ledger },
    };
    writeFileSync('test-output/e2e-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);

    // --- Human-readable summary with verifiable links ---
    const nativeBalance = (a: Record<string, unknown>) =>
      (a.balances as Array<{ asset_type: string; balance: string }>).find(
        (b) => b.asset_type === 'native',
      )?.balance;
    console.log('\n=== Week 1 live testnet run ===');
    console.log(`MSISDN (fictional):        ${msisdn}`);
    console.log(`New account:               ${first.accountId}`);
    console.log(`Creation tx:               ${first.creationTxHash}`);
    console.log(`  ${stellarExpertTxUrl(first.creationTxHash!)}`);
    console.log(`Ledger ${creationTx.ledger}: base_reserve_in_stroops=${ledger.base_reserve_in_stroops}`);
    console.log(`New account native balance: ${nativeBalance(newAccount)} (num_sponsored=${newAccount.num_sponsored})`);
    console.log(`Sponsor num_sponsoring:    ${sponsorBefore.num_sponsoring} -> ${sponsorAfter.num_sponsoring}`);
    console.log(`Sponsor XLM:               ${nativeBalance(sponsorBefore)} -> ${nativeBalance(sponsorAfter)}`);
    console.log(`SEP-10 WEB_AUTH_ENDPOINT:  ${webAuthObservation.endpoint} (HTTP ${webAuthObservation.httpStatus} at ${webAuthObservation.probedAt})`);
    console.log('Raw evidence: test-output/e2e-evidence.json');
  });
});
