# Ideas Notebook

Scratch space for anything we might build, decide, or deliberately not do.
Add freely. Move items between sections as they get decided.

Format: `- [ ] idea — why it matters (who raised it, date)`

## Now (next few iterations)

- [ ] Rules-based parser for the standard email blurb (date, time, name, phone,
      street, city, state, ZIP, homeowner, home age, type, insured, contract).
      Free and instant; covers 95 % of pastes. (claude, 2026-11-06)
- [ ] Google Sheet as the contact book. Auto-create on first run, one row per
      contact, keep the original blurb in a column for auditability.
- [ ] Duplicate detection by phone number on save, offer "update existing".
- [ ] Phone formatting `(719) 598-2885` + tel:/sms: links.
- [ ] Contacts screen: search, filter chips, detail drawer (as mocked).

## Next

- [ ] **Gemini fallback** when rules aren't confident, or when the user picks
      "AI" (Google AI Studio key in Script Properties). Prompt returns strict
      JSON matching the sheet columns.
- [ ] **Gmail auto-ingest**: time-driven trigger scans a label (e.g.
      `Leads/New`), parses each blurb, writes rows, relabels to `Leads/Imported`.
      Removes the paste step entirely.
- [ ] **Calendar**: "Save + add to Calendar" creates the appointment with the
      address as location and the blurb in the description.
- [ ] Map link / drive-time from the office.
- [ ] Rep assignment + "my appointments today" view.
- [ ] Export CSV / "Open Sheet" button.

## Someday / maybe

- [ ] Sync to **Google Contacts** (People API) so numbers show on the phone with
      the customer's name.
- [ ] Address validation / geocoding (Google Maps Platform) to fix typos and
      enable a map view of leads.
- [ ] Storm-date and roof-type fields; hail-swath lookup by ZIP.
- [ ] Lead scoring: uninsured + no contract + old roof = call first.
- [ ] SMS confirmations to the customer the morning of the appointment
      (Twilio or Google Voice).
- [ ] Multi-user with per-rep login; audit log of who edited what.
- [ ] Move storage from Sheets to Firestore if volume or concurrency grows.
- [ ] Swap AI Studio key for **Vertex AI** via the linked GCP project (no API
      key to manage, enterprise billing).
- [ ] Mobile home-screen install (PWA-ish manifest via HtmlService).

## Decided

- 2026-11-06 — Apps Script + clasp, single-page HtmlService UI. Matches the
  existing deploy workflow; no servers to run.
- 2026-11-06 — Google Sheet as v1 storage. Visible and exportable; easy to
  migrate later.
- 2026-11-06 — Rules first, AI second. The email format is fixed enough that
  regex is cheaper and more predictable; AI handles the leftovers.
- 2026-11-06 — Mockup lives in `src/Index.html` so it can be deployed and viewed
  in the real environment; frozen copies go in `mockups/`.

## Rejected

- (none yet)

## Open questions

- What does "Contract" mean in the blurb: contract *status* (none / pending /
  signed) or a contract *type*? The mockup assumes status.
- Does "Insured" mean the homeowner has insurance, or that the job is an
  insurance claim?
- Which fields are missing from the sample blurb that the setters sometimes
  include (email, roof age, storm date, notes)?
- Who else needs access to the app? (Determines `access` in `appsscript.json`:
  currently `ANYONE` with the link, running as you.)
