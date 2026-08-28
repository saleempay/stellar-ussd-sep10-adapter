# Demo video: recording plan and shot list

The Statement of Work's Week 4 scope includes a demo video recording, and
the Week 3 expected output it demonstrates is, verbatim:

> A live USSD session authenticates end to end and completes an anchor
> operation. Replay attempts rejected.

This page is the plan for that recording. It exists because the recording
itself is an operator step: the USSD leg is driven by a human in the
gateway's web simulator, since network initiated push USSD does not exist
and the flow is user initiated by design.

Everything below is what the code actually renders. The screen texts are
copied from `src/ussd/menu/screens.ts` and were produced by the live run
recorded in `EVIDENCE.md`. Nothing here is a mockup, and nothing should be
staged: if a screen in this list does not appear during the recording,
that is a finding to report, not a shot to fake.

## Before recording

1. `.env` filled from `node scripts/setup-sponsor.mjs` (a fresh throwaway
   testnet sponsor).
2. The tunnel up, exposing `USSD_PORT` publicly.
3. The tunnel URL plus the `USSD_CALLBACK_PATH` segment pasted into the
   sandbox USSD channel's callback setting in the gateway dashboard.
   The path is a capability credential: it is unguessable by design, so
   **do not show the callback URL on camera**. If the dashboard is in
   shot, blur or scroll past that field.
4. The test running and waiting:
   `USSD_E2E_WAIT_MINUTES=30 npm run test:e2e:ussd`
5. The simulator open at developers.africastalking.com/simulator,
   connected as the synthetic MSISDN `+254700000000`.

**Pace matters.** The sandbox inactivity timeout was measured at roughly
30 to 60 seconds between inputs (`EVIDENCE.md`, "Measured, not quoted").
Keep every gap under about 20 seconds or the session dies mid recording.
A session that times out shows `END Session expired. Dial again to start
over`, which is a real screen and not a failure of the software, but it
is not the take you want.

## The journey is two dials, and that is honest

Enrolment and sign in are separate dials in the recording, exactly as in
the live run in `EVIDENCE.md`:

- **Dial 1 (enrolment):** set a PIN, create the Stellar account on chain.
  Account creation happens inside a callback and takes real time.
- **Dial 2 (returning user):** enter the PIN, authenticate with the
  anchor, complete the anchor operation.

Fitting both into one session would mean racing the telco's inactivity
window with an on chain account creation in the middle. Splitting them is
what a real user experiences the first time, and the narration should say
so plainly rather than hide it.

## Shot list

Times are indicative; the whole recording should run three to four
minutes.

| # | Shot | What the viewer sees on screen | Narration point |
|---|---|---|---|
| 1 | The dialler | The synthetic number and the service code `*384*45210#` being dialled | "This is a feature phone menu. No app, no smartphone, no key material on the handset." |
| 2 | Welcome | `CON Saleem Stellar test` / `1. Sign in and deposit` / `2. About` | "The whole interface is text within a 160 character budget, the strictest limit the telcos impose." |
| 3 | Choose 1, PIN setup | `CON Create a 4 digit PIN` | "First time through, the user sets a PIN. This is consent, not a key: it never leaves the server side and it is stored only as a hash." |
| 4 | PIN confirm | `CON Enter the PIN again` | Nothing to add; keep it moving. |
| 5 | PIN saved | `CON PIN saved` / `1. Create your account and continue` | "The PIN is now stored as an scrypt hash. The digits themselves are gone." |
| 6 | Account creation | `CON Account ready` | "In the second it took to answer, a Stellar account was created on the public test network, with its minimum balances paid by an operator account. The user's account holds nothing and cost the user nothing." |
| 7 | Second dial | `CON Saleem Stellar test`, then `CON Enter your PIN` after choosing 1 | "Dialling again, the service recognises the number and goes straight to the PIN. This is the returning user path." |
| 8 | The confirmation | `END Signed in as GD2B..PXQ7` / `Verified by the anchor. Test only, no funds move` / `Ref 5a26b6f1` | "Behind that one screen: the anchor issued an authentication challenge, the adapter checked it, signed it, and exchanged it for a session token, then used that token to start an anchor operation. The reference on screen is the anchor's own record." |
| 9 | Terminal, the run completing | The test's captured exchanges printing, including the SEP-10 challenge and token legs both HTTP 200 | "Every step was recorded as it happened." |
| 10 | Terminal, replay rejected | The replayed callback answering with the identical cached screen, and the forged variant answering `END This step was already completed`, with the journey count still 1 | "The final step was then sent again, byte for byte, and a tampered version was sent too. Neither produced a second signature. The count stays at one." |
| 11 | The anchor's own record | The browser or terminal showing the SEP-6 read back (see below) | "And this is the anchor's side of the story, not ours." |
| 12 | The explorer | stellar.expert showing the account creation transaction, 4 operations, 0 XLM balance, SRT trustline | "All of it is on the public test network and checkable by anyone." |

