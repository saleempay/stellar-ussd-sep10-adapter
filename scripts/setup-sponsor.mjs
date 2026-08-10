#!/usr/bin/env node
/**
 * TESTNET-ONLY sponsor bootstrap.
 *
 * Generates a fresh keypair for the operator (sponsor) account and funds it
 * via friendbot. Prints the .env lines to copy into your local .env file —
 * it never writes .env itself and nothing it produces may be committed.
 *
 * The secret printed here is a throwaway TESTNET credential for the local
 * reference signer. A production deployment has no sponsor secret in the
 * environment at all: its signing backend implements the Signer interface.
 *
 * Usage: node scripts/setup-sponsor.mjs
 */
import { Keypair } from '@stellar/stellar-sdk';
import { mkdirSync, writeFileSync } from 'node:fs';

const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';

const kp = Keypair.random();
console.log('Generated testnet sponsor keypair. Requesting friendbot funding...');

const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`);
if (!res.ok) {
  console.error(`Friendbot funding failed: HTTP ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}
const funding = await res.json();

// Keep the raw friendbot response (contains the funding tx hash) as local
// evidence. test-output/ is gitignored.
mkdirSync('test-output', { recursive: true });
writeFileSync(
  'test-output/sponsor-funding.json',
  `${JSON.stringify({ fundedAt: new Date().toISOString(), publicKey: kp.publicKey(), friendbotResponse: funding }, null, 2)}\n`,
);

console.log('');
console.log(`Funded. Friendbot tx hash: ${funding.hash}`);
console.log(`  https://stellar.expert/explorer/testnet/tx/${funding.hash}`);
console.log('');
console.log('Add these lines to your local .env (NEVER commit .env):');
console.log('');
console.log(`SPONSOR_PUBLIC_KEY=${kp.publicKey()}`);
console.log(`SPONSOR_SECRET_KEY=${kp.secret()}`);
