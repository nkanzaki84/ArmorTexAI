# Data Model — the "ArmorTex Outreach" Sheet

One Google Sheet, every table a tab, columns matched by header name. Every
row has an ID; tabs link by ID, never by typed name. `setup()` adds missing
columns to the right and never renames. `src/Config.gs → HEADERS` is the
authority; this page explains the columns.

IDs: `P-12` partner, `H-340` home, `E-55` email, `EV-7` event, `R-3` referral.
Versions are keyed by Letter. Settings by Name. Users by Email.

## Partners — one person

| Column | Notes |
|---|---|
| ID, Name, Type, Company, Phone, Email, Area | Type: realtor · inspector · insurance · property_manager. Phone digits only. Email lowercase, the duplicate key. |
| Stage | Prospect → Contacted → Replied → Partner. **Derived** from Emails/Events/Referrals, cached by `recountPartnerStages()`. |
| Version | A · B · C · E. Assigned once by `assignVersions()`, never changed. |
| Response | '' · Replied · **win** · Not interested · Bounced · Opted out. The win differs by type: Sent an address (realtor) · Referred a job (inspector) · Sent a claim (insurance) · Sent a property (property manager). Wins and "Not interested" are set by a person; a win makes the Stage `Partner`. |
| Do Not Contact | Yes. Checked at the moment of every send. |
| Last Contact, Next Step, Notes | Last Contact = last email either way or call. |
| Source List, Added At, Added By | which import, when, who. |
| Rep | staff email who owns the relationship; blank = unassigned (counts as "mine" for everyone). |
| Skip Email Test | Yes = never assigned a version, never in a batch (e.g. emailed by hand before the app). |
| Call Queue | Yes = on Today's call list until a call is logged after Last Contact. |
| Quo Contact ID | the contact Quo holds for this person, pushed from the app (externalId = our ID). The app is the source of truth; only a changed phone/email comes back from Quo. |
| Partner Since | set the first time Stage becomes `Partner` (by a win, a referral in, or *Mark as partner*). Separates the **Marketing** pipeline (Prospect/Contacted/Replied) from the **Partners** book. |
| **Type profile columns** (sparse): Areas Served · Listings Per Year, Avg Listing Value (realtor) · Inspections Per Month, Refers Roofers (inspector) · Carriers, Handles Claims (insurance) · Doors Managed, Property Types, Decision Maker (property manager) | Which apply is defined per type in `PARTNER_TYPE_PROFILES` (Config.gs), along with the company label, the win response and the email versions. |

## Homes — one house (v3)

| Column | Notes |
|---|---|
| ID, House Number, Street, City, State, ZIP, Neighborhood | address split from day one, for the knock list's street order. |
| Year Built, Market Value, Owner Name | from the parcel list (built 2006–2014, value ≥ $300k). |
| Mailing Address/City/State/ZIP | owner-occupied when it matches the property. |
| Roof Age Review, Roof Age Reviewed At/By | '' · original · replaced · unsure. A reviewer checks past aerials **before** a home is mailed. Only `original` gets a postcard. |
| Roof Check Result | copied back from the job manager after a roof check. |
| Stage | Target → Mailed → Knocked → Talked → Roof check booked. Derived from Events. |
| Postcard Version | e.g. P1, P2. |
| Phone, Phone Given By Owner | stored only when the owner gives it; the flag records that they did. |
| Do Not Contact | Yes. "Not interested" at the door sets it, permanently. |
| Notes, Added At | |

## Emails — one email sent (or queued)

| Column | Notes |
|---|---|
| ID, Partner ID, Version, Step | Step: first · followup. |
| Scheduled For | date it should go out (follow-ups: first email + 4 business days). |
| Sent At, Sent By | |
| Gmail Thread ID, Gmail Message ID | the reply-matching key. Gmail keeps replies in the thread. |
| Status | queued · sent · replied · bounced · cancelled. |
| Subject | as sent (versions may change later; this doesn't). |

## Events — something that happened

| Column | Notes |
|---|---|
| ID, Partner ID *or* Home ID, Email ID | |
| Kind | reply · bounce · opt-out · call · text · voicemail · postcard · knock · note. |
| Outcome | knock: no_answer · not_interested · talked · booked · posted_skipped. call: talked · voicemail · no_answer · missed (Quo) or free text (logged by hand). text: received · sent. |
| At, Snippet, By | reply snippet, the note, the call summary or the text. By = staff email, `trigger` (reply check) or `quo` (incoming call/text). |
| Needs Review | Yes when an automation guessed (opt-out wording, address detected) or a call/text came from a number nobody has (Partner ID blank). A person clears it. |
| Direction, Duration, Phone, Recording URL, Transcript, Source, Source ID | Calls and texts from the phone system (Quo, appended 2026-11-22). Direction in/out; Duration seconds; Phone = the other party, digits; Source `quo`; Source ID = Quo's call/message id, the key later events (recording, transcript, summary, voicemail) update. A missed incoming call never counts as contact. |

## Referrals — one lead passed, and every roof report request

| Column | Notes |
|---|---|
| ID, Date, Direction | in = partner sent us a lead; out = we sent them one. |
| Partner ID, Customer Or Address, Home ID | Home ID set when the address matches the Homes tab. |
| Request Type, Listing Value, Roof Age Years, Due At | listing_report (48 h) · roof_check. Value + age drive call order. |
| Report Recipient, Owner Contact | who gets the report; owner contact and how it was obtained. |
| Outcome, Job Value, Thanked | **No payment field, ever.** |
| Job Manager ID | Roofr's / Job Manager's key for this request. |
| Report Sent At, Report Link, Estimate Started At, Signed Or Lost, Contract Amount, Paid At, Paid Amount | the four status updates that come back. The CRM stores, never edits. |
| Notes | |

## Versions — one email or postcard wording

Letter, Channel (email · postcard), Partner Type, Angle, Subject, Body, Follow
Up Body, QR Code URL (postcards), Locked (Yes once sending starts), Updated At.

## Settings — Name / Value

daily_cap (50) · sending_days (Tue,Wed,Thu) · sending_hour (9) · pause_sending
· follow_up_days (4) · knock_delay_days (5) · sender_signature ·
business_address · opt_out_line · job_manager_webhook · printer_format ·
call_script_url · do_not_contact (extra emails, one per line) · dev_url ·
quo_numbers / quo_users / quo_watch / quo_hook_url / quo_webhook_id /
quo_webhook_url (the phone system; JSON where plural). The Quo API key, the
webhook token and the signing key are Script Properties, never in the Sheet.

## Comments — pinned comments (developer tool)

ID (`C-12`), Thread ID (root's ID), Status (Open · Resolved, root only), Page,
Side, Record ID, Selector, Quote, Label, Text, Author, Author Name, To,
Created At, Resolved At, Resolved By, Screenshot Drive ID, Screenshot URL.
Replies repeat the Thread ID and leave the anchor blank.

## Users — Email / Name / Role / Active

Roles: owner · sales · viewonly. `OWNER_EMAIL` is owner even if absent.

## Derived, never stored as truth

- Stage, Response, Last Contact on Partners/Homes (recount from Emails + Events).
- Campaign stats (counts beside rates, per version / neighborhood / partner type).
- Report turnaround = Report Sent At − Date, against the 48-hour promise.
