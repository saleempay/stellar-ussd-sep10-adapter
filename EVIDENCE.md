# Evidence — Week 1 (Sprint 1, Instaward Application 1)

## What this file proves, in plain language

This file is the proof that Week 1's software really ran on the Stellar
test network on 10 August 2026: it created a Stellar account from a phone
number, with the account's minimum balances paid by a sponsor. Each claim
comes with a transaction link you can click (stellar.expert) and the
expected values to compare against, plus a copy of the underlying ledger
record so the proof survives even if the test network is later reset. A
non-technical reader needs only the links and the tables; the JSON blocks
exist so a technical reviewer can check every figure against the ledger.
For a click-through checklist version, see `docs/verification-week1.md`.

Every on-chain claim below was executed against **Stellar testnet** on
**10 August 2026** and is backed by a real transaction hash. Raw Horizon
JSON excerpts are embedded alongside each hash so the evidence remains
inspectable even if an explorer link dies. Nothing here is quoted from
documentation or memory: reserve figures were read from the ledger during
the run.

- Network: Stellar testnet (`https://horizon-testnet.stellar.org`,
  passphrase `Test SDF Network ; September 2015`)
- Produced by: `npm run test:e2e` (`test/integration/testnet.e2e.test.ts`),
  run completed `2026-08-10T14:02:28Z`
- Full raw capture: written to `test-output/e2e-evidence.json` during the
  run (local artifact, gitignored; the material excerpts are embedded below)

## Testnet reset window

Testnet resets clear all ledger entries, which would dead-link every hash
below on stellar.expert. Per the published schedule on
`https://developers.stellar.org/docs/networks` (retrieved 10 August 2026,
re-verified 18 August 2026): resets happen 2 to 4 times per year at
17:00 UTC, announced at least two weeks in advance on the Stellar Dashboard
(`https://dashboard.stellar.org`) and developer community channels, and
**the next scheduled 2026 reset is 16 December 2026**. On 18 August 2026
the Stellar Dashboard carried no testnet reset announcement; its only
scheduled-maintenance notice was the testnet **upgrade** to Protocol 28
(Adapter) on 27 August 2026 at 17:00 UTC (also on
`https://status.stellar.org`, posted 13 August 2026). A protocol upgrade
is not a reset: ledger history survives it, so every hash in this file
stays resolvable through 27 August. The sprint (ends 8 September 2026) and
its verification window fall safely before the December reset.

If a reset does happen before verification, `npm run sponsor:recover`
recreates a sponsor, funds it, and replays the transactions below against
the reset network (see `docs/sponsor-account.md`); the raw Horizon excerpts
embedded here remain the record of the 10 August run.

## Accounts used (testnet, throwaway)

| Role | Account |
|---|---|
| Sponsor (operator) | `GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6` |
| Created user account | `GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2` |
| MSISDN (fictional, +999 unassigned country code) | `+99979607777` |

## Transaction 1 — sponsor funding via friendbot

- Hash: `cd973d965f2100394090b83577577aa38362ddd1e8cc103216baf37f03687ed7`
- stellar.expert: <https://stellar.expert/explorer/testnet/tx/cd973d965f2100394090b83577577aa38362ddd1e8cc103216baf37f03687ed7>
- Raw Horizon excerpt (`/transactions/{hash}`, retrieved 2026-08-10):

```json
{
  "hash": "cd973d965f2100394090b83577577aa38362ddd1e8cc103216baf37f03687ed7",
  "ledger": 4069921,
  "successful": true,
  "source_account": "GDXDWI2JCI3YZW3WNQAKLZPE5QXEB2H4KGKIAIPPHSNHIYB6BGKDXZJ5",
  "created_at": "2026-08-10T14:02:06Z",
  "operation_count": 1,
  "fee_charged": "100"
}
```

Friendbot funded the sponsor with 10,000 XLM (standard testnet friendbot
amount, confirmed by the sponsor balance measured below).

## Transaction 2 — sponsored account creation + trustline (the Week 1 flow)

One transaction containing the full sponsorship sandwich:
`begin_sponsoring_future_reserves` → `create_account` (starting balance 0)
→ `change_trust` (source: new account) → `end_sponsoring_future_reserves`.

