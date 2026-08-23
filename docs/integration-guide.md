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
`WebAuth.readChallengeTx` then runs as an authoritative final gate. When a
challenge fails more than one check, the reported `failedCheck` is the
first refusal in verification order; that ordering is an implementation
detail callers must not depend on. Only the names themselves are
contract.

| failedCheck | The challenge was refused because |
|---|---|
| `deserialization` | it is not a decodable classic transaction (fee-bump envelopes included) |
| `sequence_not_zero` | its sequence number is not 0, so it could execute on the network |
| `source_not_server` | its source account is not the anchor's toml `SIGNING_KEY` |
| `no_operations` | it contains no operations |
| `first_op_source_missing` | the first operation names no source, so there is no client account |
| `first_op_not_manage_data` | the first operation is not `manage_data` |
| `home_domain_mismatch` | the first operation's key is not `"<home domain> auth"` for the expected home domain (compared case-insensitively, as domain names are) |
| `timebounds_missing` | it has no finite timebounds |
| `timebounds_expired` | the current time is outside its timebounds window (300 second grace each side, matching the SDK) |
| `timebounds_unbounded` | its `minTime` is 0, so its lifetime has no lower bound |
| `timebounds_window_too_wide` | its window (`maxTime` minus `minTime`) is wider than 1200 seconds; a signed challenge is a bearer artifact for its whole window, and real anchors issue about 15 minutes |
| `nonce_invalid` | the first operation's value is not a base64 encoding of 48 random bytes |
| `extra_op_invalid` | a subsequent operation is not `manage_data`, or is not sourced by the server account |
| `web_auth_domain_mismatch` | a `web_auth_domain` operation does not name the auth endpoint's host (compared case-insensitively) |
| `server_signature_invalid` | the anchor's signature is absent or invalid under the configured network passphrase (a wrong network fails here too) |
| `network_passphrase_mismatch` | the challenge response declared a `network_passphrase` that is not the configured one (checked before parsing) |
| `client_account_mismatch` | it names a client account other than the one we asked to authenticate |
| `unexpected_memo` | it carries a memo, and this adapter never requests one |
| `unexpected_client_domain` | it carries a `client_domain` operation, and this adapter never requests one |
| `sdk_validation` | the SDK's `WebAuth.readChallengeTx` refused it for a reason not named above (defense in depth) |

Two more typed errors complete the auth taxonomy:
`WebAuthRequestFailedError` (`code: "WEB_AUTH_REQUEST_FAILED"`, with
`phase` "toml", "challenge" or "token", the HTTP status, the anchor's
`error` string verbatim, and `timedOut: true` with `httpStatus: 0` when
the leg exceeded its timeout) for a failed network exchange, and `TokenScopeError`
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
- **Every network leg is bounded.** The toml fetch, the challenge GET,
  and the token POST each time out after 10 seconds by default
  (`DEFAULT_NETWORK_TIMEOUT_MS`), overridable through one `timeoutMs`
  dependency on `authenticate` and `fetchWebAuthConfig`. A timed-out leg
  surfaces as `WebAuthRequestFailedError` with `timedOut: true`,
  `httpStatus: 0`, and `phase` naming the leg (`"toml"`, `"challenge"`, or
  `"token"`), never as a raw AbortError. Rationale: a USSD session is
  gateway-bounded at 120 to 180 seconds, so a hung anchor must become a
  fast typed failure the session layer can render.
- **Clock skew.** The timebounds check tolerates 300 seconds of skew each
  side, matching the SDK's own reader. Hosts with worse clock drift will
  see `timebounds_expired` refusals; fix the clock, not the check.
- **Challenge lifetime ceiling.** A challenge window wider than 20
  minutes (`MAX_CHALLENGE_WINDOW_SECONDS`, 1200) or with no lower bound is
  refused before signing, because a signed challenge is a bearer artifact
  for its whole window. Real anchors issue about 15 minutes (SEP-10
  recommends 900 seconds), so a refusal here means the anchor is
  misconfigured, not the adapter.

### client_domain: a documented extension point, not implemented

SEP-10 optionally lets a client application prove its own identity in
addition to the account's, by sending `client_domain` on the challenge
request and co-signing the challenge with the `SIGNING_KEY` published on
that domain's stellar.toml. This adapter authenticates plainly and does
not implement it: `requestChallenge` never sends the parameter. Until the
extension is implemented, a challenge that comes back carrying a
`client_domain` operation is refused with `failedCheck:
"unexpected_client_domain"`, exactly as an unsolicited memo is refused: it
was not built for our request.

Where it would plug in, for an adopter who needs wallet attribution: add
`client_domain` to the GET in `src/auth/challenge.ts`, and in
`src/auth/authenticate.ts` add a second `signTransaction` call, through a
`Signer` whose backend holds the client-domain key, for the account named
by the challenge's `client_domain` operation source, and replace the
`unexpected_client_domain` refusal in `src/auth/verify.ts` with the
protocol's own rule for that operation (any source, must be co-signed).
The anchor will then include a `client_domain` claim in the JWT.

## The USSD session layer (Week 3)

The session layer turns gateway callbacks into the SOW journey: dial in,
PIN consent, SEP-10 authentication, one anchor operation, confirmation.
It composes the resolver, accounts, and auth modules without modifying
them; everything below the session layer is unchanged and remains usable
standalone.

