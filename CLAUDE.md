# Claude Code — ArmorTex Outreach Project Context

Read this first. It holds what the next session needs without re-asking.

## Who / what / why

- **Owner:** Brian Kanzaki (brian@armortexroofs.com), ArmorTex Roofs, residential roofing in East Texas (Gregg County: Longview, White Oak, Gladewater). Brian does finance and systems remotely and builds the app. Signs in to GitHub as nkanzaki84.
- **Users:** Tanner Fought (sales, works from his truck, phone first), Brian (loads lists, writes email versions, reads stats), Caitlin (social media, view only).
- **What this app is:** the ArmorTex **CRM / Outreach app**. Two sides, same screens: **Partners** (realtors, inspectors, insurance agents, property managers reached by email then phone) and **Homes** (1,074 target homes reached by postcard then door knock). Its job ends the moment a roof report is requested: that request is handed to the **job manager** (Roofr today via Zapier, ArmorTex's own Job Manager later).
- **Why:** get from about one job a month to two or more (break-even is two). Replaces a paid appointment setter that cost about $1,600 per customer.
- **Deadlines:** version 1 (send + match) by **Dec 1, 2026**; version 3 (Homes) before the January push.
- **The specs:** `docs/briefs/` holds the three PDFs. They are the source of truth: *Outreach App Design Brief* (screens, data, automations, rules, build order), *Marketing Strategy Developer Briefing* (why, targets, funnel, hard rules), *Job Manager Brief* (the other app; nothing built yet; shapes the hand-off package).

## Stack and conventions (same as SFM Job Manager, so code can be shared)

- Google Apps Script web app, one Google Sheet as the database, HtmlService + vanilla JS, no build step, no npm deps in the script.
- **Deploys under Brian's Workspace account (brian@armortexroofs.com)**, decided 2026-11-19: emails send from Brian's mailbox and the reply check reads Brian's inbox. Web app access `DOMAIN`, execute as user deploying. Tanner and Caitlin sign in on the same domain and see the same app.
- `src/` is the clasp rootDir. `.clasp.json` is git-ignored (copy `.clasp.json.example`). Script id of the live project: `1z2Eqy4wg5bS4yvP-XTJqySW0mApdymXBlsT7Ps2scgydlwjz4HJ8foqv` (created 2026-11-19 under brian@armortexroofs.com). The Sheet: `1NquXSfndvC017EM0I0zsmFshA4gnnPgLXZm8W8JLyUY` (https://docs.google.com/spreadsheets/d/1NquXSfndvC017EM0I0zsmFshA4gnnPgLXZm8W8JLyUY), Brian's own, set in Script Properties as `OUTREACH_SHEET_ID`.
- **Apps Script forbids two files with the same base name** (`campaign.gs` + `campaign.html` fails to push). Server files that share a name with a page take the `_server.gs` suffix, as in SFM.
- Brian's Mac runs **clasp 2.x**: commands are `clasp create`, `clasp open`, `clasp push -f`, `clasp deploy -i <id>`, `clasp deployments`. The 3.x names (`create-script`, `open-script`, `create-deployment`) don't exist there.
- `Config.gs` holds `TAB`, `HEADERS`, enums, `SETTING`, `ROLES`, `PAGE_CATALOG`. `setup()` creates tabs and **only appends** missing headers, never renames or reorders.
- All Sheet access goes through `sheet.gs`: `_readTab_`, `_appendRows_` (one write for a batch), `_updateRow_` / `_updateRows_` (**write only the named cells, never read-and-rewrite a row**: round-tripping untouched Date cells shifted them a day per update, found 2026-11-22), `_findRowIndex_`, `_nextId_` (IDs look like `P-12`, `E-40`, `EV-7`, `R-3`, `H-900`). Columns are matched by header NAME. `setup()` pins the Sheet's time zone to the script's (America/Chicago).
- **Every server function that writes starts with `_requireRole_(WRITE_ROLES)` or `_requireRole_(ADMIN_ROLES)`.** Roles: `owner` (Brian, implicit via `OWNER_EMAIL`), `sales` (Tanner), `viewonly` (Caitlin). Hiding a screen is never the only protection.
- Dates cross the server/client boundary as strings. `_readTab_` turns Date cells into ISO strings; `_coerceCell_` turns them back on write. Parse date inputs with `_parseLocalDate_`. Time zone is `America/Chicago` (manifest + `Session.getScriptTimeZone()`).
- Stage and Response on Partners/Homes are **derived** from Emails + Events and cached by `recountPartnerStages()`. Stats are always recounted from Emails + Events (`getCampaignStats()`), never incremented.
- Two URLs: **/dev** (HEAD, after `clasp push -f`) for testing; **/exec** for Tanner, promoted with `./deploy.sh` only when a batch is ready. Apps Script allows 200 lifetime versions per script; SFM already hit it. Don't deploy reflexively.
- Imports accept CSV or Excel: Settings loads SheetJS from jsDelivr and converts the first sheet to CSV in the browser; the server only ever sees CSV text (`importPartners`).
- `emails.gs` conventions: all timestamps come from the `now` passed in (tests inject a clock); the Send path takes a `LockService` script lock; the reply check never deletes, only appends Events and flips statuses; `Needs Review = Yes` events are the human queue (`resolveReview`).
- Tests: `npm test` runs `tests/*.test.js` in a Node fake runtime (`tests/fakes/apps-script.js` fakes SpreadsheetApp, GmailApp, PropertiesService, Session, Utilities, MailApp, and renders HtmlService templates). Write a test before touching version assignment, batch building, reply matching, or do-not-contact.
- Local preview without Google: `npm run preview` → http://127.0.0.1:8787/?page=today with seeded sample data; `?as=tanner@armortexroofs.com` switches user; `--empty` for no seed. The browser's `google.script.run` is shimmed to call the fake runtime, so every screen works end to end. Use it for screenshots and UI iteration; use /dev for anything that touches Gmail.

## Gmail limits (confirmed 2026-11-19 against Google's pages via search; re-check before raising the cap)

- Apps Script "Email recipients per day": **1,500 for a paid Google Workspace account, 100 for consumer accounts**. New or trial Workspace accounts can sit at the lower number until the domain is established.
- Workspace Gmail itself: **2,000 messages per user per day** (500 on a trial account), rolling 24 hours.
- Our cap is 50/day Tue–Thu. `saveSettings` refuses a cap above `MailApp.getRemainingDailyQuota()`. The send code must call that too and stop when it runs out.

## Hard rules the code enforces (from the briefs; don't soften them)

- A person presses Send. No batch goes out on a timer in v1.
- Do-not-contact is checked at the moment of every send, mailing file and knock list. An opt-out takes effect the same day. A "no" at the door is permanent.
- Every email carries the business street address and the opt-out line (`validateVersion`); first emails are plain text with no link, image or tracking pixel and end with a question. `buildTodayBatch` refuses a version that fails.
- Versions lock once sending starts (`Locked = Yes`). Assign A/B/C/E once per partner, never change it.
- One follow-up after 4 business days, in the same thread. Never a third.
- No fee, gift card or payment to a realtor. Referrals has `Thanked` only; there is no money field and there must not be one.
- No cold calls or texts to homeowners; a homeowner phone is stored only when the owner gives it (`Phone Given By Owner`).
- The homeowner list never leaves the app except as the printer's mailing file.
- Open rates are not measured. Counts sit beside every rate; the Campaign table carries the "125 per version is too few" note.

## Three tiers on the Partners side (2026-11-23, Brian: "prospects are cold, marketing is warm, partner is hot")

Same `partners.html` rendered with a `section` template variable; `listPartners({section})` filters by `_tierOf_(p)` (partners_server.gs), and rows/`getPartner` carry `tier`. Stage underneath is unchanged.
- **Prospects** (`page=prospects`, ❄️ cold): `_tierOf_` = Stage Prospect/Contacted, or Replied with a `COLD_RESPONSES` response (Not interested / Bounced / Opted out), or do-not-contact. Where campaigns draw from. Funnel strip Not emailed → Emailed → Marketing → Partners (+ Said no), filters Everyone / Not emailed yet / Emailed, no answer / Said no, wording select only when `O.multiCampaigns` has entries, links to Today's batch and Campaigns, + Add prospect.
- **Marketing** (`page=marketing`, 🌤️ warm): Stage Replied and in play. Stats: warm, on the call list, not called yet, going quiet (`PARTNER_TOUCH_DAYS`); filters Everyone / On the call list / Not called yet / Going quiet; rows show calls count and days since contact; sorted call list first then quietest last. No Add button (people arrive by replying). This is where richer content (sample report, photos) is fine; the plain-text rule is for Prospects only.
- **Partners** (`page=partners`, 🤝 hot): Stage Partner. Unchanged: totals, touch clock, Everyone / Gone cold / Sent work, + Add partner (`markAsPartner` right away).
- A reply moves someone Prospects → Marketing automatically (`recountPartnerStages`); a win Response, a referral in, or **Mark as partner** moves them to Partners; **Remove from partners** (`unmarkPartner`) drops them to Marketing (Stage Replied). The record's tier pill reads "❄️ cold · prospect" / "🌤️ warm · in marketing" / "🤝 partner since". The back button follows `?from=prospects|marketing|partners`; campaign and list member links use `from=prospects`.

## Sample roof report (built 2026-11-23, v0.11.1; the warm tier's one tool)

`src/sample_report.gs`. Owner pastes the Drive link of the stock PDF on Settings → Sample roof report (`sample_report_file`, "Check file" = `checkSampleReport`), plus a subject (used only when no thread exists) and a note template (`{{first}} {{name}} {{company}} {{area}} {{rep}} {{address}}`; `{{rep}}` = whoever presses). The record's actions row has **📎 Send sample report** (write roles, needs an email, hidden for DNC; blue on warm records): `previewSampleReport` fills an inline card (to, subject, note, which thread, file), `sendSampleReport(id, {subject, body}, now)` sends it as a plain-text reply **inside the latest campaign thread** (`_sendInThread_` now takes attachments → multipart/mixed via the Gmail advanced service) or a fresh `GmailApp.sendEmail` with the attachment when there is no thread; checks do-not-contact and quota at the moment of sending; logs an Emails row with Step `sample report`, blank Campaign ID (never in campaign stats); bumps Last Contact. The draft report itself is `docs/sample-roof-report.html` (print to PDF). Tests: `tests/sample_report.test.js`.

## Partner types (2026-11-19, Brian: "different metrics and profiles per type")

`PARTNER_TYPE_PROFILES` in Config.gs is the one place a type is defined: label, company label, profile fields (sparse Partners columns), the **win** Response (`Sent an address` / `Referred a job` / `Sent a claim` / `Sent a property`), the pitch line, and which email versions it uses. The Partners page has a tab per type with counts and type-specific facts on each row; the record page shows a metrics strip and an editable profile card from the same config. Adding a type = a Config entry + its columns in `HEADERS.Partners` + `setup()`. `WIN_RESPONSES` drives Stage `Partner` and the funnel's step 4.

## UI conventions (adopted 2026-11-22 from Brian's `docs/UI_CONVENTIONS.md`)

The SFM suite look: `src/ui_base.html` (Brian's portable base: palette, inputs, buttons, tables, tabs, pills, modal/toast, number-field behaviours, select-on-focus, Escape, formatters) is included first; `styles.html` layers the app on top and must not fight it. Rules that matter when adding a screen: one blue primary button per card, the rest secondary/ghost; `toast(msg, 'success'|'error')` bottom-right for every action; dates via `fmtDate` ("Nov 16, 2026"), times via `fmtTime`; money via `fmt$`; empty states italic grey; required fields get `<span class="req">*</span>`; small lists say "Changes save immediately."; a record page has a sticky `.title-row` with ONE Save that stamps "Saved 9:34 AM" (`stampSaved`); version in monospace in the sidebar footer; owner tools in orange at the bottom of the sidebar; `/dev` is amber; Settings is purple (owner-only). Phones get a top bar + bottom tabs, which the suite doesn't define; keep that.

## Developer tools (ported from SFM, 2026-11-19; source zip from Brian)

- **Pinned comments**: 🛠 owner tools → 💬 Comment arms the page, next click drops a pin (CSS path + quoted text + card heading) and opens a composer with teammate chips and a best-effort html2canvas screenshot filed to Drive (`ArmorTex Comment Screenshots/<year>`). Threads, replies, Resolve/Reopen; emails the addressee with a `#comment=C-12` deep link. Tab `Comments`, `comments_server.gs`, `comments.html`. Visible to `COMMENT_ROLES` (owner only for now; add `'sales'` to open it to Tanner). Settings → Developer lists every open thread.
- Owner links live in the **sidebar footer on desktop** (💬 Comment · 🔧 Dev Mode · 🔗 Links: /dev|/exec · version), in orange as in SFM; the floating 🛠 button is phone-only. The sidebar is sticky so the footer is always visible.
- **/dev ↔ /exec switcher**: `window.APP_EXEC_URL` / `APP_DEV_URL` from doGet; `useDevLinks()` sticks in localStorage; `go()` and all server-rendered links follow it. The /dev URL comes from the `dev_url` setting (Settings → Developer), else `APP_DEV_URL_DEFAULT`, else `/exec` rewritten (wrong: serves the pinned version). On /dev the body gets `dev-bench` (amber bar, DEV tag).
- **Dev Mode**: `isDevMode()` flag + yellow banner for preview UIs; nothing reads it yet.
- Not ported: SFM's "View as" impersonation and the screenshot mark-up modal (listed in IDEAS).
- Preview server serves both doors: `/exec` and `/dev`.

## Reps, the call queue, and hand-emailed prospects (2026-11-22)

- `Rep` on Partners = staff email (validated against Users). Set on import ("Assign to"), on Add (sales default to themselves), on the record (picker), or for a whole list on Settings → Lists already imported. `listPartners({rep:'mine'})` = mine **or unassigned**; sales users default to Mine, the owner to Everyone. Today is scoped the same way (`getTodayWork({rep})`), with an Everyone/Mine toggle for the owner.
- `Skip Email Test` = Yes keeps someone out of version assignment and every batch (used for people already emailed by hand). `Call Queue` = Yes puts them on Today's call list until a call is logged after `Last Contact`; `setCallQueue` toggles it from the record.
- **Hand-sent rule** (`HAND_SENT_RE`, `_handSentDate_`): on import, a Notes cell like "sent 11/3" → Stage Contacted, Last Contact = that date, Skip Email Test, Call Queue. Default on for prospect imports; `applyHandSentRule(sourceList)` retrofits an already-imported list and cancels queued emails.
- Still parked: a rep profile page, per-rep funnel on Campaign, commissions (job manager; CRM supplies attribution via the hand-off), per-rep sending mailboxes. See `docs/IDEAS.md`.

## Quo, the phone system (built 2026-11-22, v0.5.0; live and verified with real calls the same evening)

`src/quo.gs`. Tanner calls and texts from Quo; Quo posts every `call.completed`, recording, transcript, summary, voicemail, `message.received` and `message.delivered` to this web app; `doPost` (Code.gs) → `_quoReceive_` → `_quoHandleEvent_` writes or updates ONE Events row per call/message (`Source = quo`, `Source ID` = Quo's id), matched to a partner by the last 10 digits of the phone (then Homes), else `Needs Review = Yes` with a blank Partner ID (Today's review queue, owner scope only). Facts that shape it:
- Apps Script `doPost` cannot read headers, so Quo's signature is not checked. The gate is a random token in the webhook URL (`?src=quo&token=…`, Script Property `QUO_HOOK_TOKEN`), and every delivery is only a nudge: the call/message is **re-fetched from Quo's API with our key** before anything is stored. No key, nothing stored.
- Apps Script answers posts with a 302 first. **Quo follows it: confirmed 2026-11-22**, the test event reached `doPost` on the real /exec URL (webhook #89800). Settings → Quo → "Send a test event" shows Quo's delivery log with the HTTP code our URL answered on each attempt.
- Outside posts need the web app deployed with access **Anyone** (`appsscript.json` → `ANYONE_ANONYMOUS`, changed 2026-11-22; takes effect at the next `./deploy.sh`). Strangers get the no-access page; same-domain users are still identified. The webhook must point at **/exec**, never /dev, and the /exec address is NOT the /dev address with the suffix swapped: the two doors have different deployment ids (Brian hit this 2026-11-22: HTTP 401 sign-in page). Copy it from Apps Script → Deploy → Manage deployments → Web app URL; `quoRegisterWebhook` refuses a URL that carries the /dev id.
- The API key is pasted on Settings → Quo (owner), stored as Script Property `QUO_API_KEY`; `saveQuoApiKey` proves it by listing numbers + users (`/v1/phone-numbers`, `/v1/users`). Webhooks use `POST /webhooks` with header `Quo-Api-Version: 2026-03-30` filtered to the watched number ids. Transcripts and summaries exist only on Quo's Business/Scale plans.
- Effects: a talked/voicemail/no-answer call we made, or any text, bumps `Last Contact` and counts as the call for the call list; a **missed incoming call** does not count as contact and puts the partner on Today's call list (`why: 'missed'`); an incoming text shows under Today's replies. The record's Activity shows direction, outcome pill, duration, ▶ recording link, summary, and a collapsible transcript.
- **Calling through Quo** (v0.5.1): Settings → Quo → "Call and text through the Quo app" (`quo_call_links`). On, and only on iPhone/Android (`onAPhone()`), `callHref()`/`textHref()` in script.html build `openphone://dial?number=+1…&from=<watched Quo number>&action=call` / `openphone://message?…`; everywhere else plain `tel:` / `sms:` (Brian confirmed 2026-11-22 that `openphone://` does nothing in Chrome on a Mac; Quo's docs say the scheme is mobile-only). `doGet` passes `_quoLinkConfig_()` as `OUTREACH.quo` (no secrets). Quo documents the scheme for mobile apps; whether Safari/Chrome on a phone hands it to the Quo app is untested. On a Mac, FaceTime → Settings → Default for calls → Quo does it with plain `tel:`. The record page has a 💬 Text button next to Call.
- **Contacts pushed to Quo** (v0.6.0, Brian 2026-11-22: "push to quo and keep the source of truth as the app"). `Quo Contact ID` column on Partners. `_quoPushContact_` creates or PATCHes `/v1/contacts` with `externalId` = our partner ID and `source` = `armortex-outreach`, so a re-push finds the same contact (`GET /v1/contacts?externalIds=`); name split on first space, company, role = type label, phone as +1…, email, `sourceUrl` = the record's URL. Settings → Quo → "Push to Quo" (missing only) / "Re-push everyone", 60 per call, looped by the page. `addPartner` and `savePartner` (name/company/phone/email) push quietly. Inbound `contact.updated` (now in `QUO_HOOK_EVENTS`; re-register the webhook once) takes ONLY a changed phone/email for a contact carrying our externalId; name/company never flow back. Partner record: the Contact card is editable (name, company, phone, email, area, notes) with the one Save; `savePartner` refuses a blank name or an email another partner has.
- Tests: `tests/quo.test.js` drives the receiver through `doPost` with a fake Quo API (`ctx.fetchHandler`). The preview seeds a connected-looking Quo card and sample call/text history.

## Campaigns as records (built 2026-11-23, v0.7.0; Brian: "build it and I'll play around with it")

`src/campaigns_server.gs` + `campaigns.html` (ledger, `page=campaigns`) + `campaign.html` (one campaign, `page=campaign&id=CP-1`, tabs Overview · Audience · Copy · Schedule · Results). Tab `Campaigns` (CP-): Name, Status (draft|running|paused|done), Partner Type, Lists, Stages, Versions (letters), Start Date, Sending Days / Daily Cap / Follow Up Days (**blank = inherit Settings**), Notes. Appended columns: `Campaign ID` on Partners (one email campaign per person), Emails and Versions (each campaign owns its own wording rows; a new campaign copies the type's latest wording).
- `setup()` seeds the first campaign ("Realtor email test", running) and stamps every version/partner-with-letter/email that has no Campaign ID with it (`_seedCampaigns_`). `_campaignMemberTest_` also treats a lettered partner with a blank Campaign ID as the first campaign's. Legacy entry points stay for tests: `assignVersions(opts)` → `dealLetters(first campaign)`, `listVersions()/saveVersion(letter, payload)/getCampaignStats()` default to the first campaign.
- **Audience** = type + lists + stages filters (`_campaignMatches_`), minus exclusions (`_campaignExclusion_`: other campaign, in the book, emailed by hand, DNC, no email). **Deal letters** (`dealLetters`, owner) stamps Campaign ID + a letter on everyone matching and not yet in a campaign; existing letters are kept; shuffled within brokerage, dealt in turn. `removeFromCampaign` only before anything was sent. Assign versions is gone from Settings.
- **Running** needs every in-play letter to pass `validateVersion`. `buildTodayBatch` iterates RUNNING campaigns: each with its own cap (room = cap − that campaign's sends today), days, start date; the list is always previewable, `problems` say why it can't go yet; `campaigns[]` carries the per-campaign breakdown. `sendTodayBatch` uses the campaign's wording (`versions[campaign|letter]`), stamps Campaign ID on Emails, follow-up gap per campaign, locks letters per campaign.
- **Schedule** tab draws the plan day by day (`_campaignPlan_`). **Results** tab = `campaignResults`: one row per member with sent / follow-up / replied / response / calls; Export CSV is built in the browser. Stats per campaign (`getCampaignStats(id)`, now with `notInterested`).
- The five-address test is its own campaign: Settings → Test batch → `createTestCampaign` (list `test`, letters borrowed from the first campaign, started).
- **Simplified 2026-11-23 (v0.9.0, Brian: "default one campaign to one letter … just an email, a follow-up, next steps like a call plan, and put it on the schedule")**: a new campaign gets letter A only (`createCampaign` default `['A']`; the New campaign dialog hides B/C/E under "Compare wordings? (optional)"); the seeded first campaign is A only too (`DEFAULT_CAMPAIGN`), while `assignVersions()` without `versions` still deals all four for the old tests. **Call plan**: `Campaigns.Call After Days` (appended; new campaigns default `DEFAULT_CALL_AFTER_DAYS` = 7, blank = no call step). `getTodayWork` adds members of a running campaign whose first email went out ≥ N business days ago with no reply and no call since, `why: 'noreply'` ("no reply to the email" pill, ranked after replied and missed). `_campaignPlan_` draws calls due per day (weekdays, not only sending days). The Schedule tab has the field next to the follow-up gap; the Overview Plan card reads "Email → follow-up after N → call after M if no reply". `getTodayWork({now})` takes an injected clock.
- **Letters hidden unless comparing (v0.10.1, Brian: "I thought we were going to take those off?")**: the campaign page calls a campaign with one letter the normal case. `multi()` in campaign.html = `versions.length > 1`. Single: the Email tab shows one open editor ("The email", Save email), no letter badges or columns anywhere, the Audience button reads "Add the N who match" (`dealLetters` underneath), the Overview table is "Results". The only way in is a link at the bottom of the Email tab, "Add wording B" (`saveCampaign({versions:[..,'B']})`), after which badges, the by-wording table and the Wordings chips appear. The New campaign dialog no longer shows letters at all.
- **Letter badges hidden app-wide (v0.10.3)**: `doGet` passes `multiCampaigns` (ids of campaigns with more than one wording, `_multiCampaignIds_`) into `OUTREACH`; `letterBadge(row)` in script.html shows `verBadge` only when the row's `Campaign ID` is in that list. Used on the partner record title and email timeline, Marketing rows, and Today's call list and batch. `verBadge` itself stays for the campaign page's comparing mode.
- **Remove a wording (v0.10.4)**: on the Email tab while comparing, each unlocked wording has a Remove button → `removeWording(id, letter)` (owner): refused once any email went out with that letter; drops it from `Campaigns.Versions`, clears members' letter and re-deals them among what remains (`dealLetters`). This is how a campaign created before the one-wording default (A/B/C/E) becomes a one-email campaign. The record's Emails list shows date · **subject** · step · status, never a letter.
- **Library (v0.10.0, Brian: "a campaign library organized by tags, searchable, sortable, an archive")**: `Campaigns.Tags` (appended; `_normTags_` lowercases, dedupes, hyphenates spaces; a new campaign defaults to its type as the tag). The Campaigns page filters client-side: tag chips (click to toggle), a search box over name/tags/notes/type/lists, sortable column headers, and **Show finished** (done campaigns are hidden by default = the archive; nothing is deleted). Record page: Tags on the Schedule tab, **Duplicate** (`duplicateCampaign(id, {name, lists})`: new draft with this campaign's own wording unlocked, plan, letters, tags, no people) and **Mark done** (`saveCampaign({status:'done'})`, running/paused only).
- **Send now** (v0.8.1, owner, title row of a running campaign): `sendCampaignNow(id)` → `sendTodayBatch({force:true, campaignId})`; `buildTodayBatch` takes `campaignId` to limit itself to one campaign. Sends that campaign's batch today regardless of its sending days; a person still presses it.
- `npm test` and `npm run preview` run with `TZ=America/Chicago` so `_parseLocalDate_` behaves as in Apps Script (a date-only start date is Central midnight).
- Tests: `tests/campaigns.test.js`.

## Lists (built 2026-11-23, v0.8.0; Brian: "a lists section where I can create different email lists")

`src/lists_server.gs` + `lists.html` (`page=lists`, every role). Tab `Lists` (L-): ID, Name, Notes, Created At/By. Membership lives on the partner: `Partners.Lists` = "L-1,L-4" (a person can be on many). Lists only answer "who"; Stage answers "how far along"; never give a list its own statuses. Sales and the owner create/rename/add/remove (`createList`, `saveList`, `addToList`, `removeFromList`, `addMatchingToList` with `matchPartners` filter {type, sourceList, area contains, stage, rep, q}; the Partners book and DNC are never swept in by filter); `deleteList` owner only. The Lists page: index on the left, members on the right, "Add one person" (type-ahead) and "Add everyone who…" (Count, then Add). The partner record's Contact card shows the person's lists with ✕ and an "+ add to list…" picker (saves immediately).
- Campaigns point at lists: `Campaigns.Lists` holds list ids (`L-3`) and/or import-file names; `_campaignMatches_` accepts either (a person needs to be on any one). The Audience tab shows curated lists as the main chips and import files under a collapsed "Import files" row; the Stages chips are hidden (kept server-side). The New campaign dialog offers curated lists only. The ledger shows list names (`listNames`).
- Not built: bulk "tick people on Marketing → Add to list" (see IDEAS). Tests: `tests/lists.test.js`.

## Parked: referral tracking by product (2026-11-19)

Brian will want referrals tracked per product (roof report, repair, replacement, Texas Roof Club membership) from any source (partner, customer, member, neighborhood). Not in effect yet. Design sketch in `docs/IDEAS.md`; the only thing to respect now is that Referrals grows by **appending** `Product`, `Source Kind`, `Source ID` columns later, and that no partner ever gets a payment field.

## Hand-off to the job manager (keep in mind in every version)

One function, one package, destination swappable (Zapier → Roofr now; ArmorTex Job Manager later). Every request gets its own Referrals row with our ID; the row keeps the job manager's ID and the four status updates (report sent + link, estimate started, signed/lost + amount, paid + amount). Package fields are listed in both briefs (CRM record ID, side, request type, requested/due, source, property split into parts, report recipient, owner contact and how obtained, notes/photos).

## Build order and status

| Version | Scope | Status |
|---|---|---|
| 1. Send and match | Sheet + import + versions + Today batch + Send + reply check + stats | **DONE for real 2026-11-22 evening**: Brian's test email went out via Send now, he replied, the reply check matched it (record shows 1 reply, Stage Replied). Campaigns added on top 2026-11-23, see "Campaigns as records": `emails.gs` sends (createDraft().send()), queues the one follow-up (+4 business days, sent in-thread via the Gmail advanced service with In-Reply-To), `checkReplies` trigger (search `after:… -from:me`, dedupe by Gmail message id), bounce + opt-out + address detection with a review queue on Today. Done when the five-address test batch sends and replies match. |
| 2. Work the replies | partner record, call list, follow-up, bounce/opt-out, address flag | partly: the **Quo phone log works for real** (2026-11-22 evening: Brian's calls landed on his test record with recording, transcript and summary; the shifting-date bug in `_updateRows_` found and fixed in v0.5.6). Rest not started. |
| 3. Homes | import, neighborhood view, roof-age review, mailing file, knock list, knock outcomes | not started |
| 4. Referral network | referrals log, more partner types, hand-off via Zapier | not started |

Build nothing from the next version until the one before it has been used for real.

## Open questions (ask Brian, don't guess)

- ~~Whose mailbox sends?~~ Brian's (2026-11-19).
- ~~Calling from the app~~ **Decided 2026-11-22: Quo (ex-OpenPhone)**, which Tanner already uses. Built in v0.5.0, see "Quo" below. Google Voice rejected (no feed), Twilio parked (build cost). Never add cold-call tooling for homeowners; call buttons on Homes only when `Phone Given By Owner` is Yes.
- ~~Realtor list source and columns~~ Brian's Tyler list (264 prospects, imported from `East_Texas_Realtor_Roofing_Leads`) + 8 established partners (2026-11-22). Gregg County is parked (Brian, 2026-11-22: Tyler first). A TREC roster of 500 Gregg County names with brand-resolved brokerages exists as a worksheet, no contact info; see IDEAS. Cloud sessions for these repos use the "ArmorTex apps" environment, which allows data.texas.gov and trec.texas.gov.
- Pay-at-closing dollar limit, which unlocks version E. Until then assign only A/B/C? (`assignVersions({versions:['A','B','C']})` exists.)
- ~~Business street address~~ Tyler office: 3310 South Broadway Ave, Ste 225A, Tyler, TX 75701 (2026-11-22; default in Config).
- Postcard wording and number of versions; which neighborhoods go first in January.

## How Brian likes to work

- Mockup first, then code. He reviews screens at the real /dev URL.
- Short, direct answers. Plain English over jargon; explain git/clasp when it matters.
- He pastes screenshots and terminal output; trust them over assumptions.
- After each change he wants ONE combined copy-paste command (asked 2026-11-22), in a single `bash` block: `cd ~/ArmorTexAI && git pull && clasp push -f` (add `&& ./deploy.sh "..."` only when promoting). Not three separate blocks.
- **Bump `APP_VERSION` / `APP_BUILD_DATE` in Config.gs on every push that changes the UI.** The footer is how Brian tells whether his /dev tab has the new code; a stale number reads as "not updating".
- Keep the ideas notebook (`docs/IDEAS.md`) current.

## What NOT to do

- Don't add a build toolchain or npm dependencies to the script.
- Don't `clasp deploy` reflexively (200-version cap).
- Don't commit `.clasp.json`.
- Don't rename or reorder a header without a migration plan; append instead.
- Don't add a money/payment field for partners.
- Don't put a timer on sending in v1.
- Don't move this app to Firebase unless the list grows past a few thousand contacts. The earlier Firebase foundation is commit `0a7865b` (local tag `firebase-foundation`; also the tip of `main` on GitHub until main is updated) for that day.