- Hash: `74370fe550d69d7b9e1b856e15192ed96f081ac1266fef35ba35fb60e45a5b66`
- stellar.expert: <https://stellar.expert/explorer/testnet/tx/74370fe550d69d7b9e1b856e15192ed96f081ac1266fef35ba35fb60e45a5b66>
- Raw Horizon excerpt (`/transactions/{hash}`):

```json
{
  "hash": "74370fe550d69d7b9e1b856e15192ed96f081ac1266fef35ba35fb60e45a5b66",
  "ledger": 4069925,
  "successful": true,
  "source_account": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6",
  "fee_charged": "400",
  "operation_count": 4,
  "created_at": "2026-08-10T14:02:26Z"
}
```

- Raw Horizon operations excerpt (`/transactions/{hash}/operations`):

```json
[
  { "id": "17480194772180993", "type": "begin_sponsoring_future_reserves",
    "source_account": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6",
    "sponsored_id": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2" },
  { "id": "17480194772180994", "type": "create_account",
    "funder": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6",
    "account": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2",
    "starting_balance": "0.0000000",
    "sponsor": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6" },
  { "id": "17480194772180995", "type": "change_trust",
    "source_account": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2",
    "trustor": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2",
    "asset_code": "SRT",
    "asset_issuer": "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B",
    "sponsor": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6" },
  { "id": "17480194772180996", "type": "end_sponsoring_future_reserves",
    "source_account": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2" }
]
```

After creation, the same MSISDN was resolved a second time and returned the
same account from the registry with no second on-chain creation
(`created: false` — asserted in the test run above).

## Measured reserve arithmetic

All figures read from chain during the run; none quoted from docs.

**Base reserve** — raw Horizon excerpt (`/ledgers/4069925`, the ledger the
creation transaction closed in):

```json
{
  "sequence": 4069925,
  "base_reserve_in_stroops": 5000000,
  "base_fee_in_stroops": 100,
  "closed_at": "2026-08-10T14:02:26Z"
}
```

Measured base reserve = **5,000,000 stroops = 0.5 XLM**.

**New account** — raw Horizon excerpt (`/accounts/GARRMR4I…2WC2`):

```json
{
  "id": "GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2",
  "num_sponsored": 3,
  "num_sponsoring": 0,
  "subentry_count": 1,
  "sponsor": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6",
  "last_modified_time": "2026-08-10T14:02:26Z",
  "balances": [
    { "asset_type": "credit_alphanum4", "asset_code": "SRT",
      "asset_issuer": "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B",
      "balance": "0.0000000",
      "sponsor": "GAPRGAFKUMBFYGC2GGU26UNLZMXWELUZABUW7P4DTF5XNNFIKPFNOMV6",
      "is_authorized": true, "last_modified_ledger": 4069925 },
    { "asset_type": "native", "balance": "0.0000000" }
  ]
}
```

**Sponsor before → after** — raw Horizon excerpts (`/accounts/GAPRGAFK…OMV6`):

```json
{ "before": { "num_sponsoring": 0, "subentry_count": 0, "native_balance": "10000.0000000" },
  "after":  { "num_sponsoring": 3, "subentry_count": 0, "native_balance": "9999.9999600" } }
```

**Derived from the measured values:**

| Quantity | Measured value | Backing evidence |
|---|---|---|
| Base reserve | 0.5 XLM (5,000,000 stroops) | ledger 4069925 excerpt above |
| XLM locked for the sponsored account (base, 2 × base reserve) | 1.0 XLM | `num_sponsored` includes 2 for the account; ledger base reserve |
| XLM locked for the trustline subentry (1 × base reserve) | 0.5 XLM | `subentry_count: 1`, sponsored `SRT` balance line; ledger base reserve |
| Total sponsored reserve per account+trustline | 1.5 XLM (3 × 0.5) | new account `num_sponsored: 3`; sponsor `num_sponsoring` 0 → 3 |
| Sponsor **balance** movement | −0.0000400 XLM | tx `fee_charged: "400"` stroops (4 ops × 100); balances above |
| New account native balance | 0 XLM | account excerpt above |

