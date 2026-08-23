# Sponsor account of record (testnet)

The sponsor is the operator account that pays fees and sponsors reserves for
every account the adapter creates. This page records which sponsor the
sprint uses, where its key lives, and how to recover after a testnet reset.

Everything here is Stellar **testnet**. The key is a throwaway testnet
credential with no value outside the sprint's evidence.

## Account of record

| Item | Value |
|---|---|
| Sponsor public key | `GBEHKNGDYTRZPFLBRWM6VMO5CK7UQY7IHHXSBTKNODBHDESRS5KQ3PBQ` |
| Created | 18 August 2026 |
| Funded by friendbot | tx `b3b30a108707ebd200c0abb7660644fe512aaaca364c2993eb370c7571cf3357` |
| First replay of the Week 1 flow | tx `f990b68ca703faebd95291b8c17ba01f8077bb31ba045ba5ae421ec7117605c9`, ledger 4207769 |
| Replay result | new account `GCUL2NGCEXQYCWODFGQKR2O4YNNL7GDRA775LX5QW3VRKJOVTT5R4FHP`, `num_sponsored: 3`, base reserve 0.5 XLM, sponsor moved by the 400-stroop fee only |

The Week 1 sponsors in `EVIDENCE.md` (`GAPRGAFK...OMV6` and the
reproduction sponsor `GAE5TCKW...SMLP`) remain funded on testnet and their
transactions remain verifiable, but their secret keys were never retained,
so they cannot sign again. They are historical evidence only.

## Where the key lives

**Interim (current):** the secret key is stored as a GitHub environment
secret on this repository:

| Item | Value |
|---|---|
| Repository | `saleempay/stellar-ussd-sep10-adapter` |
| Environment | `testnet` |
| Secret | `SPONSOR_SECRET_KEY` |
| Variable | `SPONSOR_PUBLIC_KEY` |

GitHub secrets are write-only. Nobody can read the value back through the
UI or API; only a workflow running in the `testnet` environment receives it.
The environment itself is gated (configured 20 August 2026 and read back
from the API):

- **Deployment branch policy: `main` only.** A workflow declaring
  `environment: testnet` on any other branch cannot run in it, so a
  workflow committed to a feature branch cannot reach the secret.
- **Required reviewers: `rasoliman` and `ismo90`.** A run in the
  environment waits for reviewer approval before it receives the secret,
  so the two-person rule is enforced by GitHub, not stated in a document.
- **Administrator bypass disabled** (`can_admins_bypass: false`), so the
  reviewer gate binds repository administrators too.

No copy exists in any working tree, `.env`, chat log, or scratch directory.
The script that created it passed the value over stdin, not argv.

No workflow currently reads this secret: the repository has no
`.github/workflows` directory yet. It is stored for forthcoming CI use and
until then has a writer and no reader.

**Target:** the sponsor becomes a DFNS-managed wallet in the DFNS dev org,
so no raw secret exists anywhere and the MPC signer co-signs through the
`Signer` interface. This is the architecture of record for every Saleem
wallet. It is marked for migration as soon as DFNS dev org access is live;
at that point the GitHub secret is deleted and this page is updated. Until
then the local reference signer (`LocalKeypairSigner`) consumes the secret.

## Recovery after a testnet reset

Testnet resets wipe every ledger entry, including the sponsor and every
account it created. Recovery is one command:

```
npm run sponsor:recover
```

This builds the library, then `scripts/recover-sponsor.mjs`:

1. reuses `SPONSOR_SECRET_KEY` from the environment or `.env` when present,
   otherwise generates a fresh keypair;
2. asks friendbot to fund the sponsor if Horizon does not know the account,
   and skips funding when it already exists;
3. reads the SRT issuer from the live `testanchor.stellar.org` stellar.toml
   and replays the Week 1 flow for a fresh fictional MSISDN: sponsored
   account creation plus trustline in one transaction, then a second
   resolution that must hit the registry (`created: false`);
4. reads every claim back from Horizon and writes the capture to
   `test-output/sponsor-recovery.json` (gitignored) with stellar.expert links.

Flags (npm consumes flags placed directly after the script name, so pass
them after a `--` separator: `npm run sponsor:recover -- <flags>`):

| Flag | Effect |
|---|---|
| `--print-env` | print the two `SPONSOR_*` lines for a local `.env` (never commit `.env`) |
| `--github-env <name>` | store the secret and public key in the named GitHub environment on this repository via `gh` (requires repo admin) |

After a reset the workflow is: run `npm run sponsor:recover -- --github-env
testnet` from a machine with `gh` repo admin (the `--` separator is
required; without it npm swallows `--github-env` as its own option and the
GitHub storage step is silently skipped), then re-author the affected
sections of `EVIDENCE.md` from `test-output/sponsor-recovery.json`. If the
key is still known (it was not lost in the reset, only the on-chain state
was), the same command with `SPONSOR_SECRET_KEY` set re-funds the same
public key, so the account of record does not change.

## Reset schedule and source

Per <https://developers.stellar.org/docs/networks> (checked 18 August 2026):
resets happen 2 to 4 times a year at 17:00 UTC, announced at least two
weeks ahead on the Stellar Dashboard (<https://dashboard.stellar.org>) and
developer channels; the next scheduled reset is **16 December 2026**. The
27 August 2026 testnet event is the Protocol 28 upgrade vote, not a reset.
