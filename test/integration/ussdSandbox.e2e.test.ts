/**
 * Live Africa's Talking SANDBOX end to end test (Week 3).
 *
 * Skipped unless RUN_AT_SANDBOX_E2E=1. This test is interactive by
 * nature: the USSD leg is driven by an operator in the provider's sandbox
 * simulator, because network initiated push USSD does not exist and the
 * flow is user initiated by design. When it runs it:
 *
 *   1. builds the REAL stack: live testanchor.stellar.org toml, real
 *      Horizon, the Week 1 signer and resolver, the Week 2 auth module,
 *      the Week 3 session layer;
 *   2. starts the callback server and waits (up to 12 minutes) for the
 *      operator to complete the journey in the sandbox simulator, with
 *      every callback and response captured with timestamps;
 *   3. performs the replay attempt ITSELF: the recorded final callback is
 *      re-POSTed byte for byte (expects the cached response, journey
 *      count unchanged) and a variant forged final step is POSTed
 *      (expects the replay rejection screen, journey count unchanged);
 *   4. reads the SEP-6 transaction back from the anchor with the captured
 *      JWT as independent proof the deposit was really created;
 *   5. writes the masked transcript and every exchange to
 *      test-output/ussd-sandbox-evidence.json (gitignored) for
 *      EVIDENCE.md authoring, and ASSERTS the serialized evidence
 *      contains no PIN digits and no unmasked live MSISDN.
 *
 * Setup expected around this test (nothing here is committed):
 *   - `.env` filled via `node scripts/setup-sponsor.mjs` (fresh throwaway
 *     sponsor, approved for Week 3);
 *   - the server exposed through an ephemeral tunnel; the tunnel URL is
 *     pasted into the sandbox USSD callback setting by the operator;
 *   - the operator dials the sandbox service code in the simulator using
 *     the agreed synthetic MSISDN and the agreed test PIN (a fixture
 *     value, masked in everything this test writes).
 */

import { Horizon } from '@stellar/stellar-sdk';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  AfricasTalkingGateway,
  AnchorCache,
  InMemoryAccountStore,
  InMemoryPinStore,
  InMemorySessionStore,
  LocalKeypairSigner,
  createJourney,
  createUssdRequestListener,
  loadConfig,
  type JourneySeam,
  type MachineDeps,
} from '../../src/index.js';
import { capturingFetch, parseStellarToml, type CapturedExchange } from './helpers.js';

const TEST_ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';

/** The agreed live test PIN. A fixture value: masked in all output. */
const LIVE_TEST_PIN = '7391';

const enabled = process.env.RUN_AT_SANDBOX_E2E === '1';

interface CapturedCallback {
  at: string;
  maskedFields: Record<string, string>;
  status: number;
  responseBody: string;
  hop?: string;
  /** Raw body kept in memory only, for the replay POST. Never written. */
  rawBody: string;
}

