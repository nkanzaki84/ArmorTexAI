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
- All Sheet access goes through `sheet.gs`: `_readTab_`, `_appendRows_` (one write for a batch), `_updateRow_` / `_updateRows_`, `_findRowIndex_`, `_nextId_` (IDs look like `P-12`, `E-40`, `EV-7`, `R-3`, `H-900`). Columns are matched by header NAME.
- **Every server function that writes starts with `_requireRole_(WRITE_ROLES)` or `_requireRole_(ADMIN_ROLES)`.** Roles: `owner` (Brian, implicit via `OWNER_EMAIL`), `sales` (Tanner), `viewonly` (Caitlin). Hiding a screen is never the only protection.
- Dates cross the server/client boundary as strings. `_readTab_` turns Date cells into ISO strings; `_coerceCell_` turns them back on write. Parse date inputs with `_parseLocalDate_`. Time zone is `America/Chicago` (manifest + `Session.getScriptTimeZone()`).
- Stage and Response on Partners/Homes are **derived** from Emails + Events and cached by `recountPartnerStages()`. Stats are always recounted from Emails + Events (`getCampaignStats()`), never incremented.
- Two URLs: **/dev** (HEAD, after `clasp push -f`) for testing; **/exec** for Tanner, promoted with `./deploy.sh` only when a batch is ready. Apps Script allows 200 lifetime versions per script; SFM already hit it. Don't deploy reflexively.
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

## Two sections on the Partners side (2026-11-19, Brian: "a marketing stage, then established relationships")

- **Marketing** (`page=marketing`): the pipeline, Stage ≠ Partner. Type tabs, a Prospect → Contacted → Replied → Partners funnel strip, stage/version/response filters, links to Today's batch and Email versions. This is where the email test lives.
- **Partners** (`page=partners`): the book, Stage = Partner. Type tabs, totals (partners, referrals in, jobs signed + $, gone cold), rows show referrals/jobs and a touch clock (`PARTNER_TOUCH_DAYS` = 30 → 🥶 gone cold), filters Everyone / Gone cold / Sent work.
- Both render `partners.html` with a `section` template variable; `listPartners({section})` filters server-side and attaches `metrics` + `daysSinceContact`. A prospect becomes a partner by a win Response, a referral in, or **Mark as partner** on the record (`markAsPartner` / `unmarkPartner`); `Partner Since` is stamped once. The record's back button follows `?from=`.

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

## Parked: referral tracking by product (2026-11-19)

Brian will want referrals tracked per product (roof report, repair, replacement, Texas Roof Club membership) from any source (partner, customer, member, neighborhood). Not in effect yet. Design sketch in `docs/IDEAS.md`; the only thing to respect now is that Referrals grows by **appending** `Product`, `Source Kind`, `Source ID` columns later, and that no partner ever gets a payment field.

## Hand-off to the job manager (keep in mind in every version)

One function, one package, destination swappable (Zapier → Roofr now; ArmorTex Job Manager later). Every request gets its own Referrals row with our ID; the row keeps the job manager's ID and the four status updates (report sent + link, estimate started, signed/lost + amount, paid + amount). Package fields are listed in both briefs (CRM record ID, side, request type, requested/due, source, property split into parts, report recipient, owner contact and how obtained, notes/photos).

## Build order and status

| Version | Scope | Status |
|---|---|---|
| 1. Send and match | Sheet + import + versions + Today batch + Send + reply check + stats | **code complete, untested against real Gmail**: `emails.gs` sends (createDraft().send()), queues the one follow-up (+4 business days, sent in-thread via the Gmail advanced service with In-Reply-To), `checkReplies` trigger (search `after:… -from:me`, dedupe by Gmail message id), bounce + opt-out + address detection with a review queue on Today. Done when the five-address test batch sends and replies match. |
| 2. Work the replies | partner record, call list, follow-up, bounce/opt-out, address flag | not started |
| 3. Homes | import, neighborhood view, roof-age review, mailing file, knock list, knock outcomes | not started |
| 4. Referral network | referrals log, more partner types, hand-off via Zapier | not started |

Build nothing from the next version until the one before it has been used for real.

## Open questions (ask Brian, don't guess)

- ~~Whose mailbox sends?~~ Brian's (2026-11-19).
- **Calling from the app** (asked 2026-11-19): today every phone number is a `tel:` link, so on a phone it opens the dialer and the app offers to log the call. Brian wants more. Options recorded in `docs/IDEAS.md` (Google Voice business number vs Twilio click-to-call bridge); the choice hinges on which number should show on caller ID. Not built yet. Never add cold-call tooling for homeowners; call buttons on Homes only when `Phone Given By Owner` is Yes.
- ~~Realtor list source and columns~~ Brian's Tyler list (264 prospects, imported from `East_Texas_Realtor_Roofing_Leads`) + 8 established partners (2026-11-22). Gregg County is parked (Brian, 2026-11-22: Tyler first). A TREC roster of 500 Gregg County names with brand-resolved brokerages exists as a worksheet, no contact info; see IDEAS. Cloud sessions for these repos use the "ArmorTex apps" environment, which allows data.texas.gov and trec.texas.gov.
- Pay-at-closing dollar limit, which unlocks version E. Until then assign only A/B/C? (`assignVersions({versions:['A','B','C']})` exists.)
- ~~Business street address~~ Tyler office: 3310 South Broadway Ave, Ste 225A, Tyler, TX 75701 (2026-11-22; default in Config).
- Postcard wording and number of versions; which neighborhoods go first in January.

## How Brian likes to work

- Mockup first, then code. He reviews screens at the real /dev URL.
- Short, direct answers. Plain English over jargon; explain git/clasp when it matters.
- He pastes screenshots and terminal output; trust them over assumptions.
- After each change he wants the copy-paste commands: `git pull`, `clasp push -f`, and (only when promoting) `./deploy.sh "..."`.
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