Note the mechanics the figures demonstrate: sponsoring moves **no XLM** to
the new account (its native balance is exactly 0; the sponsor's balance
dropped only by the 400-stroop fee). The 1.5 XLM is locked inside the
sponsor's own balance by raising its minimum-balance requirement
(`num_sponsoring: 3` × 0.5 XLM).

These are point-in-time **testnet** measurements. They are sprint evidence,
not confirmation of at-scale reserve economics — that confirmation (with
SDF) is a tracked open item outside this repository.

## Asset issuer provenance

The SRT issuer was read from the live
`https://testanchor.stellar.org/.well-known/stellar.toml` at
**2026-08-10T14:02:22Z** (not copied from any document):

```
SRT issuer: GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B
```

## Week 2 dependency smoke check (liveness observation only)

From the same stellar.toml retrieval, the SEP-10 endpoint is declared and
responds:

```json
{
  "endpoint": "https://testanchor.stellar.org/auth",
  "probedAt": "2026-08-10T14:02:23.588Z",
  "httpStatus": 400
}
```

HTTP 400 on a parameterless GET is the expected liveness signature: SEP-10
requires an `account` query parameter, so a 400 means the endpoint is
deployed and parsing requests. **Nothing was built against this endpoint in
Week 1** — this observation only de-risks the Week 2 dependency.

## Reproduction run — fresh public clone, documented steps only (10 Aug 2026)

The full flow was reproduced the same day from a **fresh clone of the
public repository, following only the documented quickstart** (no
knowledge outside the repo): `npm install` → `npm test` (49 passed) →
`node scripts/setup-sponsor.mjs` → `.env` per the printed lines →
`npm run test:e2e` (passed). This is independent confirmation that a third
party can run the flow without contacting Saleem. Fresh throwaway sponsor
`GAE5TCKWC6PSDJ2A6W2O4J5HU2ABJLEDWR5JTLW3VNKPXQ5AHS6FSMLP`, created
account `GBXMFTMYVIY4IXE5NFPMQTZ5QHCZHL5OZTAUTMWHQCHSXTPRNGAUFIZF`,
fictional MSISDN `+99953713825`.

- Reproduction creation tx:
  `42ad3dc030b834689608be9a3782d527037c794b58d3d900b619f4470c4601be`
  — <https://stellar.expert/explorer/testnet/tx/42ad3dc030b834689608be9a3782d527037c794b58d3d900b619f4470c4601be>
- Reproduction friendbot funding tx:
  `2421144573606e6db2713b0eb6bdb58771d01d24d8f4018ffac1b74f15a61760`
  — <https://stellar.expert/explorer/testnet/tx/2421144573606e6db2713b0eb6bdb58771d01d24d8f4018ffac1b74f15a61760>

Raw Horizon excerpts (retrieved 2026-08-10T14:56Z):

```json
{ "hash": "42ad3dc030b834689608be9a3782d527037c794b58d3d900b619f4470c4601be",
  "ledger": 4070565, "successful": true,
  "source_account": "GAE5TCKWC6PSDJ2A6W2O4J5HU2ABJLEDWR5JTLW3VNKPXQ5AHS6FSMLP",
  "fee_charged": "400", "operation_count": 4, "created_at": "2026-08-10T14:55:51Z" }
```

```json
{ "hash": "2421144573606e6db2713b0eb6bdb58771d01d24d8f4018ffac1b74f15a61760",
  "ledger": 4070557, "successful": true, "operation_count": 1,
  "fee_charged": "100", "created_at": "2026-08-10T14:55:11Z" }
```

```json
{ "id": "GBXMFTMYVIY4IXE5NFPMQTZ5QHCZHL5OZTAUTMWHQCHSXTPRNGAUFIZF",
  "num_sponsored": 3, "subentry_count": 1,
  "sponsor": "GAE5TCKWC6PSDJ2A6W2O4J5HU2ABJLEDWR5JTLW3VNKPXQ5AHS6FSMLP",
  "balances": [ { "asset": "SRT", "balance": "0.0000000" },
                { "asset": "native", "balance": "0.0000000" } ] }
```

The measured figures matched the original run exactly: base reserve
0.5 XLM (ledger 4070565), `num_sponsored: 3` (1.5 XLM sponsored),
sponsor balance moved only by the 400-stroop fee (10000.0000000 →
9999.9999600).