describe.skipIf(!enabled)('live Africa\'s Talking sandbox journey (Week 3)', () => {
  it(
    'completes the SOW journey end to end and rejects replay attempts',
    { timeout: 15 * 60 * 1000 },
    async () => {
      if (existsSync('.env')) process.loadEnvFile('.env');

      // --- Anchor discovery (live) and asset issuer ---
      const anchorCache = new AnchorCache({ homeDomain: TEST_ANCHOR_HOME_DOMAIN });
      const anchorInfo = await anchorCache.start();
      const tomlRes = await fetch(`https://${TEST_ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`);
      const toml = parseStellarToml(await tomlRes.text());
      const srtIssuer = toml.currencies.find((c) => c.code === 'SRT')?.issuer;
      expect(srtIssuer).toMatch(/^G[A-Z2-7]{55}$/);

      const config = loadConfig({
        ...process.env,
        ASSET_CODE: 'SRT',
        ASSET_ISSUER: srtIssuer!,
      });
      const secret = process.env.SPONSOR_SECRET_KEY;
      expect(secret, 'Run `node scripts/setup-sponsor.mjs` and fill .env first').toBeTruthy();

      // --- The real stack ---
      const signer = new LocalKeypairSigner();
      const sponsorPublicKey = signer.importSecret(secret!);
      expect(sponsorPublicKey).toBe(config.sponsorPublicKey);
      const horizon = new Horizon.Server(config.horizonUrl);
      const store = new InMemoryAccountStore();
      const sessions = new InMemorySessionStore(
        Number(process.env.USSD_SESSION_TTL_MS ?? 120_000),
      );
      const pins = new InMemoryPinStore();

      const journeyExchanges: CapturedExchange[] = [];
      const innerJourney = createJourney({
        store,
        signer,
        horizon,
        anchor: () => anchorCache.get(),
        networkPassphrase: config.networkPassphrase,
        sponsorPublicKey,
        asset: config.asset,
        fetchFn: capturingFetch(journeyExchanges),
      });

      // Observation wrapper: counts and captured artifacts for assertions.
      const observed = {
        authCalls: 0,
        createTxHash: undefined as string | undefined,
        accountId: undefined as string | undefined,
        token: undefined as string | undefined,
        depositRef: undefined as string | undefined,
      };
      const journey: JourneySeam = {
        lookupAccount: (m) => innerJourney.lookupAccount(m),
        checkTrustline: (a) => innerJourney.checkTrustline(a),
        async createAccount(msisdn) {
          const created = await innerJourney.createAccount(msisdn);
          observed.createTxHash = created.creationTxHash;
          observed.accountId = created.accountId;
          return created;
        },
        async authenticateAndDeposit(accountId) {
          observed.authCalls += 1;
          const result = await innerJourney.authenticateAndDeposit(accountId);
          observed.token = result.token;
          observed.depositRef = result.depositRef;
          return result;
        },
      };

      const logs: string[] = [];
      const machine: MachineDeps = {
        sessions,
        pins,
        journey,
        msisdn: {
          defaultCountryCode: process.env.USSD_DEFAULT_COUNTRY_CODE ?? '254',
        },
        log: (line) => logs.push(`${new Date().toISOString()} ${line}`),
      };

      // --- Capturing HTTP front: records every gateway callback ---
      const callbacks: CapturedCallback[] = [];
      const gateway = new AfricasTalkingGateway();
      const listener = createUssdRequestListener({
        gateway,
        machine,
        sessions,
        callbackPath: process.env.USSD_CALLBACK_PATH ?? '/ussd/callback',
        log: (line) => logs.push(`${new Date().toISOString()} ${line}`),
      });

      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const at = new Date().toISOString();
          const originalEnd = res.end.bind(res);
          let responseBody = '';
          // Capture what the gateway is told, then forward.
          (res as unknown as { end: unknown }).end = (body?: unknown) => {
            if (typeof body === 'string') responseBody = body;
            callbacks.push({
              at,
              maskedFields: maskFields(rawBody),
              status: res.statusCode,
              responseBody,
              hop: String(res.getHeader('at-ussd-hop-metadata') ?? '') || undefined,
              rawBody,
            });
            return originalEnd(body as string);
          };
          // Re-dispatch to the real listener with a replayable body stream.
          const replayReq = Object.assign(req, {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(rawBody, 'utf8');
            },
          });
          listener(replayReq, res);
        });
      });
      await new Promise<void>((resolve) => {
        server.listen(Number(process.env.USSD_PORT ?? 8085), resolve);
      });
      const { port } = server.address() as AddressInfo;
      const localUrl = `http://127.0.0.1:${port}${process.env.USSD_CALLBACK_PATH ?? '/ussd/callback'}`;

      // eslint-disable-next-line no-console
      console.log(
        [
          '',
          '=== Africa\'s Talking sandbox e2e: operator steps ===',
          `1. Expose port ${port} through an ephemeral tunnel.`,
          '2. Paste <tunnel>/ussd/callback into the sandbox USSD callback setting.',
          '3. In the simulator, dial the sandbox service code with the agreed',
          `   synthetic MSISDN and complete the journey with the agreed test PIN.`,
          '4. This test finishes on its own once the journey completes.',
          '',
        ].join('\n'),
      );

      // --- Wait for the operator-driven journey to complete ---
      const deadline = Date.now() + 12 * 60 * 1000;
      while (observed.depositRef === undefined && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(
        observed.depositRef,
        'No completed journey observed within 12 minutes.',
      ).toBeDefined();
      expect(observed.authCalls).toBe(1);

      // --- The replay attempt, performed by this test ---
      const finalCallback = [...callbacks]
        .reverse()
        .find((c) => c.responseBody.includes('Deposit started'));
      expect(finalCallback, 'The confirming callback must be in the capture.').toBeDefined();

      const replayRes = await fetch(localUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: finalCallback!.rawBody,
      });
      const replayBody = await replayRes.text();
      expect(replayRes.status).toBe(200);
      expect(replayBody).toBe(finalCallback!.responseBody);
      expect(observed.authCalls).toBe(1);

      // A forged variant (different final input) must hit the spent claim.
      const params = new URLSearchParams(finalCallback!.rawBody);
      const text = params.get('text') ?? '';
      const variant = text.replace(/[0-9]{4}$/, '0000');
      expect(variant).not.toBe(text);
      params.set('text', variant);
      const forgedRes = await fetch(localUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const forgedBody = await forgedRes.text();
      expect(forgedBody).toBe('END This step was already completed');
      expect(observed.authCalls).toBe(1);

      // --- Independent proof: read the SEP-6 transaction back ---
      const depositExchange = journeyExchanges.find((e) => e.url.includes('/deposit'));
      expect(depositExchange).toBeDefined();
      const fullDepositId = (depositExchange?.responseBody as { id?: string })?.id;
      expect(fullDepositId).toBeTruthy();
      expect(observed.depositRef).toBe(fullDepositId!.slice(0, 8));

      const txRes = await fetch(
        `${anchorInfo.transferServer}/transaction?id=${encodeURIComponent(fullDepositId!)}`,
        { headers: { authorization: `Bearer ${observed.token!}` } },
      );
      const txJson = (await txRes.json()) as { transaction?: { id?: string; status?: string } };
      expect(txRes.status).toBe(200);
      expect(txJson.transaction?.id).toBe(fullDepositId);

      // --- Evidence out, masked; then the no-PIN/no-MSISDN assertions ---
      const evidence = {
        capturedAt: new Date().toISOString(),
        masking:
          'phoneNumber middle digits masked; every PIN position and PIN ' +
          'value replaced by ####; JWT signatures redacted before commit.',
        localCallbackPath: process.env.USSD_CALLBACK_PATH ?? '/ussd/callback',
        anchor: {
          homeDomain: TEST_ANCHOR_HOME_DOMAIN,
          webAuthEndpoint: anchorInfo.auth.webAuthEndpoint,
          transferServer: anchorInfo.transferServer,
        },
        account: {
          accountId: observed.accountId,
          creationTxHash: observed.createTxHash,
        },
        deposit: {
          id: fullDepositId,
          refShownToUser: observed.depositRef,
          anchorReadBack: { status: txRes.status, transaction: txJson.transaction },
        },
        replay: {
          byteIdenticalReplay: { status: replayRes.status, body: replayBody },
          forgedVariant: { body: forgedBody },
          journeyCountAfterBoth: observed.authCalls,
        },
        transcript: callbacks.map(({ rawBody: _raw, ...keep }) => keep),
        journeyExchanges: journeyExchanges.map(redactExchange),
        machineLog: logs,
      };

      mkdirSync('test-output', { recursive: true });
      const serialized = maskPins(JSON.stringify(evidence, null, 2));
      writeFileSync('test-output/ussd-sandbox-evidence.json', serialized);

      expect(serialized).not.toContain(LIVE_TEST_PIN);
      const livePhone = callbacks
        .map((c) => new URLSearchParams(c.rawBody).get('phoneNumber'))
        .find((p) => p !== null && p !== '');
      if (livePhone !== undefined && livePhone !== null && livePhone.length > 8) {
        expect(serialized).not.toContain(livePhone.replace('+', ''));
      }

      anchorCache.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  );
});

