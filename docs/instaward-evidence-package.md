# Instaward evidence package

**Stellar USSD SEP-10 Adapter · Sprint 1 · 10 August to 8 September 2026**

This is the single document to review. It states what was funded, what was
built, and how to check every claim for yourself. No programming knowledge
is needed: every row below is either a link to click or one command to
copy, with the answer you should get written next to it.

If you only have ten minutes, read the summary, then work down the
checklist. If a row does not show what this page says it will, that is a
problem worth raising, and it should be raised.

---

## In one paragraph

The Instaward funded a piece of open source infrastructure that lets a
basic feature phone use Stellar anchor services. Stellar's authentication
standard, SEP-10, assumes the user's device holds a cryptographic key and
can sign with it. A USSD phone, the kind that shows a numbered text menu
when you dial a short code, holds nothing at all: it is a menu drawn by
the mobile network, gone in seconds. Because every anchor operation
requires a SEP-10 token, that entire side of Stellar was unreachable from
these phones. This project built the missing piece: a server side adapter
that completes the authentication on the phone's behalf, with the user
consenting by PIN, and no key material anywhere on the handset. It was
built over four weeks, it is public under the MIT licence, and it has been
run end to end against Stellar's public test network and a commercial USSD
gateway, with the transaction records and the full conversation with the
anchor kept as evidence.

## The repository and the licence

| | |
|---|---|
| Repository | <https://github.com/saleempay/stellar-ussd-sep10-adapter> |
| Licence | MIT, <https://github.com/saleempay/stellar-ussd-sep10-adapter/blob/main/LICENSE> |
| Maintainer | 5 Lanes Limited (trading as Saleem), ADGM registered, Abu Dhabi, UAE |
| Network | Stellar testnet only |

---

## The Statement of Work deliverables, and what satisfies each

The three build weeks each carry an expected output in the Statement of
Work. They are quoted here word for word, each followed by what satisfies
it and where to look.

### Deliverable 1: accounts from a phone number, and a signer boundary

> "Accounts resolve and are created on testnet from a phone number.
> Signer interface defined and documented."

**Satisfied by** the resolver and sponsored account creation modules. Give
the software a phone number and it finds, or creates on the live test
network, a Stellar account for that number. The account's minimum balances
are paid by an operator account, so the user's own account needs no money
and holds none. The component that signs is a documented plug in point,
with a demonstration implementation included and clearly marked not for
production.

**Where to look:** checklist rows 5, 6, 7, 8 below.
Detail: [verification-week1.md](verification-week1.md).

### Deliverable 2: a SEP-10 token for an account with no key on the device

> "A SEP-10 JWT is issued and accepted by the anchor for an account with
> no client-side key. First testnet transaction hashes."

**Satisfied by** the authentication modules. The software asks the anchor
for a challenge, checks it thoroughly before signing anything, signs it
through the plug in signer, and receives a session token. It then proves
the anchor honours that token: the same protected request is refused
without it and answered with it, seconds apart.

One point of plain explanation. A SEP-10 challenge is deliberately built
so it cannot run on the network, and it is never submitted, so
authentication itself produces no transaction hash. That is the standard
working as designed, not something missing. The "first testnet transaction
hashes" line is carried by the account creation that happens first, and
the authentication is evidenced the only honest way it can be: the
complete recorded conversation with the anchor.

**Where to look:** checklist rows 9, 10, 11 below.
Detail: [verification-week2.md](verification-week2.md).

### Deliverable 3: a live USSD session, end to end, replays refused

> "A live USSD session authenticates end to end and completes an anchor
> operation. Replay attempts rejected."

**Satisfied by** the USSD session layer, run against a commercial gateway's
sandbox. A real session dialled a service code, set and then entered a
PIN, created an account on chain, authenticated with the anchor, and
started an anchor operation, all inside the gateway's timing window. The
final step was then sent again byte for byte, and a tampered version was
sent too. Neither produced a second signature.

**Where to look:** checklist rows 12, 13, 14, 15 below.
Detail: [verification-week3.md](verification-week3.md).

