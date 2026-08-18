#!/usr/bin/env node
/**
 * TESTNET-ONLY sponsor recovery and evidence replay.
 *
 * Testnet resets wipe every ledger entry, including the sponsor account and
 * every account it created. This script brings the sprint back to a
 * verifiable state in one run:
 *
 *   1. Sponsor keypair. Reuses SPONSOR_SECRET_KEY from the environment (or
 *      .env) when present, otherwise generates a fresh one.
 *   2. Funding. Asks friendbot to fund the sponsor if Horizon does not know
 *      the account yet; skips funding when the account already exists.
 *   3. Evidence replay. Reads the SRT issuer from the live
 *      testanchor.stellar.org stellar.toml, then runs the Week 1 flow for a
 *      fresh fictional MSISDN: sponsored account creation plus trustline in
 *      one transaction. Reads every claim back from Horizon and writes the
 *      capture to test-output/sponsor-recovery.json with stellar.expert
 *      links, so EVIDENCE.md can be re-authored from real ledger records.
 *   4. Optional: --github-env <name> stores the sponsor secret as a GitHub
 *      environment secret on this repository (SPONSOR_SECRET_KEY) and the
 *      public key as an environment variable (SPONSOR_PUBLIC_KEY), via the
 *      gh CLI. The secret travels over stdin, never argv, so it does not
 *      appear in a process listing. Requires `gh auth login` with repo
 *      admin. This is the interim home for the sponsor key until it can be
 *      migrated to a DFNS-managed wallet, at which point no raw secret
 *      exists anywhere and the MPC signer co-signs.
 *
 * The secret this script handles is a throwaway TESTNET credential for the
 * local reference signer. It is printed only when --print-env is passed,
 * and it is never written to disk by this script. A production deployment
 * holds no sponsor secret in the environment: its signing backend
 * implements the Signer interface.
 *
 * Usage:
 *   npm run build
 *   node scripts/recover-sponsor.mjs [--print-env] [--github-env testnet]
 *
 * Environment (all optional; testnet defaults apply):
 *   HORIZON_URL, NETWORK_PASSPHRASE, FRIENDBOT_URL, SPONSOR_SECRET_KEY
 */
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import {
  InMemoryAccountStore,
  LocalKeypairSigner,
  TESTNET_DEFAULTS,
  resolveOrCreateAccount,
} from '../dist/index.js';

const TEST_ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';
const REPO = 'saleempay/stellar-ussd-sep10-adapter';

// --- Arguments ---
const args = process.argv.slice(2);
const printEnv = args.includes('--print-env');
const githubEnvIndex = args.indexOf('--github-env');
const githubEnv = githubEnvIndex >= 0 ? args[githubEnvIndex + 1] : undefined;
if (githubEnvIndex >= 0 && !githubEnv) {
  console.error('--github-env requires an environment name, for example: --github-env testnet');
  process.exit(2);
}

if (existsSync('.env')) process.loadEnvFile('.env');
const horizonUrl = process.env.HORIZON_URL || TESTNET_DEFAULTS.horizonUrl;
const networkPassphrase = process.env.NETWORK_PASSPHRASE || TESTNET_DEFAULTS.networkPassphrase;
const friendbotUrl = process.env.FRIENDBOT_URL || TESTNET_DEFAULTS.friendbotUrl;

// --- 1. Sponsor keypair ---
let sponsor;
let sponsorSource;
if (process.env.SPONSOR_SECRET_KEY) {
  sponsor = Keypair.fromSecret(process.env.SPONSOR_SECRET_KEY.trim());
  sponsorSource = 'environment';
} else {
  sponsor = Keypair.random();
  sponsorSource = 'generated';
}
const sponsorPublicKey = sponsor.publicKey();
console.log(`Sponsor: ${sponsorPublicKey} (${sponsorSource})`);

// --- 2. Funding, only if Horizon does not know the account ---
const horizon = new Horizon.Server(horizonUrl);
let funding = null;
const exists = await accountExists(sponsorPublicKey);
if (exists) {
  console.log('Sponsor already exists on the network; skipping friendbot.');
} else {
  console.log('Sponsor not found on the network; requesting friendbot funding...');
  const res = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(sponsorPublicKey)}`);
  if (!res.ok) {
    console.error(`Friendbot funding failed: HTTP ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }
  const body = await res.json();
  funding = { hash: body.hash, ledger: body.ledger, url: stellarExpertTxUrl(body.hash) };
  console.log(`Funded. Friendbot tx: ${funding.hash}`);
  console.log(`  ${funding.url}`);
}

// --- 3. Evidence replay: Week 1 flow for a fresh fictional MSISDN ---
const tomlFetchedAt = new Date().toISOString();
const tomlRes = await fetch(`https://${TEST_ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`);
if (!tomlRes.ok) {
  console.error(`stellar.toml fetch failed: HTTP ${tomlRes.status}`);
  process.exit(1);
}
const srtIssuer = srtIssuerFromToml(await tomlRes.text());
if (!/^G[A-Z2-7]{55}$/.test(srtIssuer ?? '')) {
  console.error('SRT issuer not declared in the live stellar.toml; cannot replay the trustline.');
  process.exit(1);
}
const asset = { code: 'SRT', issuer: srtIssuer };

const signer = new LocalKeypairSigner();
signer.importSecret(sponsor.secret());
const deps = {
  store: new InMemoryAccountStore(),
  signer,
  horizon,
  networkPassphrase,
  sponsorPublicKey,
  asset,
};