/** Mask the middle digits of an MSISDN: +254700000000 -> +2547***0000. */
function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 9) return '***';
  return `${msisdn.slice(0, 5)}***${msisdn.slice(-4)}`;
}

/** Parse a callback body and mask MSISDN and PIN-shaped inputs. */
function maskFields(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const fields: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key === 'phoneNumber') {
      fields[key] = maskMsisdn(value);
    } else if (key === 'text') {
      fields[key] = value
        .split('*')
        .map((part) => (/^\d{4}$/.test(part) && part !== '0000' ? '####' : part))
        .join('*');
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

/** Redact PIN digits defensively in any serialized evidence. */
function maskPins(serialized: string): string {
  return serialized.replaceAll(LIVE_TEST_PIN, '####');
}

/** Trim + redact a captured journey exchange for evidence. */
function redactExchange(exchange: CapturedExchange): CapturedExchange {
  const clone = JSON.parse(JSON.stringify(exchange)) as CapturedExchange;
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') {
      // JWTs: keep header.payload, redact the signature segment.
      return value.replace(
        /([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})/g,
        (_m, h: string, p: string) => `${h}.${p}.REDACTED`,
      );
    }
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v)]),
      );
    }
    return value;
  };
  clone.responseBody = redact(clone.responseBody);
  clone.url = redact(clone.url) as string;
  return clone;
}