### Week 4: packaging

> "Repository publication under MIT, integration guide, demo video
> recording, evidence package assembly, and remediation of anything found
> in testing."

**Satisfied by** this document, the [integration
guide](integration-guide.md), the [demo video
plan](demo-video-plan.md), the continuous integration workflow, and the
remediation commits described under "What changed in week 4" below.

---

## The checklist

Everything is UTC. "Explorer" means stellar.expert, an independent public
viewer of the Stellar test network that we do not control.

| # | The claim | How to check it | What you should see |
|---|---|---|---|
| 1 | The repository is public and real | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter> | A repository named `stellar-ussd-sep10-adapter` with folders `src`, `test`, `docs` and files `EVIDENCE.md`, `README.md`, `LICENSE` |
| 2 | It is MIT licensed | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/blob/main/LICENSE> | First line "MIT License", second line "Copyright (c) 2026 5 Lanes Limited" |
| 3 | The work happened across the sprint, not in one push | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/commits/main> | Commits dated from 10 August 2026 onward, in four blocks matching the four weeks |
| 4 | The tests pass, checked automatically | Click <https://github.com/saleempay/stellar-ussd-sep10-adapter/actions/workflows/ci.yml> | A list of runs with green ticks. Open the newest and see install, typecheck and test steps all passing |
| 5 | Week 1: an account was created on the test network | Click <https://stellar.expert/explorer/testnet/tx/74370fe550d69d7b9e1b856e15192ed96f081ac1266fef35ba35fb60e45a5b66> | A successful transaction in ledger **4069925**, dated **10 August 2026 at 14:02 UTC**, containing **4 operations** |
| 6 | Someone else can reproduce it from the public repository alone | Click <https://stellar.expert/explorer/testnet/tx/42ad3dc030b834689608be9a3782d527037c794b58d3d900b619f4470c4601be> | A second successful transaction, ledger **4070565**, **10 August 2026 at 14:55 UTC**, same 4 operation shape. This one was produced from a fresh public download following only the written instructions |
| 7 | The user's account holds no money and cost the user nothing | Click <https://stellar.expert/explorer/testnet/account/GARRMR4I5M4FZXRP7D55PB7K3SXUSGJOQN32CMEJFUKMAKNGLYU42WC2> | An account with **0 XLM** and a trustline to the test asset **SRT** |
| 8 | No key exists on any user device, and none is in the repository | In a terminal, from a clone: `git grep -E 'S[A-Z2-7]{55}'` | The command prints **nothing**. Stellar secret keys always start with S and are exactly 56 characters, so this finds any that exist |
| 9 | Week 2: the account that was authenticated was created on chain | Click <https://stellar.expert/explorer/testnet/tx/b3de5978fef48e3991b780821ce48a5ef4d5e49566cd52a3f1f71c9f3657990e> | A successful transaction in ledger **4232903**, **20 August 2026 at 00:46 UTC**, 4 operations |
| 10 | The anchor issued a token scoped to exactly that account | Open [EVIDENCE.md](../EVIDENCE.md), Week 2 section, "signed challenge (POST) and token response" | The decoded token's `sub` equals the account in row 9, and `iss` is `https://testanchor.stellar.org/auth`. The signature is marked `[SIGNATURE REDACTED]`, with the reason given beside it |
| 11 | The anchor really honours the token | Open [EVIDENCE.md](../EVIDENCE.md), Week 2 section, "The anchor accepts the token" | The same URL answered **HTTP 403** without the token and **HTTP 200** with it, timestamps seconds apart |
| 12 | Week 3: a real USSD session ran on a commercial gateway | Open [EVIDENCE.md](../EVIDENCE.md), Week 3 section, "The live session transcript" | A timestamped transcript of three real sessions. PIN digits appear only as `####`, and the phone number is masked. Two sessions timed out and are kept because they really happened |
| 13 | That session created an account on chain | Click <https://stellar.expert/explorer/testnet/tx/ae18582eb28446096fa129cbc77d1f5ef70dcc7d322f512a2e77e5e634db72ce> | A successful transaction in ledger **4299047**, **23 August 2026 at 20:49 UTC**, 4 operations |
| 14 | The session completed an anchor operation, confirmed by the anchor itself | Open [EVIDENCE.md](../EVIDENCE.md), Week 3 section, "The anchor operation" | The anchor returned a deposit record and, read back separately with the token, reported it with status `incomplete`. That is the anchor confirming a deposit was started and not funded, which is correct: no funds move in this project |
| 15 | Replay attempts were refused | Open [EVIDENCE.md](../EVIDENCE.md), Week 3 section, "Replay attempts rejected" | The final step re-sent byte for byte returned the identical cached screen and re-ran nothing; a tampered version returned "This step was already completed". The authentication count stayed at **1** in both cases |
| 16 | The software still works after Stellar's Protocol 28 upgrade | Open [EVIDENCE.md](../EVIDENCE.md), Week 4 section, "Did anything change under Protocol 28?" | A thirteen row table comparing before and after, every row reading "no". The test network upgraded on 27 August 2026 and the same software, unchanged, produced identical results |
| 17 | That claim rests on a transaction in an upgraded ledger, not on timing | Click <https://stellar.expert/explorer/testnet/tx/1f254c6075ed2df67ed47d10b0bc00e52ad8b63b69c3813f79f511a350fcbff6> | A successful transaction in ledger **4365303**, **27 August 2026 at 17:01 UTC**, 4 operations, created after the upgrade took effect at 17:00:57 UTC |
| 18 | The phone journey still works after the upgrade, replays still refused | Open [EVIDENCE.md](../EVIDENCE.md), "Week 3 USSD journey re-run under Protocol 28" | A masked transcript of two real sessions on 28 August 2026 ending in `Verified by the anchor. Test only, no funds move`, the anchor's own record of the deposit read back, and both replay attempts refused with the authentication count still **1** |
| 19 | The whole test suite passes from a clean download | In a terminal: `git clone https://github.com/saleempay/stellar-ussd-sep10-adapter && cd stellar-ussd-sep10-adapter && npm install && npm test` (needs Node.js 22 or newer) | A final line reporting **352 passed, 3 skipped**. The 3 skipped are the live network tests, which are off by default because they spend a funded account |

