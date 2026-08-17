# Integration guide

> Status: Week 1 of a 4-week build. This guide currently covers the
> adapter core surface delivered in Week 1 — MSISDN resolution, sponsored
> account creation, trustline establishment, and the signer interface. The
> SEP-10 challenge/JWT flow (Week 2) and the USSD session layer (Week 3)
> will extend it.

This library is a public reference implementation. It is designed to be
adopted without contacting the maintainer, and everything you need to run
it on testnet is in this repository.

## Architecture in one paragraph

A USSD client holds no key material, so this adapter does the account-side
work server-side: it resolves an MSISDN (phone number) to a Stellar
account through a pluggable registry, creates the account on first contact
with **sponsored reserves** (the user account holds 0 XLM; the operator
account locks the reserves), establishes a trustline to the configured
asset in the same transaction, and obtains every required signature
through a **pluggable signer interface** so that no key material ever
touches this codebase.

## The resolver is bookkeeping; the signer boundary owns keys

This split is deliberate and load-bearing:

- The **resolver** (`MsisdnResolver` + your `AccountStore`) is pure
  bookkeeping: a persistent mapping from canonical MSISDN to account ID.
  There is **no function from a phone number to key material anywhere in
  this design**.
- The **signer boundary** (`Signer`) owns key generation and signing. In
  production that is infrastructure where keys are generated and used
  inside a protected boundary (MPC, HSM, or equivalent); in this
  repository it is a local reference implementation that is **not for
  production**.
- **Deterministic derivation of key material from phone numbers is
  excluded as a design class, not merely discouraged.** That includes
  plain hashing, salted hashing, and HMAC under a server key. The MSISDN
  space is small enough to enumerate, so plain or salted hashing lets
  anyone link phone numbers to accounts (or worse, recompute keys); and a
  keyed-derivation server secret becomes an unrotatable master key whose
  leak is equivalent to custody of every user's funds. Do not "optimize"
  the registry away by deriving accounts — you would be re-introducing the
  design this library exists to rule out.

## Supplying your own store

Implement `AccountStore` (three async methods: `get`, `put`, `delete`)
over your database and pass it wherever the adapter takes a store.

Warnings that apply to any store implementation:

- The store is **authoritative**. Losing it orphans accounts: funds remain
  on-chain, but the phone-number linkage is gone. Back it up before you
  put value behind it.
- Store contents link phone numbers to on-chain accounts. That linkage is
  personal data — protect the store like a KYC database, not like a cache.
- The bundled `InMemoryAccountStore` (primary reference) loses everything
  on restart; it exists so a clean clone runs with zero infrastructure.
  `JsonFileAccountStore` persists to a JSON file with zero native
  dependencies but is single-process/single-node. Neither is a production
  store.
- `JsonFileAccountStore` is atomic against concurrent readers
  (write-temp-then-rename) but not crash-durable: there is no `fsync`
  before the rename, so a host crash can leave a truncated or empty file
  on some filesystems, and its synchronous writes block the event loop.
  Production deployments need a durable store. This matters concretely
  because a lost mapping after account creation is exactly the
  reconciliation scenario surfaced by `RegistrationFailedError` (below).
- The reference flow records a mapping only **after** on-chain creation
  succeeds, so a failed submission never leaves a dangling entry. The
  reverse failure is also possible: if the store write fails after the
  account was created, the account exists on-chain with sponsored reserves
  and no mapping. That case is surfaced as a typed
  `RegistrationFailedError` (`code: "REGISTRATION_FAILED"`) carrying the
  created `accountId`, the MSISDN, and the store error, so an operator can
  reconcile (record the mapping manually or reclaim the sponsorship)
  rather than lose the account. Log this error's fields, do not swallow it.
- If two sessions race to create an account for the same MSISDN, the
  reference store is last-write-wins; implement put-if-absent semantics
  in your store if that race matters in your deployment.

## Supplying your own signer

Implement `Signer` over your signing backend and pass it to the adapter.
The contract is deliberately narrow:

- `createAccountKey()` — generate a keypair inside your backend, return
  only the public key.
- `canSignFor(accountId)` — capability check.
- `signTransaction(xdrBase64, { networkPassphrase, accountId })` — base64
  XDR in, signed base64 XDR out.

