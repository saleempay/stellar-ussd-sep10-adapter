# Week 1 verification guide (for the Ambassador Chapter review)

This page is written for a non-technical reviewer. Every claim below can be
checked by clicking a link and comparing what you see against the stated
expected value, or by running one short command that is given in full.

## What Week 1 delivered

The Statement of Work says Week 1's expected output is: *"Accounts resolve
and are created on testnet from a phone number. Signer interface defined
and documented."* That is what exists on this branch: you give the software
a phone number, and it finds — or creates, live on the Stellar test
network — a Stellar account for that number, with the account's minimum
balances paid ("sponsored") by an operator account so the user account
itself needs no money. The component that signs transactions is defined as
a documented plug-in point ("signer interface"), with a clearly-labelled
demonstration implementation included so anyone can run the whole flow
without our infrastructure. The flow was run twice on 10 August 2026: once
during the build, and once again from a **fresh public download, following
only the written instructions** — proving a third party can reproduce it
without contacting Saleem.

## Checklist

All dates and times are UTC. "Expert link" means the stellar.expert block
explorer, an independent public viewer of the Stellar test network. The
last column maps each row to the evidence lines the SOW §6.1 lists for
Deliverable 1.

| # | What to check | How to check it | What you should see | SOW §6.1 line |
|---|---|---|---|---|
| 1 | The public repository and the Week 1 branch | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/tree/sprint1-week1-adapter-core> | A code repository named `stellar-ussd-sep10-adapter` with folders `src`, `test`, `docs`, files `EVIDENCE.md`, `README.md`, `LICENSE` | Public repository link |
| 2 | The MIT licence | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/blob/sprint1-week1-adapter-core/LICENSE> | First line "MIT License", second line "Copyright (c) 2026 5 Lanes Limited" | MIT-licensed repository |
| 3 | Commit history across the sprint | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/commits/sprint1-week1-adapter-core> | A series of commits dated from 10 August 2026 building up the Week 1 modules | Commit history across the sprint |
| 4 | Original account-creation transaction (build run) | Click <https://stellar.expert/explorer/testnet/tx/74370fe550d69d7b9e1b856e15192ed96f081ac1266fef35ba35fb60e45a5b66> | A successful transaction in ledger **4069925**, dated **10 August 2026 ≈14:02 UTC**, containing **4 operations** (begin sponsoring, create account, change trust, end sponsoring) | Transaction hashes showing account creation, viewable on stellar.expert |
| 5 | Original sponsor-funding transaction (build run) | Click <https://stellar.expert/explorer/testnet/tx/cd973d965f2100394090b83577577aa38362ddd1e8cc103216baf37f03687ed7> | A successful transaction in ledger **4069921**, dated **10 August 2026 ≈14:02 UTC**, funding the operator account with 10,000 test XLM | Transaction hashes, viewable on stellar.expert |
| 6 | Reproduction account-creation transaction (fresh public clone, docs only) | Click <https://stellar.expert/explorer/testnet/tx/42ad3dc030b834689608be9a3782d527037c794b58d3d900b619f4470c4601be> | A successful transaction in ledger **4070565**, dated **10 August 2026 ≈14:55 UTC**, with the same 4-operation shape as row 4 | Transaction hashes showing account creation, viewable on stellar.expert |
| 7 | Reproduction sponsor-funding transaction | Click <https://stellar.expert/explorer/testnet/tx/2421144573606e6db2713b0eb6bdb58771d01d24d8f4018ffac1b74f15a61760> | A successful transaction in ledger **4070557**, dated **10 August 2026 ≈14:55 UTC** | Transaction hashes, viewable on stellar.expert |
| 8 | The created user account holds no XLM but can hold the test asset | Click <https://stellar.expert/explorer/testnet/account/GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2> | An account with **0 XLM** balance and a trustline to asset **SRT** | Transaction hashes showing account creation (resulting account state) |
| 9 | The automated tests pass from a clean download | In a terminal: `git clone https://github.com/saleempay/stellar-ussd-sep10-adapter && cd stellar-ussd-sep10-adapter && git checkout sprint1-week1-adapter-core && npm install && npm test` (requires Node.js 22+) | A final line reporting **“Tests  49 passed \| 1 skipped (50)”** | MIT-licensed repository containing the adapter |
| 10 | The demonstration signer is clearly labelled not-for-production | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/blob/sprint1-week1-adapter-core/src/signer/localKeypairSigner.ts> | Near the top, a comment block headed "**⚠️ NOT FOR PRODUCTION**" | MIT-licensed repository containing the adapter |
| 11 | No private key exists anywhere in the repository | Plain-language explanation below this table; to re-run the check yourself, from the clone in row 9: `git grep -E 'S[A-Z2-7]{55}'` | The command prints **nothing** (no matches) | MIT-licensed repository containing the adapter |

**Row 11 explained in plain language.** Stellar private keys ("secret
seeds") always have the same shape: the letter `S` followed by exactly 55
more characters from a fixed alphabet. We searched every file in the
repository for anything of that shape and found none; the search command
above lets anyone repeat that check in seconds. We also confirmed the
repository's secrets file (`.env`) was never committed — only the empty
template `.env.example` exists, and the very first commit of the sprint
configured git to refuse `.env`. One transparency note: two intermediate
commits in the branch's *history* (not its current content) contained a
test string shaped like a secret key; it fails the Stellar checksum, so it
is not — and never was — a usable key. It is disclosed in the pull request
so the reviewer sees it named before finding it.

## What this week does not claim

Named here deliberately, so nothing is discovered as a gap later:

- **No USSD session yet.** The phone-menu layer (dialling a service code,
  PIN entry) is Week 3 scope and does not exist on this branch.
- **No anchor authentication yet.** The SEP-10 challenge/JWT flow — the
  headline of this Instaward — is Week 2 scope. The Week 1 run only
  *observed* that the test anchor's authentication endpoint is declared
  and responding (recorded in EVIDENCE.md); nothing was built against it.
  The SOW §6.1 line "a SEP-10 challenge signed and accepted on testnet" is
  therefore **not yet claimable** and is not claimed here.
- **No demo video yet.** That is Week 4 packaging scope.
- **Testnet only.** Nothing here has touched the main Stellar network, and
  mainnet operation is out of the sprint's scope entirely.
- **Reference signer only.** The included signer is a demonstration
  stand-in (row 10). Production signing infrastructure is explicitly out
  of the sprint's scope.

## Testnet reset note

The Stellar test network is wiped periodically. Per the schedule published
at <https://developers.stellar.org/docs/networks> (checked 10 August 2026,
re-checked 18 August 2026), the **next reset is 16 December 2026**, after
this sprint and its verification window. Resets are announced at least two
weeks ahead on the Stellar Dashboard (<https://dashboard.stellar.org>); as
of 18 August 2026 it shows no reset, only the testnet upgrade to Protocol 28
on 27 August 2026, which keeps all history and does not affect the links
above. If verification ever happens after a reset, the explorer links above
will stop resolving; for that case, `EVIDENCE.md` in this repository embeds
the raw ledger records (Horizon JSON) for every transaction and figure, so
the evidence remains inspectable from the repository alone, and
`npm run sponsor:recover` replays the flow on the reset network.