Re-verification of the **original** run's evidence was performed at
`2026-08-10T14:56:23Z`: both original transactions still return
`successful: true` from Horizon, both stellar.expert links resolve
(HTTP 200), and fresh Horizon reads of the original sponsor
(`num_sponsoring: 3`, balance `9999.9999600`) and original created account
(`num_sponsored: 3`, SRT trustline, 0 XLM) show **no drift** from the
figures recorded above.

## How to reproduce

```
npm install
node scripts/setup-sponsor.mjs   # fund a throwaway testnet sponsor
# copy the two printed lines into .env (never commit .env)
npm run test:e2e
```

Each run creates a fresh account for a fresh fictional MSISDN and prints
new hashes with stellar.expert links.

---

# Evidence: Week 2 (SEP-10 authentication)

## What this file section proves, in plain language

Week 2's software really authenticated with a live Stellar anchor on the
test network on 20 August 2026, for an account that holds no key material
on the client side. The anchor issued a session token (a JWT) for that
account and then accepted the token on a protected endpoint that had
refused the very same request moments earlier without it.

One thing needs saying plainly so it cannot confuse a reviewer. The
statement of work asks for "first testnet transaction hashes". A SEP-10
authentication challenge is a transaction that is deliberately built so it
CANNOT run on the network (its sequence number is zero), and it is never
submitted: it exists only to be signed and handed back. Authentication
therefore produces no on-chain hash by design. What this section provides
instead is (1) the complete, timestamped HTTP exchange with the anchor,
(2) the issued token with its signature removed, and (3) the on-chain hash
of the account creation this run performed first through the Week 1 flow,
which satisfies the "first testnet transaction hashes" wording literally.
Nothing here is fabricated; every block below was captured from the live
run.

- Network: Stellar testnet (`https://horizon-testnet.stellar.org`,
  passphrase `Test SDF Network ; September 2015`)
- Produced by: `RUN_TESTNET_E2E=1 npx vitest run test/integration/sep10.e2e.test.ts`
  (`test/integration/sep10.e2e.test.ts`), run completed `2026-08-20T00:46:33.773Z`
- Full raw capture: written to `test-output/sep10-e2e-evidence.json` during
  the run (local artifact, gitignored; the material excerpts are embedded
  below with one redaction, stated where it appears)
- Protocol note: this run predates the testnet upgrade to Protocol 28
  scheduled for 27 August 2026. Per the SDK's v17 release notes the
  Protocol 28 changes touch only Soroban authorization credentials, not
  the classic transactions SEP-10 uses; a post-upgrade re-verification run
  is scheduled as part of Week 3/4 work, not this session.

## Accounts used (testnet, throwaway; fresh sponsor for Week 2)

| Role | Account |
|---|---|
| Sponsor (operator) | `GDF7F2NVNZS5WHBX2OYBUPR4ST3CLRSD2ZHXDVOERM2BSRBJSHRPCU6O` |
| Created user account (no client-side key) | `GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM` |
| MSISDN (fictional, +999 unassigned country code) | `+99990910369` |

The Week 1 sponsor account remains on testnet; its throwaway secret lived
only in a wiped local environment, so Week 2 bootstrapped a fresh sponsor
with `scripts/setup-sponsor.mjs` (friendbot funding tx
`74c6cb42253be0a3321f78917af2abee33fdcf6db1b085957cd17cd340f3e116`).

## Anchor coordinates (read live from stellar.toml over HTTPS)

Fetched from `https://testanchor.stellar.org/.well-known/stellar.toml` at
`2026-08-20T00:46:27.817Z`:

| Field | Value |
|---|---|
| WEB_AUTH_ENDPOINT | `https://testanchor.stellar.org/auth` |
| SIGNING_KEY | `GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR` |
| NETWORK_PASSPHRASE | `Test SDF Network ; September 2015` |
| TRANSFER_SERVER (SEP-6) | `https://testanchor.stellar.org/sep6` |

## On-chain transaction: account creation via the Week 1 flow

This run's on-chain transaction (the SEP-10 exchange that follows touches
no ledger). The usual sponsorship sandwich, four operations.