Key material never crosses the boundary in either direction, so any
backend that can produce an Ed25519 signature over a Stellar transaction
hash fits: MPC platforms, HSMs, or a remote co-signing service. This
repository imports no vendor SDK; the seam is the interface itself.

The bundled `LocalKeypairSigner` is **NOT FOR PRODUCTION**: it holds
plaintext secrets in process memory and exists solely so the flow can be
verified from a clean clone. Its `importSecret` method (used to load the
testnet sponsor) is exactly the thing a real signing backend must never
expose.

## MSISDN input: strict E.164, and who owns country codes

The library boundary accepts **canonical E.164 only**: `+` followed by
8–15 digits (formatting noise like spaces and dashes is tolerated and
stripped). Anything else — including national format — is rejected with a
typed `InvalidMsisdnError`.

**If you are building a session layer, read this paragraph.** Commercial
USSD gateways commonly deliver MSISDNs in **national format without a
leading `+`** (for example `0501234567`). This library will reject that
input by design, because converting national format to E.164 requires
knowing the country, and **country-code inference is the caller's
responsibility** — your session layer knows which network and country a
session arrived from; a library does not. Normalize to E.164 (using the
gateway's country/network metadata) before calling the adapter. This is a
documented contract, not a bug to be discovered in integration testing.

## Sponsored reserves: what the operator pays

Measured on testnet during the Week 1 build (see `EVIDENCE.md` for the
backing hashes and raw Horizon JSON): with a base reserve of 0.5 XLM, each
created account locks 1.5 XLM of the sponsor's balance (2 × base reserve
for the account + 1 × base reserve for the trustline subentry) via the
sponsor's minimum-balance requirement, plus the transaction fee. No XLM is
transferred to the user account — it holds exactly 0 XLM and is fully
usable for the configured asset.

Fund the operator account accordingly: sponsoring N users locks
approximately N × 1.5 XLM (at current reserves) that you cannot spend
while the sponsorships exist.

## Trustlines and the missing-trustline error

Accounts are created with the configured trustline in the same
transaction, so the normal path never sees a missing trustline. For
accounts that predate a config change (or if you create bare accounts),
`addSponsoredTrustline` retrofits a sponsored trustline, and
`assertTrustline` is the preflight you call before any operation that
moves the asset. Both the preflight and the submission decoder surface the
condition as the same typed `TrustlineMissingError` (`code:
"TRUSTLINE_MISSING"`), so handle one error type and you have covered both
paths. Branch on `error.code` / `instanceof`, never on message text.

A related case: calling `assertTrustline` (or any account load) for an
account that does not exist on the network, for example an MSISDN whose
account was never created, surfaces as `AccountNotFoundError` (`code:
"ACCOUNT_NOT_FOUND"`, carrying the missing `accountId`) rather than a raw
Horizon 404. A missing sponsor account (misconfigured `SPONSOR_PUBLIC_KEY`)
maps the same way, and the `accountId` field tells you which account was
missing.

## Known limitations, documented for adopters, out of sprint scope

These are deliberate simplifications of the reference implementation. A
production deployment must address them; the sprint does not.

- **Sponsor sequence contention.** One sponsor account is the source of
  every creation transaction, so creations are serialized on its sequence
  number: two creations submitted concurrently from the same sponsor
  collide (`tx_bad_seq`) and one must be retried. This is fine for the
  sprint's demonstration volume. The scaling path is channel accounts (a
  pool of fee-and-sequence source accounts, with the sponsor as an
  operation-level source), which is not implemented here.
- **Fee strategy.** Transactions are built with `BASE_FEE`, the network
  minimum (100 stroops per operation, so 400 for the four-operation
  sponsorship sandwich, matching the figure measured in `EVIDENCE.md`).
  Under surge pricing, submissions at the minimum fail with
  `tx_insufficient_fee`, and there is no retry or fee bump in this
  implementation. A production deployment needs a fee strategy: bump the
  fee and resubmit, or wrap the transaction in a fee-bump transaction from
  the sponsor.

## Testnet quickstart

See the README quickstart. Everything in this repository targets testnet
only; mainnet operation is out of scope and unvalidated.
