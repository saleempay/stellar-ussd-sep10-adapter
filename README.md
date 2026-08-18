# Stellar USSD SEP-10 Adapter

A server-side SEP-10 authentication adapter that brings authenticated Stellar
anchor flows to USSD and SIM Toolkit sessions on feature phones.

## The problem

SEP-10 authenticates a client by having it sign a challenge transaction with
the account's own key. The specification assumes a client that holds key
material and can perform Ed25519 signing.

A USSD client holds nothing. It is a stateless menu rendered by the mobile
network, with a session measured in seconds and a strict character budget.
Because every anchor operation defined by SEP-6 and SEP-24 requires a SEP-10
token, the entire anchor surface of Stellar is unreachable from these devices.

Across MENA and South Asia there are roughly 496 million adults in the markets 
this serves, including about 231 million with no bank account and no smartphone.

## The approach

The adapter completes the SEP-10 challenge and response on behalf of a
session-based client:

1. The mobile network opens a session and presents the MSISDN.
2. The adapter resolves the MSISDN to a Stellar account, creating one with
   sponsored reserves if none exists.
3. The adapter requests a SEP-10 challenge from the anchor.
4. The user consents with a PIN, verified against a hash.
5. A signer co-signs the challenge transaction.
6. The anchor validates the signed challenge and issues a SEP-10 JWT.
7. The JWT authorises deposit, withdrawal, and balance operations for the
   remainder of the session.

No private key or seed phrase exists on the handset. The signer is defined
behind an interface, so adopters can use any signing backend.

## Status

**Week 1 of 4 delivered** (sprint started 10 August 2026, targeting a first
public release with a working USSD authentication flow against Stellar
testnet):

- MSISDN → Stellar account resolution behind a pluggable registry
  (in-memory and JSON-file reference stores)
- Account creation with **sponsored reserves** — the user account holds
  0 XLM; measured reserve costs are recorded in [EVIDENCE.md](EVIDENCE.md)
  with verifiable testnet transaction hashes
- Trustline establishment inside the same sponsored transaction, with a
  typed missing-trustline error for callers
- The **signer interface** defined and documented, with a local reference
  implementation (clearly marked NOT FOR PRODUCTION) so the flow verifies
  from a clean clone — see [docs/integration-guide.md](docs/integration-guide.md)

Not yet built (later sprint weeks): the SEP-10 challenge/JWT flow (Week 2)
and the USSD session layer with PIN consent (Week 3). Everything targets
**testnet only**.

## Quickstart (testnet)

Requires Node.js ≥ 22.

```
git clone https://github.com/saleempay/stellar-ussd-sep10-adapter
cd stellar-ussd-sep10-adapter
npm install
npm test                          # offline unit tests

# Live testnet end-to-end: fund a throwaway sponsor account…
node scripts/setup-sponsor.mjs
cp .env.example .env              # then paste the two printed SPONSOR_* lines
# …and run the flow: resolve a phone number, create the account with
# sponsored reserves, establish the trustline, print tx hashes:
npm run test:e2e
```

The e2e run prints stellar.expert links for every transaction it submits.
`.env` is gitignored — never commit it.

If the testnet has been reset since the evidence in `EVIDENCE.md` was
recorded, `npm run sponsor:recover` recreates and funds a sponsor and
replays the Week 1 transactions in one step. See `docs/sponsor-account.md`
for the sponsor account of record and where its key lives.

## Licence

MIT. See LICENSE.

## Maintainer

5 Lanes Limited (trading as Saleem), ADGM-registered, Abu Dhabi, UAE.
https://www.saleem.digital