- Hash: `b3de5978fef48e3991b780821ce48a5ef4d5e49566cd52a3f1f71c9f3657990e`
- stellar.expert: <https://stellar.expert/explorer/testnet/tx/b3de5978fef48e3991b780821ce48a5ef4d5e49566cd52a3f1f71c9f3657990e>
- Raw Horizon excerpt (`/transactions/{hash}`, retrieved during the run):

```json
{
  "hash": "b3de5978fef48e3991b780821ce48a5ef4d5e49566cd52a3f1f71c9f3657990e",
  "ledger": 4232903,
  "successful": true,
  "created_at": "2026-08-20T00:46:31Z",
  "operation_count": 4,
  "fee_charged": "400"
}
```

## SEP-10 exchange 1: challenge request (GET)

- Request: `GET https://testanchor.stellar.org/auth?account=GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM&home_domain=testanchor.stellar.org`
- Response: HTTP 200 at `2026-08-20T00:46:32.657Z`
- Response `network_passphrase`: `Test SDF Network ; September 2015`
  (matches the configured network)
- Response `transaction` (the challenge, base64 XDR, embedded in full: it
  is safe to publish because its sequence number is zero, so it can never
  execute on any network):

```
AAAAAgAAAACOs4wuUbSbMTAM1yX25vNd8kro1MEFZuK9rh7ZGr+trQAAAMgAAAAAAAAAAAAAAAEAAAAAaoZOaAAAAABqhlHsAAAAAAAAAAIAAAABAAAAAAGy/iDOsQKQCHQPRsrwCeXGXCUmd4Lgucvb12ac5i/CAAAACgAAABt0ZXN0YW5jaG9yLnN0ZWxsYXIub3JnIGF1dGgAAAAAAQAAAEBLNmZ2RkFTUEtOeU03RTRqUzVvc0JCazJUNzUvdmswY0lrNHVaMzQvc2Z3d0lEQlZhN0FWbHJFOGVtVmN0Z1pGAAAAAQAAAACOs4wuUbSbMTAM1yX25vNd8kro1MEFZuK9rh7ZGr+trQAAAAoAAAAPd2ViX2F1dGhfZG9tYWluAAAAAAEAAAAWdGVzdGFuY2hvci5zdGVsbGFyLm9yZwAAAAAAAAAAAAEav62tAAAAQKtjHjrZ8vu6hgr8NHLaiugVe0KMOIZXkam8OOEPi6EUMC1gJE1+dUMN5U3Q6DQ+HggLHt4FwhchyBHCtsXHcw0=
```