Shots 9 to 11 are terminal shots, not phone shots. The replay attempt is
performed by the test itself against the live handler, because a browser
simulator cannot re-send a raw callback. Do not stage a phone screen for
it.

## The shot that proves the anchor accepted the token

Shot 11 is the one that carries the SOW's "completes an anchor operation"
claim, and it is worth holding on screen for several seconds.

What the viewer should see is the anchor answering a request that is
*only* answerable with a valid token, for the transaction the session
created:

```
GET https://testanchor.stellar.org/sep6/transaction?id=<the Ref from shot 8>
Authorization: Bearer <the session token>

HTTP 200
{"transaction": {"id": "...", "kind": "deposit", "status": "incomplete", ...}}
```

Three things make this proof rather than assertion, and the narration
should name all three:

1. **It is the anchor's server answering, not ours.** The hostname is
   `testanchor.stellar.org`, a Stellar Development Foundation test anchor
   we do not control.
2. **The same URL refuses without the token.** The live run recorded
   HTTP 403 with no token and HTTP 200 with it, seconds apart. If the
   recording has time, show the 403 first.
3. **The id matches the reference on the phone.** The `Ref` shown on the
   END screen is the first 8 characters of the id the anchor returns.
   A viewer can compare them by eye.

`status: "incomplete"` is the correct and expected answer. It is the
anchor saying the deposit was initiated and not funded, which is exactly
what happened: no funds move anywhere in this sprint.

## Resolved: the END screen wording was changed (approved 29 August 2026)

This section previously flagged the confirmation screen, which read
`Deposit started`, and proposed a replacement. **The change was approved
and applied**, so the shot list above shows the new text and the recording
should show it too.

The screen now renders, at the longest possible runtime values:

```
END Signed in as GXXX..XXXX
Verified by the anchor. Test only, no funds move
Ref XXXXXXXX
```

89 characters including the `END ` prefix, against the 160 character
budget, asserted by name in `test/unit/ussdScreens.test.ts` rather than
only at the example length. The account fragment and the reference are
still runtime values, derived exactly as before.

Why it changed: on testnet, against a deposit the anchor itself reports as
`incomplete`, "Deposit started" was the line most likely to be read as
"money moved", and it was the line on screen longest. The new wording
states what was actually achieved and says plainly that nothing moved, so
the narration no longer has to talk the viewer out of what the screen just
said.

**One intended difference to expect.** The Week 3 transcript in
`EVIDENCE.md` records the old wording, because that is what the live
session rendered on 23 August, and that file is append only history. The
video will show the new wording. A dated note in the Week 4 section of
`EVIDENCE.md` records this so a reviewer comparing the two is not left
wondering.

## What the video must not claim

- Not mainnet. Everything is Stellar testnet.
- No funds move, at any point, in any shot.
- The signer on screen is the reference implementation, marked not for
  production in the source. Production signing is out of the sprint's
  scope.
- The gateway is a sandbox, not a live telco shortcode.
- The anchor is a Stellar Development Foundation test anchor. Saleem does
  not operate it and makes no claim about it.