const sponsorBefore = await horizonJson(`/accounts/${sponsorPublicKey}`);
const msisdn = randomTestMsisdn();
const first = await resolveOrCreateAccount(deps, msisdn);
const creationTx = await horizonJson(`/transactions/${first.creationTxHash}`);
const creationOps = await horizonJson(`/transactions/${first.creationTxHash}/operations`);
const newAccount = await horizonJson(`/accounts/${first.accountId}`);
const sponsorAfter = await horizonJson(`/accounts/${sponsorPublicKey}`);
const ledger = await horizonJson(`/ledgers/${creationTx.ledger}`);
const second = await resolveOrCreateAccount(deps, msisdn);

// --- Persist the capture (test-output/ is gitignored) ---
mkdirSync('test-output', { recursive: true });
const capture = {
  ranAt: new Date().toISOString(),
  network: { horizonUrl, networkPassphrase },
  sponsor: { publicKey: sponsorPublicKey, source: sponsorSource, funding },
  anchorToml: { homeDomain: TEST_ANCHOR_HOME_DOMAIN, fetchedAt: tomlFetchedAt, srtIssuer },
  msisdn,
  resolution: { first, second },
  raw: { creationTx, creationOps, newAccount, sponsorBefore, sponsorAfter, ledger },
};
writeFileSync('test-output/sponsor-recovery.json', `${JSON.stringify(capture, null, 2)}\n`);

// --- 4. Optional: store in a GitHub environment ---
let githubResult = null;
if (githubEnv) {
  githubResult = storeInGithubEnvironment(githubEnv, sponsorPublicKey, sponsor.secret());
}

// --- Summary ---
const native = (a) => a.balances.find((b) => b.asset_type === 'native')?.balance;
console.log('');
console.log('=== Sponsor recovery and evidence replay (testnet) ===');
console.log(`Sponsor:                    ${sponsorPublicKey}`);
if (funding) console.log(`Friendbot funding tx:       ${funding.hash}`);
console.log(`MSISDN (fictional):         ${msisdn}`);
console.log(`New account:                ${first.accountId}`);
console.log(`Creation tx:                ${first.creationTxHash}`);
console.log(`  ${stellarExpertTxUrl(first.creationTxHash)}`);
console.log(`Ledger ${creationTx.ledger}: base_reserve_in_stroops=${ledger.base_reserve_in_stroops}`);
console.log(`New account native balance: ${native(newAccount)} (num_sponsored=${newAccount.num_sponsored})`);
console.log(`Sponsor num_sponsoring:     ${sponsorBefore.num_sponsoring} -> ${sponsorAfter.num_sponsoring}`);
console.log(`Sponsor XLM:                ${native(sponsorBefore)} -> ${native(sponsorAfter)}`);
console.log(`Second resolution created:  ${second.created} (expected false)`);
if (githubResult) {
  console.log(`GitHub environment "${githubEnv}" on ${REPO}: SPONSOR_SECRET_KEY secret and SPONSOR_PUBLIC_KEY variable set.`);
}
console.log('Capture: test-output/sponsor-recovery.json');
if (printEnv) {
  console.log('');
  console.log('Add these lines to your local .env (NEVER commit .env):');
  console.log('');
  console.log(`SPONSOR_PUBLIC_KEY=${sponsorPublicKey}`);
  console.log(`SPONSOR_SECRET_KEY=${sponsor.secret()}`);
} else if (sponsorSource === 'generated' && !githubEnv) {
  console.log('');
  console.log('A new sponsor was generated but not stored anywhere. Re-run with --print-env');
  console.log('to see the .env lines, or --github-env <name> to store it on GitHub.');
}

// --- Helpers ---

async function accountExists(accountId) {
  const res = await fetch(`${horizonUrl}/accounts/${accountId}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon GET /accounts/${accountId} failed: HTTP ${res.status}`);
  return true;
}

async function horizonJson(path) {
  const res = await fetch(`${horizonUrl}${path}`);
  if (!res.ok) throw new Error(`Horizon GET ${path} failed: HTTP ${res.status}`);
  return res.json();
}

/** Minimal SEP-1 read: the issuer of the [[CURRENCIES]] block whose code is SRT. */
function srtIssuerFromToml(toml) {
  const blocks = toml.split(/^\[\[CURRENCIES\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\[/m)[0] ?? '';
    const code = /^code\s*=\s*"([^"]+)"/m.exec(body)?.[1];
    if (code === 'SRT') return /^issuer\s*=\s*"([^"]+)"/m.exec(body)?.[1];
  }
  return undefined;
}

/** A clearly fictional testnet MSISDN: +999 (unassigned country code) plus 8 random digits. */
function randomTestMsisdn() {
  const digits = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('');
  return `+999${digits}`;
}

function stellarExpertTxUrl(hash) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/**
 * Store the sponsor in a GitHub environment on this repository. Creates the
 * environment if it does not exist. The secret value is passed on stdin.
 */
function storeInGithubEnvironment(envName, publicKey, secret) {
  const run = (cmd, cmdArgs, input) => {
    const r = spawnSync(cmd, cmdArgs, { input, encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`${cmd} ${cmdArgs.join(' ')} failed:\n${r.stderr}`);
      process.exit(1);
    }
    return r.stdout;
  };
  run('gh', ['api', '--method', 'PUT', `repos/${REPO}/environments/${envName}`, '--silent']);
  run('gh', ['secret', 'set', 'SPONSOR_SECRET_KEY', '--repo', REPO, '--env', envName], secret);
  run('gh', ['variable', 'set', 'SPONSOR_PUBLIC_KEY', '--repo', REPO, '--env', envName, '--body', publicKey]);
  return { environment: envName, repo: REPO };
}