Decoded, this challenge is: source = the anchor's SIGNING_KEY, sequence 0,
timebounds `2026-08-20T00:46:32Z` to `2026-08-20T01:01:32Z`, operation 1 =
`manage_data` named `testanchor.stellar.org auth` sourced by the user
account with a 48 byte nonce, operation 2 = `manage_data` named
`web_auth_domain` valued `testanchor.stellar.org` sourced by the anchor,
one signature (the anchor's). The adapter verified all of that (plus the
anchor's signature validity under the testnet passphrase) before signing:
see `src/auth/verify.ts` and the failedCheck contract in the integration
guide.

## SEP-10 exchange 2: signed challenge (POST) and token response

- Request: `POST https://testanchor.stellar.org/auth` with JSON body
  `{"transaction": "<signed challenge XDR>"}`. The signed challenge as
  POSTed (now carrying TWO signatures: the anchor's original plus the user
  account's, added through the signer seam):

```
AAAAAgAAAACOs4wuUbSbMTAM1yX25vNd8kro1MEFZuK9rh7ZGr+trQAAAMgAAAAAAAAAAAAAAAEAAAAAaoZOaAAAAABqhlHsAAAAAAAAAAIAAAABAAAAAAGy/iDOsQKQCHQPRsrwCeXGXCUmd4Lgucvb12ac5i/CAAAACgAAABt0ZXN0YW5jaG9yLnN0ZWxsYXIub3JnIGF1dGgAAAAAAQAAAEBLNmZ2RkFTUEtOeU03RTRqUzVvc0JCazJUNzUvdmswY0lrNHVaMzQvc2Z3d0lEQlZhN0FWbHJFOGVtVmN0Z1pGAAAAAQAAAACOs4wuUbSbMTAM1yX25vNd8kro1MEFZuK9rh7ZGr+trQAAAAoAAAAPd2ViX2F1dGhfZG9tYWluAAAAAAEAAAAWdGVzdGFuY2hvci5zdGVsbGFyLm9yZwAAAAAAAAAAAAIav62tAAAAQKtjHjrZ8vu6hgr8NHLaiugVe0KMOIZXkam8OOEPi6EUMC1gJE1+dUMN5U3Q6DQ+HggLHt4FwhchyBHCtsXHcw2c5i/CAAAAQM0NhEyBsQqVGm+b70zqGHzGEa4abJSkobgzAu1Wuz9GSP7XcDBN1/O3xf15s9GrLIr19OIzj8+fuBISlM07zwY=
```

- Response: HTTP 200 at `2026-08-20T00:46:32.980Z` with `{"token": "<JWT>"}`.
- The issued JWT, with its third segment (the signature) REDACTED before
  committing, per the sprint's evidence rules; the full token was a live
  24 hour bearer credential at capture time and lives only in the
  gitignored raw capture:

```
eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiI2MjlmYjcwMTBiODY1NDM1NWU1OTMzODNiOTU2MDNhNzkxMzdjMjdkMmVmMjU4OWM0YmE2MzUwYjlmYWYzZWZhIiwiaXNzIjoiaHR0cHM6Ly90ZXN0YW5jaG9yLnN0ZWxsYXIub3JnL2F1dGgiLCJzdWIiOiJHQUEzRjdSQVoyWVFGRUFJT1FIVU5TWFFCSFM0TVhCRkVaM1lGWUZaWlBONU9aVTQ0WVg0RUFGTSIsImlhdCI6MTc4NzE4Njc5MiwiZXhwIjoxNzg3MjczMTkyLCJhdWQiOlsic2VwMTAiXSwiaG9tZV9kb21haW4iOiJ0ZXN0YW5jaG9yLnN0ZWxsYXIub3JnIn0.[SIGNATURE REDACTED]
```

- The decoded claims (the session and account scoping the statement of
  work names): `sub` binds the token to exactly the created account,
  `iat`/`exp` bound the session window, `iss` names the anchor.

```json
{
  "jti": "629fb7010b8654355e593383b95603a79137c27d2ef2589c4ba6350b9faf3efa",
  "iss": "https://testanchor.stellar.org/auth",
  "sub": "GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM",
  "iat": 1787186792,
  "exp": 1787273192,
  "aud": ["sep10"],
  "home_domain": "testanchor.stellar.org"
}
```

`iat` decodes to `2026-08-20T00:46:32Z` and `exp` to
`2026-08-21T00:46:32Z` (a 24 hour session window chosen by the anchor).

## The anchor accepts the token: authenticated SEP-6 exchange

The same request to the anchor's SEP-6 transactions endpoint, made twice
seconds apart, first without the token and then with it:

| Leg | Authorization header | Status | Body |
|---|---|---|---|
| 1 (at `2026-08-20T00:46:33.255Z`) | none | HTTP 403 | `{"error": "forbidden"}` |
| 2 (at `2026-08-20T00:46:33.513Z`) | `Bearer <the JWT above>` | HTTP 200 | `{"transactions": []}` |

- URL (both legs): `https://testanchor.stellar.org/sep6/transactions?asset_code=SRT&account=GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM`
- The refusal status is anchor-defined (SEP-10 aware endpoints answer 401
  or 403); the e2e accepts either and records the actual, which was 403.
- The empty transactions list is correct: the account is brand new and has
  no SEP-6 history. What matters is the contrast: refused without the
  token, answered with it.

## How to reproduce (Week 2)

```
npm install
node scripts/setup-sponsor.mjs   # fund a throwaway testnet sponsor
# copy the two printed lines into .env (never commit .env)
RUN_TESTNET_E2E=1 npx vitest run test/integration/sep10.e2e.test.ts --no-file-parallelism
```

Each run creates a fresh account, authenticates it, and prints the
exchange statuses; `npm run test:e2e` runs the Week 1 and Week 2 live
tests together.
