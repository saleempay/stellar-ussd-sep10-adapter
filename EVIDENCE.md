# Evidence — Week 1 (Sprint 1, Instaward Application 1)

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
`developers.stellar.org/docs/learn/fundamentals/networks` (retrieved
10 August 2026): resets happen 2–4 times per year at 17:00 UTC, announced
at least two weeks in advance, and **the next scheduled 2026 reset is
16 December 2026**. The sprint (ends 8 September 2026) and its
verification window fall safely before that date.

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

## How to reproduce

```
npm install
node scripts/setup-sponsor.mjs   # fund a throwaway testnet sponsor
# copy the two printed lines into .env (never commit .env)
npm run test:e2e
```

Each run creates a fresh account for a fresh fictional MSISDN and prints
new hashes with stellar.expert links.
