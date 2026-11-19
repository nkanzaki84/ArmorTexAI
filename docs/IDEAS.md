# Ideas Notebook

Scratch space for anything we might build, decide, or deliberately not do.
Format: `- [ ] idea — why (who, date)`. Move items between sections as they
get decided. The briefs in `docs/briefs/` are the spec; this is the overflow.

## Now (version 1 — send and match, by Dec 1)

- [x] Sheet with all tabs, setup(), helpers, roles (2026-11-19)
- [x] Partner import with header aliases, dedupe, do-not-contact skip
- [x] Version assignment: shuffled within brokerage, dealt A/B/C/E, assigned once
- [x] Today batch builder: cap, sending days, pause, even spread, follow-ups first
- [x] Version validation: address + opt-out, plain text, no links, ends with a question
- [x] Campaign stats recounted from Emails + Events, 8-step funnel, counts beside rates
- [x] `emails.gs`: sendTodayBatch (DNC at send time, random pause, thread/message IDs, lock versions, quota, script lock)
- [x] `emails.gs`: checkReplies trigger every 15 min; bounce, opt-out wording (DNC + review), address guess (review); follow-up cancelled on any reply
- [x] Follow-up queued at send time for +4 business days, sent in the same thread (In-Reply-To), never a third
- [x] Today: Send button, Send anyway (test, owner only), New replies, Calls (replied, not yet called), Needs-a-human review queue
- [x] Today, Partners, Partner record, Campaign, Settings screens wired to the server (Send button waits on emails.gs)
- [x] Local preview server with fake runtime (`npm run preview`)
- [ ] Five-address test batch; confirm inbox placement before Dec 1

## Calling from the app (asked by nk, 2026-11-19)

What exists: every phone number is a tap-to-call link; on a phone it opens the
dialer, on a Mac it opens FaceTime/whatever handles `tel:`, and the app offers
to log the call afterwards. Calls go out from the caller's own number.

Options for "really" calling from the app, pick by which number should show:

- [ ] **Google Voice for Workspace** (~$10–20/user/mo): a business number on
      Brian's/Tanner's phone; `tel:` links open the Voice app; calls and
      voicemail logged in Voice. Zero code. Caller ID = business number.
- [ ] **Twilio click-to-call bridge** (~$1/mo number + ~$0.03/min): press Call
      in the app → Twilio rings Tanner's cell → when he answers it dials the
      realtor; caller ID = business number; call duration/outcome posted back
      to the app automatically; optional recording. Works from desktop too.
      About a day of work (UrlFetchApp to Twilio, `doPost` for status
      callbacks). No microphone-in-browser needed, which matters because
      Apps Script's iframe blocks mic access.
- [ ] Browser softphone (Twilio Voice JS) — ruled out for now: HtmlService's
      sandbox does not grant microphone access.
- Rule either way: no cold calls to homeowners. Call buttons on Homes appear
  only when `Phone Given By Owner` is Yes.

## Developer tools (ported from SFM 2026-11-19)

- [x] Pinned comments with screenshots + email, owner-only, inbox on Settings
- [x] /dev ↔ /exec link switch, amber dev bench, Dev Mode flag
- [ ] "View as" (see the app as Tanner / Caitlin without their login): SFM has impersonation via user properties; port when needed
- [ ] Screenshot mark-up (draw on the picture before posting), SFM's Screenshot tool
- [ ] Open comments to Tanner (`COMMENT_ROLES`) once he is using the app daily

## Next (version 2 — work the replies)

- [ ] Partner record: emails + replies inline, call notes, referrals both ways
- [ ] Call list ordered by listing value desc, roofs over 12 years first (needs Listing Value / Roof Age on Referrals)
- [ ] Address detector on replies → suggest "Sent an address", a person confirms
- [ ] Link to the call script (Settings → call_script_url) from the Today call list
- [ ] Monthly "reason to hear from us" nudge for Partners (finished job nearby)

## Version 3 — Homes (December)

- [ ] Homes import from the parcel CSV (address already split, 1,074 rows, neighborhoods)
- [ ] Roof-age review queue: reviewer marks original / replaced / unsure from past aerials; only `original` gets mailed
- [ ] Neighborhood view with counts; pick neighborhood + postcard version → mailing file in the printer's column order; logs a postcard event per home
- [ ] Knock list 5 days after mailing, street + house-number order, DNC removed, no-soliciting reminder, "posted, skipped" outcome
- [ ] One-tap knock outcomes; "not interested" = permanent DNC
- [ ] Postcard versions with QR code URL per version (retargeting lives outside the CRM)
- [ ] Test neighborhoods first: Woodbine Place, Nottingham Estates, Hollow Creek, Willow Creek Ranch, Briarwood
- [ ] Nearmap: could supply the past aerials for the roof-age review (nk, 2026-11-06)

## Version 4 — Referral network + hand-off

- [ ] Referrals log on partner and home records; counts in/out per partner
- [ ] Email versions for inspectors, insurance agents, property managers
- [ ] Hand-off: one function, one package → Zapier catch hook → Roofr. Store Roofr ID; four status updates typed in by hand until the Job Manager exists
- [ ] Partner-referred address that matches a Home → link them so Tanner sees age + value
- [ ] Cost per job per campaign (needs a place to enter postcard/print costs) vs the $1,600 appointment setter

## Someday / maybe

- [ ] Move to the Firebase project (commit `0a7865b`, tag `firebase-foundation`) if the list grows past a few thousand contacts; Gmail API instead of GmailApp
- [ ] Tyler / Smith County homes from another data source
- [ ] Texas Roof Club membership: yearly report, grade history (job manager side)
- [ ] Storm-season plan (spring 2027), parked
- [ ] The original "paste a lead blurb → contact" intake idea belongs to the job manager's walk-in entry, not the CRM (nk, 2026-11-06)
- [ ] Second email test: sample-report link vs "reply and I'll send it"

## Decided

- 2026-11-19 — **Apps Script + Google Sheet + clasp** for the Outreach app, SFM conventions. Firebase kept as the escape hatch. (Reverses the 2026-11-06 Firebase decision, which was for a different, larger app.)
- 2026-11-19 — Emails send from **Brian's mailbox** (brian@armortexroofs.com); the app deploys under his account. Tanner sees replies in the app and calls.
- 2026-11-19 — IDs are prefixed (`P-12`, `H-340`, `E-55`, `EV-7`, `R-3`) so a Sheet reader can tell them apart.
- 2026-11-19 — A Users tab (8th tab) holds roles, mirroring SFM's Authorized Users, instead of stuffing roles into Settings.
- 2026-11-19 — Roof-age review gets its own columns on Homes (review result, when, who); `Roof Check Result` is reserved for the real roof check.
- 2026-11-18 (briefs) — Version D dropped; E waits on the pay-at-closing limit. No open-rate tracking. A person presses Send.

## Rejected

- Timer-driven sending in v1 (brief: a person presses Send).
- Any payment or gift field on Referrals (Texas real estate rules).
- Uploading the homeowner list to ad platforms.

## Open questions

- Which number should show when calling from the app (decides Google Voice vs Twilio)?
- Realtor list source and columns.
- Pay-at-closing limit → unlocks version E. Until then assign only A/B/C?
- Business street address for the footer.
- Postcard wording, number of postcard versions, January neighborhood order.
- Does Roofr export past jobs/contacts? Which measurement provider? (job manager)