---

## The demo video

The video shows the journey in rows 12 to 15 as a viewer would experience
it: dialling the code, the menu, the PIN, the confirmation, and then the
replay being refused.

**Pointer:** _to be filled in when the recording is made._ The shot list,
the narration points, and the recording preconditions are written up in
[demo-video-plan.md](demo-video-plan.md). That plan is deliberately strict
about showing only screens the software actually produces.

---

## What changed in week 4

Week 4 is packaging and remediation. Nothing in the adapter's behaviour
changed. For completeness:

- Links in the Week 1 and Week 2 checklists pointed at working branches
  that were deleted when the work was merged, so several returned "page
  not found". They now point at permanent commit numbers.
- Two expected test counts in those checklists were out of date, because
  the build lead's review added tests after the pages were written. They
  now match what the command prints.
- A continuous integration workflow was added, so the tests are checked
  automatically on every change (row 4). This is the same fact row 16
  gives you, without needing a terminal.
- The quickstart instructions produced a configuration file with
  duplicated entries if followed literally. Reworded.
- The dependency install script allowlist was reviewed and kept, and the
  one remaining warning on a fresh install was closed.
- The Stellar test network upgraded to Protocol 28 on 27 August 2026. The
  evidence file had promised in writing that the live flows would be run
  again afterwards and the result stated plainly either way. They were,
  and nothing changed (rows 16 and 17). The full phone journey was then
  re-run on the upgraded network on 28 August and behaved identically,
  replay refusals included.
- The confirmation screen used to read "Deposit started". On testnet,
  against a deposit the anchor itself reports as incomplete, that
  overstated what happens, so it was changed to say plainly that nothing
  moved. The Week 3 transcript keeps the old wording because that is what
  the software rendered that day; the difference is intended and is noted
  in the evidence file.

## Verification of this document

Every link and every transaction hash printed in this document was
checked against the live services at assembly time.

