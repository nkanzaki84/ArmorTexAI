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
- **If every call and text must land in the app as Events** (nk asked
  2026-11-22): Google Voice is out, it has no feed (Takeout/Vault only).
  Two ways: **Quo (ex-OpenPhone)**, Business plan ~$23–33/user/mo, calls +
  texts + recording + transcripts, webhooks post each call/text to a public
  `doPost` deployment of ours → Events row matched by phone, unknown numbers
  to the review queue; ~2 days. Or **Twilio**, ~$40/mo at Tanner's volume but
  we build the texting inbox and need A2P 10DLC registration (weeks); ~1 week.
  **Decided 2026-11-22 (nk): Quo.** Tanner already has it. **Built the same
  day (v0.5.0, quo.gs)**: Settings → Quo card, doPost receiver, Events rows,
  record Activity, Today's call list + review queue. 2026-11-22 evening: webhook
  registered, Quo's test event reached the app, so Quo does follow Apps
  Script's 302. Gotcha hit on the way: the /exec address is not the /dev
  address with the suffix swapped (different deployment ids).
  What the docs say (read 2026-11-22, api.quo.com, header `Quo-Api-Version:
  2026-03-30`, auth `Authorization: <key>` no Bearer, 10 req/s):
  - Webhooks (`POST /webhooks`, events `call.completed`, `call.recording.completed`,
    `call.transcript.completed`, `call.summary.completed`, `call.voicemail.completed`,
    `message.received`, `message.delivered`), filter by phone number id, retries
    ~27 h, dedupe on `webhook-id` header, `POST /webhooks/:id/events/test`.
    Transcripts + summaries need **Business or Scale**; calls/texts/recordings any paid plan.
  - List calls/messages need `participants=<one number>`, so polling per
    contact is out; webhooks it is.
  - Apps Script `doPost` cannot read headers (no signature check) and answers
    with a 302 first. Design: token in the webhook URL, treat the post as a
    nudge, re-fetch the call/message from the API with the key, store only
    what Quo confirms. Test the 302 with a test event; fallback = Zapier
    catch-hook relay. Needs a second deployment with access "Anyone".
  - Caller ID name on the realtor's phone: needs US carrier registration
    (company tax id) then "Caller ID names" in workspace settings, ≤15 chars,
    48–72 h, not every carrier shows it. Otherwise just the number.
  - API key: Workspace settings → API, owner/admin only, full account access;
    it goes in Settings → Developer (Script Properties), never in chat.
  Google Voice Starter ($10) remains the no-database answer.
- Rule either way: no cold calls to homeowners. Call buttons on Homes appear
  only when `Phone Given By Owner` is Yes.

## UI conventions (adopted 2026-11-22)

- [x] `ui_base.html` included; SFM palette, 220px white sidebar with the blue active bar, 6px cards, one primary per card, underlined tabs, three-colour toasts bottom-right, "Nov 16, 2026" dates, monospace version, orange owner tools, purple owner-only Settings
- [x] Record page: sticky title row with one Save that stamps the time; Enter saves
- [ ] Rule 13: pickers that can grow offer "➕ Add new…" (partner type picker is fixed, fine; versions picker later)
- [ ] Rule 24: deleting something with history asks you to type its name (nothing deletes yet beyond team members)
- [ ] Rule 51: What's new tags (SFM has it; port when the team is using the app daily)

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
- [x] Partners side split into Marketing (pipeline) and Partners (book) with a 30-day touch clock
- [ ] Monthly "reason to hear from us" nudge for Partners (finished job nearby); the 🥶 gone-cold filter is the first step

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
- [x] Partner type tabs + per-type profiles, wins and metrics (`PARTNER_TYPE_PROFILES`) — fields are a first guess, nk to confirm
- [ ] Email versions for inspectors, insurance agents, property managers (profiles already say which versions a type uses)
- [ ] Campaign screen: a tab per partner type once more than realtors are being emailed
- [ ] Hand-off: one function, one package → Zapier catch hook → Roofr. Store Roofr ID; four status updates typed in by hand until the Job Manager exists
- [ ] Partner-referred address that matches a Home → link them so Tanner sees age + value
- [ ] Cost per job per campaign (needs a place to enter postcard/print costs) vs the $1,600 appointment setter

## Gregg County realtor list (2026-11-22) — parked by nk: Tyler first, Gregg later

- The Tyler list (264 prospects) is 93 % Smith County. The Homes campaign is Gregg County, and the email test was planned around ~500 realtors, so a Gregg County list is wanted for January, not for Dec 1.
- **Source found: TREC's public license-holder data on the Texas Open Data Portal** (dataset `s7ft-44qi`, updated daily; this session's environment "ArmorTex apps" allows data.texas.gov). Gregg County, active: 382 sales agents + 118 individual brokers = 500, with each agent's sponsoring brokerage. **No email, phone or street address in the data.**
- Roster worksheet handed to Brian: `gregg-county-realtor-roster-2026-11.csv` (not in the repo: names), plus `gregg-county-brokerages-2026-11.csv`. TREC lists brokerages by **legal entity**; resolved via each company's designated broker: HMK Group LLC = Texas Real Estate Executives – Longview (Heather Kelly, 44 agents; established partner Tammy Kessler is there), Lenhart Properties = Coldwell Banker Lenhart (35), BPS Holdings = BOLD Real Estate Group (Suzanne Smith, 29), L.W. Summers = Summers Cook & Company (24), BESCD = United Country H5 Auction (commercial, skip), RNCJ Interests = Johnson Realty (Cherika Johnson). Top brokerages' websites list agent emails/phones: the fastest honest way to fill the sheet. Rule from the briefs still applies: no scraping listing sites, no posing as a buyer.
- Warm route: the 8 established partners sit inside 4 of these brokerages (TREE, Miller Home Group, KW, Coldwell Banker, The Agency); ask each partner for an intro to their office rather than cold-emailing their colleagues.
- [ ] Parked 2026-11-22: run the Tyler list first. When ready: decide who fills the roster (an afternoon for the top brokerages, or ask the established partners for office intros) or whether to buy a list
- [ ] Import with list name `realtors-gregg-2026-11` once Phone/Email are filled; rows with neither are skipped

