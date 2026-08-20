# Integration guide

> Status: Week 2 of a 4-week build. This guide covers the adapter core
> surface delivered in Week 1 (MSISDN resolution, sponsored account
> creation, trustline establishment, the signer interface) and the SEP-10
> authentication flow delivered in Week 2 (challenge request, verification
> before signing, signature orchestration, JWT issuance). The USSD session
> layer (Week 3) will extend it.

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

## SEP-10 authentication: challenge, verify, sign, token

Week 2 adds the authentication flow: obtain a SEP-10 JWT from an anchor
for an account that holds no client-side key, with every signature going
through the same `Signer` seam Week 1 defined.

```ts
import { authenticate, fetchWebAuthConfig } from 'stellar-ussd-sep10-adapter';

const anchor = await fetchWebAuthConfig('testanchor.stellar.org');
const { token, claims } = await authenticate(
  { signer, networkPassphrase, anchor },
  accountId,
);
// token: the anchor's JWT, use it as `Authorization: Bearer <token>`
// claims: the decoded payload (iss, sub, iat, exp, ...)
```

What `authenticate` does, in order: a `canSignFor` preflight (a signer
that cannot sign for the account fails fast with `SignerUnavailableError`
and no anchor round-trip), a challenge GET, full verification of the
challenge (next section), exactly one signature through the signer seam,
a token POST, a claims decode, and a scope check on the issued token. The
challenge transaction has sequence number zero and is never submitted to
the network; it exists only to be signed and handed back.

### The adapter stores nothing (a settled ruling)

`authenticate` returns the token and its decoded claims to the caller and
keeps no copy: no token cache, no session state. Custody of the token
across a USSD session is the session layer's concern (Week 3). "Session
and account scoping" is carried by the claims themselves: `sub` binds the
token to one account, `iat` and `exp` bound the session window, `iss`
names the anchor. A caller holding a token re-checks it before each use
with the pure helper:

```ts
import { assertTokenScope } from 'stellar-ussd-sep10-adapter';
assertTokenScope(claims, accountId); // throws TokenScopeError on mismatch or expiry
```

### Challenge verification and the failedCheck contract

The adapter refuses to sign a challenge that fails any check, throwing a
typed `ChallengeValidationError` (`code: "CHALLENGE_INVALID"`) whose
`failedCheck` field names the first check that failed. **The names below
are a stable public contract**: the Week 3 session layer (and your code)
can branch on them, so a shipped name is never renamed or removed. Each
named check is explicit adapter code; the SDK's own
`WebAuth.readChallengeTx` then runs as an authoritative final gate.

| failedCheck | The challenge was refused because |
|---|---|
| `deserialization` | it is not a decodable classic transaction (fee-bump envelopes included) |
| `sequence_not_zero` | its sequence number is not 0, so it could execute on the network |
| `source_not_server` | its source account is not the anchor's toml `SIGNING_KEY` |
| `no_operations` | it contains no operations |
| `first_op_source_missing` | the first operation names no source, so there is no client account |
| `first_op_not_manage_data` | the first operation is not `manage_data` |
| `home_domain_mismatch` | the first operation's key is not `"<home domain> auth"` for the expected home domain |
| `timebounds_missing` | it has no finite timebounds |
| `timebounds_expired` | the current time is outside its timebounds window (300 second grace each side, matching the SDK) |
| `nonce_invalid` | the first operation's value is not a base64 encoding of 48 random bytes |
| `extra_op_invalid` | a subsequent operation is not `manage_data`, or is not sourced by the server account (`client_domain` excepted) |
| `web_auth_domain_mismatch` | a `web_auth_domain` operation does not name the auth endpoint's host |
| `server_signature_invalid` | the anchor's signature is absent or invalid under the configured network passphrase (a wrong network fails here too) |
| `network_passphrase_mismatch` | the challenge response declared a `network_passphrase` that is not the configured one (checked before parsing) |
| `client_account_mismatch` | it names a client account other than the one we asked to authenticate |
| `unexpected_memo` | it carries a memo, and this adapter never requests one |
| `sdk_validation` | the SDK's `WebAuth.readChallengeTx` refused it for a reason not named above (defense in depth) |

Two more typed errors complete the auth taxonomy:
`WebAuthRequestFailedError` (`code: "WEB_AUTH_REQUEST_FAILED"`, with
`phase` "challenge" or "token", the HTTP status, and the anchor's `error`
string verbatim) for a failed HTTP exchange, and `TokenScopeError`
(`code: "TOKEN_SCOPE_MISMATCH"`) for a token whose claims do not scope it
to the expected account or that has expired. As everywhere in this
library: branch on `code` / `instanceof` / `failedCheck`, never on
message text.

### Security notes

- **HTTPS only, pinned.** The stellar.toml is resolved with the SDK's
  `StellarToml.Resolver` at its default posture (plain HTTP refused), a
  discovered `WEB_AUTH_ENDPOINT` that is not `https://` is refused at
  config-build time, and the challenge leg refuses non-https endpoints
  again as defense in depth. There is no option to allow plain HTTP on the
  auth path. This invariant is asserted by unit tests.
- **The anchor's SIGNING_KEY comes from the toml, nothing else.** The
  challenge's source account and signature are verified against the key
  the anchor publishes at its own HTTPS domain, fetched fresh; the adapter
  never accepts a signing key from the challenge itself.
- **JWTs are decoded, not verified.** The token is the anchor's own
  bearer credential: the anchor verifies it on every authenticated call,
  and clients hold no verification key for it. Treat the decoded claims
  as the anchor's assertion, not as independently proven. Protect the
  token like a password for its lifetime (`exp`).
- **Clock skew.** The timebounds check tolerates 300 seconds of skew each
  side, matching the SDK's own reader. Hosts with worse clock drift will
  see `timebounds_expired` refusals; fix the clock, not the check.

### client_domain: a documented extension point, not implemented

SEP-10 optionally lets a client application prove its own identity in
addition to the account's, by sending `client_domain` on the challenge
request and co-signing the challenge with the `SIGNING_KEY` published on
that domain's stellar.toml. This adapter authenticates plainly and does
not implement it: `requestChallenge` never sends the parameter, and a
`client_domain` operation appearing in a challenge is tolerated by
verification (per spec) but never co-signed by us.

Where it would plug in, for an adopter who needs wallet attribution: add
`client_domain` to the GET in `src/auth/challenge.ts`, and in
`src/auth/authenticate.ts` add a second `signTransaction` call, through a
`Signer` whose backend holds the client-domain key, for the account named
by the challenge's `client_domain` operation source. The verification
core already recognizes the operation, and the anchor will then include a
`client_domain` claim in the JWT.

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