**Checked on 27 August 2026, extended 28 August 2026.** All 19 rows
resolve.

- Every link in this document was followed and returned a page, with the
  single exception named below.
- The **5 transaction hashes** this document links to were each fetched
  from Horizon, the Stellar network's public API, and each returned a
  successful transaction matching the ledger number and date printed here.
- The **1 account** this document links to returned a zero balance with
  the SRT trustline present, as stated.
- Going wider than this document: `EVIDENCE.md` contains **14** strings of
  the shape a transaction hash takes. **13 are transactions and all 13
  were fetched and confirmed successful.** The fourteenth,
  `629fb701...`, is not a transaction hash at all: it is the identifier
  inside the Week 2 session token, and it is quoted there as part of the
  decoded token rather than as a network record.

One deliberate exception: `https://testanchor.stellar.org/auth` answers
HTTP 400 when opened in a browser with no parameters. That is the correct
response from an authentication endpoint asked for nothing, and it is how
the evidence records it. It means the endpoint is alive.

Links can rot. The Stellar test network is also wiped periodically, and
the next scheduled wipe is 16 December 2026, after this review window. If
you are reading this after a wipe and the explorer links no longer
resolve, `EVIDENCE.md` embeds the raw network records for every figure
quoted, so the evidence remains inspectable from the repository alone.

## Reconciliation against the Statement of Work

The three weekly checklists were reconciled against the evidence lines the
Statement of Work lists. Every line has at least one row that satisfies
it:

| Statement of Work evidence line | Satisfied by |
|---|---|
| Public repository link | Row 1 |
| MIT licensed repository containing the adapter | Rows 2, 8, 19 |
| Commit history across the sprint | Row 3 |
| Transaction hashes showing account creation, viewable on stellar.expert | Rows 5, 6, 9, 13, 17 |
| A SEP-10 challenge signed and accepted on testnet | Rows 10, 11 |
| A SEP-10 JWT issued for an account with no client-side key | Rows 7, 10 |

**The reconciliation found two gaps. One is closed, one remains open.**

1. **Open: the demo video is not yet recorded.** It is a Week 4
   deliverable and the only item in this package without evidence behind
   it. The plan is written and the recording is an operator step. Until it
   exists, this package is complete on every other line and incomplete on
   that one. The journey it will show was re-run successfully on the
   upgraded network on 28 August 2026 and is recorded in
   [EVIDENCE.md](../EVIDENCE.md), so the recording is the only step left.
2. **Closed: the Week 3 checklist now carries its clause mapping.** Week 1
   and Week 2 cite the clause each row satisfies in a final column and
   Week 3 did not. The evidence was present and mapped; only the citation
   was missing. A mapping table was added to
   [verification-week3.md](verification-week3.md) on 27 August 2026.

One note on sourcing, for accuracy. The Statement of Work document itself
is not held in this repository. The deliverable wording quoted above is
quoted from the weekly verification guides, which quoted it from the
Statement of Work when they were written. Before submission, the exact
deliverable numbering should be confirmed against the signed document.

---

## What this package does not claim

Named deliberately, so nothing is discovered later as a surprise.

- **Testnet only.** Nothing here has touched the live Stellar network.
  Mainnet operation is outside the scope of this work entirely.
- **No funds move.** Not in any test, not in the demo, not at any point.
  The one deposit that was started is reported by the anchor as
  `incomplete`, which is exactly what a deposit that was initiated and
  never funded should say.
- **The signer is a reference implementation.** It is included so anyone
  can run the whole flow without our infrastructure, and it is marked not
  for production in its own source file. Production signing infrastructure
  was not in scope and was not built.
- **The gateway is a sandbox.** The USSD testing ran against a commercial
  provider's sandbox environment, not a live telco shortcode with real
  subscribers.
- **The anchor is not ours.** It is a Stellar Development Foundation test
  anchor. We make no claim about it beyond what it returned to us.
- **This is not a product.** It is a piece of open source infrastructure
  and a demonstration that the approach works. It is not a deployed
  service and it has no users.
