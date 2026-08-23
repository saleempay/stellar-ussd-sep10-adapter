/**
 * Live Stellar TESTNET SEP-10 integration test (Week 2).
 *
 * Skipped unless RUN_TESTNET_E2E=1 (see package script `test:e2e`). When it
 * runs it:
 *
 *   1. discovers the anchor's SEP-10 coordinates from the live
 *      testanchor.stellar.org stellar.toml over HTTPS;
 *   2. creates a fresh account with no client-side key via the Week 1 flow
 *      (sponsored reserves + SRT trustline), which yields this run's
 *      on-chain transaction hash;
 *   3. authenticates that account over SEP-10: challenge GET, verification,
 *      one signature through the signer seam, token POST, and asserts the
 *      decoded claims scope the JWT to the account;
 *   4. exercises the JWT once against the anchor's authenticated SEP-6
 *      transactions endpoint, and captures the refusal the same endpoint
 *      gives without the token (401 or 403; the actual status is recorded,
 *      not assumed);
 *   5. writes every HTTP exchange, timestamped, to
 *      test-output/sep10-e2e-evidence.json (gitignored) for EVIDENCE.md
 *      authoring. JWT signatures are redacted before anything is committed.
 *
 * The challenge transaction is an authentication artifact with sequence
 * number 0: it is never submitted to the network, and nothing here submits
 * it. Everything claimed as on-chain is read back from Horizon.
 */
import { Horizon } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  InMemoryAccountStore,
  LocalKeypairSigner,
  authenticate,
  fetchWebAuthConfig,
  loadConfig,
  resolveOrCreateAccount,
} from '../../src/index.js';
import {
  capturingFetch,
  horizonJson,
  parseStellarToml,
  randomTestMsisdn,
  stellarExpertTxUrl,
  type CapturedExchange,
} from './helpers.js';

const TEST_ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';

const enabled = process.env.RUN_TESTNET_E2E === '1';