## Campaigns as records (nk, 2026-11-22) — agreed, build after the first real batch

Brian: Marketing = the list of people we are courting; Campaign = where you
start a campaign, plan the sending and upload the content. Agreed. The app
already runs exactly one unnamed campaign (versions on Campaign, days/cap in
Settings, audience = everyone with a version). Next step is a record per
campaign:

- A campaign answers five questions: **who** (type + lists + stage filter),
  **what** (its own set of versions), **when** (start date, sending days,
  daily cap, moved off Settings), **after** (one follow-up at +4 business
  days, fixed by the brief), **did it work** (the stats page, per campaign).
- Campaigns list: a card per campaign with status (draft / running / paused /
  done), audience size, sent, replied, wins. Start form: name, partner type,
  lists, versions, start date, days, cap.
- Marketing gets a campaign filter and shows "in <campaign>" on each row.
- Today's batch draws from every running campaign; a person still presses Send.
- Keep off the table: a timer that sends on its own (brief: v1 is hand-sent);
  drip sequences beyond the one follow-up; open tracking.
- Sequence: send the five-address test batch first, start the Tyler campaign
  for real, then mock up the Campaigns page before any code.

## Salesperson profiles, ownership and commissions (nk, 2026-11-22) — parked

Each salesperson works their own leads and keeps their own realtor / inspector / property-manager relationships; leads are tracked through the sales cycle to commission.

- [x] `Rep` column on Partners (staff email): set on import, on Add, on the record, or per list (2026-11-22). Homes later.
- [x] "Mine" filter on Marketing and Partners; Today scoped to the signed-in rep (unassigned counts as mine); owner sees everyone with a rep chip and an Everyone/Mine toggle.
- [x] Call queue: hand-emailed prospects (Notes "sent 11/3") skip the email test and sit on the call list; manual add/remove on the record.
- [ ] Rep profile page: their pipeline funnel, partners, referrals in, jobs and $ sourced, touch discipline (gone-cold count). Campaign stats split by rep.
- [ ] Commission: a property of a **signed job** (rate, basis, paid date) → job manager. The CRM supplies attribution: the rep on the partner/home that produced the referral travels on the hand-off package (`Source` gets a rep field) and the four status updates come back per referral, so "jobs and $ by rep" is computable here without storing commission math.
- [ ] Email sending stays from the business mailbox (Brian's) in v1; per-rep sending mailboxes is a later question (each rep's Workspace account + the same code deployed per rep, or the Gmail API with delegated send).
- Keep: no fees to partners; commissions are staff pay and live with jobs.

## Referral tracking by product (nk, 2026-11-19) — parked, not in effect yet

ArmorTex will sell more than one thing (roof reports, repairs, replacements,
the **Texas Roof Club** membership, maybe gutters later), and referrals should
be tracked per product, from any source: a partner, an existing customer, a
Roof Club member, a neighborhood.

Sketch so nothing built now gets in the way:

- A `PRODUCTS` catalog in Config (key, label, what a referral of it looks like, what counts as converted).
- `Product` column on Referrals (append; blank = roof report today), plus `Source Kind` (partner · customer · member · neighborhood · web) and `Source ID`.
- Per-product funnel on Campaign: referred → report/quote → signed → paid, split by source.
- Roof Club specifics: membership start/renewal dates and the yearly inspection live in the **job manager** (Houses keep history); the CRM only tracks *who referred whom into the club* and the thank-you.
- Hard rule stays: no fee, gift card or payment to a realtor for any product. Rewards to **homeowners** who refer neighbours are a separate question; confirm with the Texas attorney before launching any referral reward.
- Build when: the Roof Club exists as a product, or the first non-partner referral shows up. Version 4 (referral network) is the earliest natural slot.

## Someday / maybe

- **Brevo / Mailchimp newsletter to the Partners book** (nk asked about Brevo
  2026-11-22): not for the realtor email test (brief: plain text from Brian's
  inbox, no pixel/links, reply matching lives in Gmail). Fine later for a
  monthly note to established partners, owned by Caitlin; export the book as
  a list, nothing to build.

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

- WhatsApp as a marketing channel (nk, 2026-11-19): opt-in only by policy, thin US adoption, homeowners excluded by the no-cold-texts rule. Not worth building. Reconsider only if partners ask for it.
- WooSender (nk looked at it 2026-11-22): AI texting/calling that chases inbound leads at volume. Built for online sales funnels, not for courting 265 realtors by email and a personal call. Texting homeowners is barred by the brief anyway. Not pursuing; the calling question stays Google Voice vs Twilio (see "Calling from the app").
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
