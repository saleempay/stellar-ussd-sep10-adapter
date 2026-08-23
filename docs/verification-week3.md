# Week 3 verification checklist (non-technical)

This checklist lets a non-technical reviewer confirm the Week 3
deliverable against the Statement of Work, using only a browser and the
files in this repository. It follows the format of
[verification-week1.md](verification-week1.md) and
[verification-week2.md](verification-week2.md).

The Week 3 SOW scope, verbatim:

> USSD menu flow within the USSD character budget, PIN consent verified
> against a hash and never transmitted onward, short-lived session store
> with atomic single-use semantics to prevent replay, and error handling
> for session timeout and missing trustline. Tested against a commercial
> USSD gateway.

Expected output, verbatim:

> A live USSD session authenticates end to end and completes an anchor
> operation. Replay attempts rejected.

## 1. The menu fits the character budget

- Open `src/ussd/menu/screens.ts`. Every screen the app can show is
  listed there, and the file header names the budget source: Africa's
  Talking's own help centre states the limit is telco dependent
  (Safaricom Kenya 160 characters, Airtel Kenya 184).
- Open `test/unit/ussdScreens.test.ts`. A test asserts every screen,
  at its longest possible content, fits 160 characters including the
  gateway's `CON `/`END ` prefix.

## 2. The PIN is checked against a hash and never travels onward

- Open `src/ussd/pin/hash.ts`. PINs are hashed with scrypt (a standard
  password hashing function built into Node, no extra software), with
  the parameter reasoning written in the file header.
- Open `test/unit/ussdPin.test.ts` and
  `test/integration/ussdSimulatedGateway.test.ts`. Tests type the
  fixture PINs into a full simulated session and then check that no log
  line, stored record, or captured transcript contains those digits.
- The masked transcript in `EVIDENCE.md` (Week 3 section) shows every
  PIN position as `####`, with the masking stated.

## 3. Sessions are short lived and replay is rejected

- Open `src/ussd/session/memoryStore.ts`. Sessions expire at an
  absolute time to live (120 seconds by default) and the store grants
  the right to trigger signing exactly once per session
  (`claimSigning`), even under simultaneous duplicate callbacks (a test
  fires 50 at once and exactly one wins).
- The Week 3 section of `EVIDENCE.md` shows a real replay attempt: the
  final callback of the live session was sent again, byte for byte, and
  a forged variant was sent too. Both were refused, and the
  authentication count stayed at one.

## 4. Timeout and missing trustline are handled

- Open `src/ussd/menu/screens.ts`: the timeout screen ("Session
  expired. Dial again to start over") and the missing trustline screen
  ("Your account cannot hold this asset yet") are both in the
  catalogue, and `test/unit/ussdMachine.test.ts` drives both paths.

## 5. Tested against a commercial USSD gateway

- The gateway is Africa's Talking. The live run in `EVIDENCE.md`
  (Week 3 section) shows the sandbox callbacks arriving in the
  provider's documented format and the session completing end to end:
  sign in, SEP-10 authentication, and a SEP-6 deposit initiation at
  testanchor.stellar.org, with the anchor's own record of the deposit
  read back as proof.
- The account created during the journey is on the public testnet:
  paste the creation transaction hash from `EVIDENCE.md` into
  `https://stellar.expert/explorer/testnet/tx/<hash>` and confirm it
  exists.

## 6. What is deliberately out of scope

Production signing, mainnet, the anchor itself, SIM Toolkit key
material, platform dependencies, the demo video (Week 4), and push
USSD (the gateway does not support it; the flow is user initiated by
design).
