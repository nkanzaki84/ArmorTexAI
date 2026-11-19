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
- [ ] `emails.gs`: sendBatch (DNC check at send time, random pause, save thread/message IDs, lock versions, quota check)
- [ ] `emails.gs`: checkReplies trigger every 15 min (thread has a message from someone else → reply event, cancel follow-up, top of call list); bounce detection; opt-out wording flag
- [ ] Follow-up queueing: 4 business days after first, same thread, never a third
- [x] Today, Partners, Partner record, Campaign, Settings screens wired to the server (Send button waits on emails.gs)
- [x] Local preview server with fake runtime (`npm run preview`)
- [ ] Five-address test batch; confirm inbox placement before Dec 1

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

- [ ] Move to the Firebase project (tag `firebase-foundation`) if the list grows past a few thousand contacts; Gmail API instead of GmailApp
- [ ] Tyler / Smith County homes from another data source
- [ ] Texas Roof Club membership: yearly report, grade history (job manager side)
- [ ] Storm-season plan (spring 2027), parked
- [ ] The original "paste a lead blurb → contact" intake idea belongs to the job manager's walk-in entry, not the CRM (nk, 2026-11-06)
- [ ] Second email test: sample-report link vs "reply and I'll send it"

## Decided

- 2026-11-19 — **Apps Script + Google Sheet + clasp** for the Outreach app, SFM conventions, deployed under Tanner's account. Firebase kept as the escape hatch. (Reverses the 2026-11-06 Firebase decision, which was for a different, larger app.)
- 2026-11-19 — IDs are prefixed (`P-12`, `H-340`, `E-55`, `EV-7`, `R-3`) so a Sheet reader can tell them apart.
- 2026-11-19 — A Users tab (8th tab) holds roles, mirroring SFM's Authorized Users, instead of stuffing roles into Settings.
- 2026-11-19 — Roof-age review gets its own columns on Homes (review result, when, who); `Roof Check Result` is reserved for the real roof check.
- 2026-11-18 (briefs) — Version D dropped; E waits on the pay-at-closing limit. No open-rate tracking. A person presses Send.

## Rejected

- Timer-driven sending in v1 (brief: a person presses Send).
- Any payment or gift field on Referrals (Texas real estate rules).
- Uploading the homeowner list to ad platforms.

## Open questions

- Whose mailbox sends? (Assumed Tanner's.)
- Realtor list source and columns.
- Pay-at-closing limit → unlocks version E. Until then assign only A/B/C?
- Business street address for the footer.
- Postcard wording, number of postcard versions, January neighborhood order.
- Does Roofr export past jobs/contacts? Which measurement provider? (job manager)
