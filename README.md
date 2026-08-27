# Stellar USSD SEP-10 Adapter

[![CI](https://github.com/saleempay/stellar-ussd-sep10-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/saleempay/stellar-ussd-sep10-adapter/actions/workflows/ci.yml)

A server-side SEP-10 authentication adapter that brings authenticated Stellar
anchor flows to USSD and SIM Toolkit sessions on feature phones.

**Reviewing this work?** Start at
[docs/instaward-evidence-package.md](docs/instaward-evidence-package.md).
It states what was delivered and gives a checklist where every row is a
link to click or one command to run, with the expected answer beside it.
No programming knowledge needed.

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

**Week 4 of 4, close out** (sprint started 10 August 2026, targeting a
first public release with a working USSD authentication flow against
Stellar testnet). All three build weeks are merged:

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
- **SEP-10 authentication** (Week 2): challenge request over HTTPS, full
  challenge verification before signing (a typed refusal names the failed
  check), signature through the signer seam, and JWT issuance. A live
  testnet run against testanchor.stellar.org, with the anchor accepting
  the JWT on an authenticated SEP-6 endpoint, is recorded in
  [EVIDENCE.md](EVIDENCE.md) with the full HTTP transcript.

- **USSD session layer** (Week 3): menu flow within the gateway
  character budget, PIN consent verified against an scrypt hash and never
  transmitted onward, a short lived session store whose atomic single use
  signing claim rejects replays, plain language error screens (timeout,
  missing trustline, auth refusal, lockout), and a thin gateway adapter
  seam with an Africa's Talking reference implementation, tested against
  the provider's sandbox. See
  [docs/integration-guide.md](docs/integration-guide.md) and
  [EVIDENCE.md](EVIDENCE.md).

- **Close out** (Week 4): the [evidence
  package](docs/instaward-evidence-package.md), the [demo video
  plan](docs/demo-video-plan.md), continuous integration on every pull
  request, and remediation of what testing surfaced.

The demo video recording is the one deliverable still outstanding; it is
an operator step and its plan is linked above. Everything targets
**testnet only**.

## Quickstart (testnet)

Requires Node.js ≥ 22.

```
git clone https://github.com/saleempay/stellar-ussd-sep10-adapter
cd stellar-ussd-sep10-adapter
npm install
npm test                          # offline unit tests

# Live testnet end-to-end: fund a throwaway sponsor account…
cp .env.example .env              # the template already lists every key
node scripts/setup-sponsor.mjs    # then fill in the two SPONSOR_ values in .env
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
