# Week 2 verification guide (for the Ambassador Chapter review)

This page is written for a non-technical reviewer, in the same format as
`docs/verification-week1.md`. Every claim below can be checked by clicking
a link and comparing what you see against the stated expected value, or by
running one short command that is given in full.

## What Week 2 delivered

The Statement of Work says Week 2's scope is: *"SEP-10 challenge request,
signature orchestration through the signer interface, JWT issuance,
validation against the anchor, session and account scoping"*, with the
expected output: *"A SEP-10 JWT is issued and accepted by the anchor for
an account with no client-side key. First testnet transaction hashes."*

That is what exists on this branch. On 20 August 2026 the software created
a Stellar account from a phone number (the account itself holds no key
material on any client device), asked the Stellar test anchor for an
authentication challenge, checked that challenge thoroughly before signing
it, signed it through the plug-in signer component, and received a session
token (a JWT) from the anchor. It then proved the anchor honors the token:
the same protected request was refused without the token and answered with
it, seconds apart.

**One wording in the SOW needs a plain explanation.** A SEP-10 challenge
is a transaction built so it CANNOT run on the network (its sequence
number is zero) and it is never submitted, so authentication itself
produces no on-chain transaction hash, by design of the standard. The
"first testnet transaction hashes" line is satisfied by the on-chain
account creation this run performs first (row 3 below), and the
authentication is evidenced the only honest way it can be: the complete
recorded HTTP conversation with the anchor, embedded in `EVIDENCE.md`.

## Checklist

All dates and times are UTC. "Expert link" means the stellar.expert block
explorer, an independent public viewer of the Stellar test network. The
last column maps each row to the evidence lines the SOW §6.1 lists for
Deliverable 1.

| # | What to check | How to check it | What you should see | SOW §6.1 line |
|---|---|---|---|---|
| 1 | The Week 2 code as merged | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/tree/b33734f> | The repository with a new `src/auth` folder (`toml.ts`, `challenge.ts`, `verify.ts`, `token.ts`, `authenticate.ts`) | Public repository link |
| 2 | Commit history across the sprint | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/pull/4/commits> | Week 2 commits dated 20 August 2026 building up the auth modules, on top of the merged Week 1 | Commit history across the sprint |
| 3 | This run's on-chain transaction: account creation for the account that was then authenticated | Click <https://stellar.expert/explorer/testnet/tx/b3de5978fef48e3991b780821ce48a5ef4d5e49566cd52a3f1f71c9f3657990e> | A successful transaction in ledger **4232903**, dated **20 August 2026 ≈00:46 UTC**, containing **4 operations** | Transaction hashes, viewable on stellar.expert |
| 4 | Sponsor-funding transaction (fresh Week 2 throwaway sponsor) | Click <https://stellar.expert/explorer/testnet/tx/74c6cb42253be0a3321f78917af2abee33fdcf6db1b085957cd17cd340f3e116> | A successful transaction in ledger **4232899**, dated **20 August 2026 ≈00:46 UTC**, funding the operator account with 10,000 test XLM | Transaction hashes, viewable on stellar.expert |
| 5 | The authenticated account holds no XLM and no key material on any client | Click <https://stellar.expert/explorer/testnet/account/GAA3F7RAZ2YQFEAIOQHUNSXQBHS4MXBFEZ3YFYFZZPN5OZU44YX4EAFM> | An account with **0 XLM** balance and a trustline to asset **SRT** | A SEP-10 JWT issued for an account with no client-side key |
| 6 | The anchor issued a JWT scoped to exactly that account | In `EVIDENCE.md`, Week 2 section, "signed challenge (POST) and token response": compare the decoded claims block | `"sub"` equals the account from row 5; `"iss"` is `https://testanchor.stellar.org/auth`; the token's signature segment is marked `[SIGNATURE REDACTED]` with the redaction explained beside it | A SEP-10 challenge signed and accepted on testnet |
| 7 | The anchor accepts the token where it refused without it | In `EVIDENCE.md`, Week 2 section, "The anchor accepts the token": read the two-leg table | The same URL answered **HTTP 403** with no token and **HTTP 200** with it, timestamps seconds apart on 20 August 2026 | A SEP-10 challenge signed and accepted on testnet |
| 8 | The automated tests pass from a clean download | In a terminal: `git clone https://github.com/saleempay/stellar-ussd-sep10-adapter && cd stellar-ussd-sep10-adapter && git checkout b33734f && npm install && npm test` (requires Node.js 22+) | A final line reporting **"Tests  135 passed \| 2 skipped (137)"** | MIT-licensed repository containing the adapter |
| 9 | The software refuses tampered challenges | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/blob/b33734f/test/unit/authVerify.test.ts> | A test for every refusal: wrong signer, nonzero sequence, expired time window, wrong network, missing signature, wrong account, and more | MIT-licensed repository containing the adapter |
| 10 | No private key exists anywhere in the repository | From the clone in row 8: `git grep -E 'S[A-Z2-7]{55}'` | The command prints **nothing** (no matches) | MIT-licensed repository containing the adapter |

## Why these links point at commit numbers (updated 27 August 2026)

As on the Week 1 page: the Week 2 working branch was deleted when the work
merged, so the links now point at `b33734f`, the permanent commit number
under which Week 2 was merged. Commit numbers are never deleted, so these
links keep working.

Row 8's expected test count was corrected from 117 to 137 for the same
reason as Week 1: the figure was written before the review round added
tests. It was re-run at `b33734f` on 27 August 2026 to confirm.

## What this week does not claim

Named here deliberately, so nothing is discovered as a gap later:

- **No USSD session yet.** The phone-menu layer (dialling a service code,
  PIN entry and consent) is Week 3 scope and does not exist on this
  branch. The adapter authenticates an account when asked to; who asks,
  and how the user consents, is the session layer.
- **The token is not stored anywhere.** By a settled design ruling the
  adapter hands the JWT to its caller and keeps nothing; session custody
  is Week 3 scope.
- **No client_domain (wallet attribution).** Documented as an extension
  point in the integration guide, deliberately not implemented.
- **No demo video yet.** That is Week 4 packaging scope.
- **Testnet only, reference signer only.** As in Week 1: nothing has
  touched the main Stellar network, and the included signer is a
  demonstration stand-in. Production signing infrastructure is out of the
  sprint's scope.

## Protocol 28 note

The Stellar test network upgrades to Protocol 28 on 27 August 2026, after
this run. The SDK publisher's release notes for the Protocol 28 line show
the changes touch only smart-contract authorization, not the classic
transactions SEP-10 uses, so no impact is expected; a re-verification run
after the upgrade is scheduled as part of Week 3/4 work and its result
will be recorded in `EVIDENCE.md` when it happens.

## Testnet reset note

As in Week 1: the next scheduled testnet reset is 16 December 2026, after
the sprint and its verification window. If verification ever happens after
a reset, the explorer links above stop resolving; `EVIDENCE.md` embeds the
raw ledger records and the full anchor conversation, so the evidence
remains inspectable from the repository alone.
