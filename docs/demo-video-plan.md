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

## Reconciled to the two runs that actually happened (28 August 2026)

This plan originally described an idealised single journey. Two real runs
have since been captured against the sandbox on the upgraded network, and
the shot list below now matches them rather than an imagined take. Both
are recorded in the Week 4 section of `EVIDENCE.md`.

| | Run 1, first time user | Run 2, returning user |
|---|---|---|
| Inputs | dial, 1, PIN, PIN again, 1 | dial, 1, PIN |
| Span | 48.0 s | 20.8 s |
| Server work mid session | 5.19 s on-chain account creation | 2.58 s authenticate and anchor call |
| Outcome | account created on chain, then the session expired on the gateway inactivity timer before the PIN could be entered | completed, confirmation rendered on the handset |

Run 1 did **not** reach a confirmation screen. Its account creation
succeeded and is on chain, but the journey ended at `Enter your PIN`. Run
2 then signed in as the account Run 1 had created, and produced the
confirmation.

## Recommendation: narrate Run 2, the returning user path

**Record the returning user path.** Three inputs, twenty seconds, and it
is the only one of the two that has actually rendered a confirmation on a
handset. Run 1's path puts a five second on-chain wait in the middle of a
window measured at roughly 30 to 60 seconds, and it has already timed out
once on this exact channel. Putting that on camera risks recording a
failure and burning a take, for the sake of showing four screens that can
be described in one sentence of narration.

The honest way to cover enrolment without risking it is to state it: the
narration says the account was created on a previous dial, which is true,
is what happened, and is also what a real user experiences. If a first
time enrolment sequence is wanted on camera later, record it as a separate
short clip that ends at `Account ready`, which is a real screen and a
real stopping point, rather than trying to carry one session through to
the confirmation.

## Shot list

Times are indicative; the recording should run two to three minutes.
Shots 1 to 6 are the phone, 7 to 9 are terminal or browser.

| # | Shot | What the viewer sees on screen | Narration point |
|---|---|---|---|
| 1 | The dialler | The synthetic number and the service code `*384*45210#` being dialled | "This is a feature phone menu. No app, no smartphone, no key material on the handset." |
| 2 | Welcome | `CON Saleem Stellar test` / `1. Sign in and deposit` / `2. About` | "The whole interface is text within a 160 character budget, the strictest limit the telcos impose." |
| 3 | Choose 1, PIN prompt | `CON Enter your PIN` | "The service recognises the number and goes straight to the PIN. This account was created on an earlier dial, which is what a real returning user sees." |
| 4 | PIN entered | (digits masked on screen by the handset) | "The PIN is consent, not a key. It never leaves the server side and is stored only as a hash." |
| 5 | The confirmation | `END Signed in as GBHN..AXYY` / `Verified by the anchor. Test only, no funds move` / `Ref 15fbd333` | "Behind that one screen: the anchor issued a challenge, the adapter checked it, signed it, and exchanged it for a session token, then used that token to start an anchor operation. Two and a half seconds. The reference on screen is the anchor's own record." |
| 6 | Hold on the confirmation | The same screen, held | "It says test only, no funds move, because that is exactly what happened." |
| 7 | Terminal, the run completing | The captured exchanges printing: SEP-10 challenge and token both 200, SEP-6 deposit 200 | "Every step was recorded as it happened." |
| 8 | Terminal, replay rejected | The replayed callback answering with the identical cached screen, the forged variant answering `END This step was already completed`, journey count still 1 | "The final step was then sent again, byte for byte, and a tampered version too. Neither produced a second signature." |
| 9 | The anchor's own record, then the explorer | SEP-6 read back showing the deposit `incomplete` for this account, then stellar.expert showing the creation transaction, 4 operations, 0 XLM, SRT trustline | "And this is the anchor's side of the story, not ours. All of it on the public test network, checkable by anyone." |

The account creation transaction shown in shot 9 is Run 1's, which is
correct and worth saying: it is the account Run 2 signed in as.

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

## Resolved: the END screen wording was changed

This section previously flagged the confirmation screen, which read
`Deposit started`, and proposed a replacement. The change was applied,
so the shot list above shows the new text and the recording should show
it too.

The record of who decided, stated precisely because this document's value
is that its claims can be checked. The replacement wording was proposed
by the author in this document, and approved by Ramy Soliman, Co-Founder
and CEO, on 29 August 2026 in the project working session, before it was
applied. That approval sits in the project's working record, not on the
pull request: no pull request review or comment approves it, and this
page does not claim one does. The build lead subsequently endorsed the
wording on substance in his 29 August review of the Week 4 pull request.

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