describe.skipIf(!enabled)('live testnet SEP-10 authentication (Week 2)', () => {
  it('issues a JWT for an account with no client-side key, accepted by the anchor', async () => {
    if (existsSync('.env')) process.loadEnvFile('.env');

    // --- Anchor discovery: SEP-10 coordinates + SRT issuer, live over HTTPS ---
    const tomlFetchedAt = new Date().toISOString();
    const anchor = await fetchWebAuthConfig(TEST_ANCHOR_HOME_DOMAIN);
    expect(anchor.webAuthEndpoint).toMatch(/^https:\/\//);

    const tomlRes = await fetch(`https://${TEST_ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`);
    expect(tomlRes.ok).toBe(true);
    const toml = parseStellarToml(await tomlRes.text());
    const srt = toml.currencies.find((c) => c.code === 'SRT');
    expect(srt?.issuer).toMatch(/^G[A-Z2-7]{55}$/);
    expect(toml.transferServer, 'SEP-6 TRANSFER_SERVER must be declared').toBeTruthy();

    // --- Config and dependencies (Week 1 pattern) ---
    const config = loadConfig({ ...process.env, ASSET_ISSUER: srt!.issuer!, ASSET_CODE: 'SRT' });
    if (anchor.networkPassphrase) {
      expect(anchor.networkPassphrase).toBe(config.networkPassphrase);
    }
    const secret = process.env.SPONSOR_SECRET_KEY;
    expect(secret, 'Run `node scripts/setup-sponsor.mjs` and fill .env first').toBeTruthy();

    const signer = new LocalKeypairSigner();
    const sponsorPublicKey = signer.importSecret(secret!);
    const horizon = new Horizon.Server(config.horizonUrl);

    // --- Week 1 flow: a fresh account with no client-side key ---
    // This is the run's on-chain transaction; the SEP-10 exchange that
    // follows never touches the ledger.
    const msisdn = randomTestMsisdn();
    const resolved = await resolveOrCreateAccount(
      {
        store: new InMemoryAccountStore(),
        signer,
        horizon,
        networkPassphrase: config.networkPassphrase,
        sponsorPublicKey,
        asset: config.asset,
      },
      msisdn,
    );
    expect(resolved.created).toBe(true);
    const creationTx = await horizonJson(config.horizonUrl, `/transactions/${resolved.creationTxHash}`);
    expect(creationTx.successful).toBe(true);

    // --- SEP-10: challenge, verify, sign through the seam, token ---
    const authCaptures: CapturedExchange[] = [];
    const authenticatedAt = new Date().toISOString();
    const { token, claims } = await authenticate(
      {
        signer,
        networkPassphrase: config.networkPassphrase,
        anchor,
        fetchFn: capturingFetch(authCaptures),
      },
      resolved.accountId,
    );

    // Session and account scoping, on a real token: sub binds the account,
    // iat/exp bound the session window, iss names the anchor.
    expect(token.split('.')).toHaveLength(3);
    expect(claims.sub).toBe(resolved.accountId);
    expect(typeof claims.iat).toBe('number');
    expect(typeof claims.exp).toBe('number');
    expect(claims.exp!).toBeGreaterThan(claims.iat!);
    expect(claims.iss).toBeTruthy();
    expect(authCaptures.map((c) => `${c.method} ${c.status}`)).toEqual(['GET 200', 'POST 200']);

    // --- Exercise the JWT against an authenticated SEP-6 endpoint ---
    const sep6Captures: CapturedExchange[] = [];
    const sep6Fetch = capturingFetch(sep6Captures);
    const sep6Url = `${toml.transferServer}/transactions?asset_code=SRT&account=${resolved.accountId}`;

    const unauthenticated = await sep6Fetch(sep6Url, { method: 'GET' });
    // The refusal status is anchor-defined: 401 or 403 both mean "no valid
    // token". The actual status is recorded in the evidence, not assumed.
    expect([401, 403]).toContain(unauthenticated.status);

    const authenticated = await sep6Fetch(sep6Url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authenticated.status).toBe(200);
    const sep6Body = (await authenticated.clone().json()) as { transactions?: unknown };
    expect(Array.isArray(sep6Body.transactions)).toBe(true);

    // --- Persist raw evidence for EVIDENCE.md authoring (gitignored) ---
    mkdirSync('test-output', { recursive: true });
    const evidence = {
      ranAt: new Date().toISOString(),
      network: { horizonUrl: config.horizonUrl, networkPassphrase: config.networkPassphrase },
      anchor: { ...anchor, tomlFetchedAt, transferServer: toml.transferServer },
      msisdn,
      account: {
        accountId: resolved.accountId,
        creationTxHash: resolved.creationTxHash,
        creationTx,
      },
      sep10: { authenticatedAt, transcript: authCaptures, claims },
      sep6: {
        url: sep6Url,
        unauthenticatedStatus: unauthenticated.status,
        transcript: sep6Captures,
      },
    };
    writeFileSync('test-output/sep10-e2e-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);

    // --- Human-readable summary ---
    console.log('\n=== Week 2 live SEP-10 run ===');
    console.log(`Account (no client-side key): ${resolved.accountId}`);
    console.log(`Creation tx (Week 1 flow):    ${resolved.creationTxHash}`);
    console.log(`  ${stellarExpertTxUrl(resolved.creationTxHash!)}`);
    console.log(`Challenge GET:                ${authCaptures[0]?.status} at ${authCaptures[0]?.at}`);
    console.log(`Token POST:                   ${authCaptures[1]?.status} at ${authCaptures[1]?.at}`);
    console.log(`JWT sub:                      ${claims.sub}`);
    console.log(`JWT window:                   iat=${claims.iat} exp=${claims.exp}`);
    console.log(`SEP-6 without token:          HTTP ${unauthenticated.status}`);
    console.log(`SEP-6 with token:             HTTP ${authenticated.status}`);
    console.log('Raw evidence: test-output/sep10-e2e-evidence.json');
  });
});