### The gateway seam

`GatewayAdapter` is two functions: `parseStep` (callback in, normalized
`GatewayStep` out) and `renderResponse` (`Screen` in, wire response out).
The reference implementation is `AfricasTalkingGateway`, built against
the provider's documented contract (form urlencoded callbacks carrying
`sessionId`, `phoneNumber`, `networkCode`, `serviceCode`, and the
cumulative star joined `text`; `text/plain` responses beginning `CON ` or
`END `; the optional `at-ussd-hop-metadata` step tracking header, state
names only). Another gateway is one new file implementing the same two
functions plus configuration; nothing above the seam changes.

Character budget: menu length is telco dependent (Safaricom KE 160,
Airtel KE 184, automatic pagination beyond, per the provider help centre
article 1284096). The screen catalogue is budgeted against the 160
character floor including the prefix, asserted by unit test, and never
relies on automatic pagination.

### The 10 second budget

The gateway expects each callback answered within 10 seconds, so USSD is
synchronous per step and the layer schedules at most one expensive
operation per callback: the welcome step is a store only lookup (plus,
for returning users, the trustline preflight); on-chain account creation
runs on its own callback; the final PIN callback runs the signing claim,
SEP-10 authentication, and the SEP-6 deposit at session layer timeouts
(2.5 seconds per leg through the auth module's existing `timeoutMs`
seam; the library's 10 second default is for standalone use). The
anchor's stellar.toml is resolved once at startup by `AnchorCache` and
refreshed in the background, so the toml never costs a callback. The
HTTP handler answers a well formed busy screen at 8.5 seconds if work is
still in flight; the finished result lands in the idempotency cache so a
gateway retry gets the true outcome.

### PIN consent

The PIN is consent to sign this session's SEP-10 challenge and run one
anchor operation. Verification is against an scrypt hash (`node:crypto`,
N=2^15, r=8, p=1, 16 byte salt, explicit `maxmem`; see
`src/ussd/pin/hash.ts` for the parameter reasoning and the Node default
`maxmem` trap it guards against). Three consecutive failures lock the
MSISDN for 15 minutes, checked before any hashing. The PIN is never
transmitted onward, stored in plaintext, or logged: it exists between
the gateway callback body and the verifier in process memory, PIN
positions are masked to `####` before any input history is persisted,
idempotency cache keys are SHA-256 digests of the callback text, and the
test suite sweeps every observable surface for fixture PIN digits. PIN
setup compares the two entries from the gateway's own cumulative text
field, so no PIN is held between callbacks even transiently.

### Session store and the single use signing claim

One record per gateway session: state, processed input count, masked
history, the PIN verified flag, and the signing claim latch. The record
dies at a configurable absolute TTL (default 120 seconds, a deliberately
conservative bound; the gateway's own telco dependent inactivity timeout
is measured empirically in the evidence, not quoted). `claimSigning` is
the SOW's atomic single use semantics: exactly one caller per session
wins the right to trigger signing, so a duplicated or replayed callback
can never cause a second signature or a second anchor operation. The in
memory reference relies on Node's single threaded event loop (no await
between check and write); a distributed implementation must use a real
compare and set. The anchor JWT is custodied in the session record for
the session lifetime only (the auth module stays stateless, a settled
ruling), and `assertTokenScope` runs immediately before each use.

### Replay rejection, concretely

A byte identical duplicate of a processed callback is answered from the
response cache without re-running anything. A replayed or forged step
that does not extend the session's processed input count is rejected:
before the signing claim it gets a harmless re-prompt, after it the
"already completed" screen. The live e2e proves the property by
re-POSTing the recorded final callback and a forged variant and
asserting the journey ran exactly once.

### Account creation gating

Production deployments gate account creation behind their own onboarding
policy; this reference gates it behind PIN establishment. Creation runs
only after the PIN is set (new users) or verified (recovery of a missing
mapping), on its own callback, so the Horizon submission gets the whole
callback budget.

### Error screens

Every failure renders a plain language END screen within the character
budget: session timeout, missing trustline (preflighted on the welcome
callback for returning users), authentication refusal (all 20 stable
`failedCheck` names map to one refusal screen; the name goes to the
structured log, never the user), anchor unreachable, signing backend
unavailable, PIN lockout, replay, busy, and a generic service screen.
The `failedCheck` contract is unchanged in Week 3: no names were added,
renamed, or removed; session layer failures are new typed error classes
(`SessionExpiredError`, `PinRejectedError`, `PinLockedError`,
`SigningAlreadyClaimedError`, `GatewayRequestError`,
`AnchorOperationFailedError`).

### Running the session service

All configuration is non-secret and documented in `.env.example`
(`USSD_PORT`, `USSD_CALLBACK_PATH`, `USSD_GATEWAY`,
`USSD_SESSION_TTL_MS`, `USSD_HOME_DOMAIN`,
`USSD_DEFAULT_COUNTRY_CODE`). Inbound gateway callbacks require no API
key; the only gateway side configuration is the callback URL, set in the
provider dashboard. Live testing exposes the local handler through an
ephemeral tunnel whose URL is never committed. MSISDNs may arrive in
national format; the layer converts to E.164 using the configured
country code before anything touches the resolver (country inference is
this layer's job, a settled ruling).

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
