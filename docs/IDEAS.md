# Ideas Notebook

Scratch space for anything we might build, decide, or deliberately not do.
Add freely. Move items between sections as they get decided.

Format: `- [ ] idea — why it matters (who raised it, date)`

## Now (next few iterations)

- [ ] Rules-based parser for the standard email blurb (date, time, name, phone,
      street, city, state, ZIP, homeowner, home age, type, insured, contract).
      Free and instant; covers 95 % of pastes. (claude, 2026-11-06)
- [ ] Customers in Firestore (`customers` collection), original blurb kept on
      the record for auditability. See docs/DATA_MODEL.md.
- [ ] Duplicate detection by phone number on save, offer "update existing".
- [ ] Phone formatting `(719) 598-2885` + tel:/sms: links.
- [ ] Contacts screen: search, filter chips, detail drawer (as mocked).
- [ ] **Calendar screen** (week grid on desktop, agenda list on phone) drawn
      from the contact book's appointment date/time. (nk, 2026-11-06)
- [ ] **Push to Google Calendar**: CalendarApp event per appointment, event id
      stored on the contact row so edits update rather than duplicate. Push
      one from the drawer or all unsynced at once. Target calendar is a
      setting; default to a dedicated "ArmorTex Appointments" calendar.

## Next

- [ ] **Gemini fallback** when rules aren't confident, or when the user picks
      "AI" (Google AI Studio key in Script Properties). Prompt returns strict
      JSON matching the sheet columns.
- [ ] **Gmail auto-ingest**: time-driven trigger scans a label (e.g.
      `Leads/New`), parses each blurb, writes rows, relabels to `Leads/Imported`.
      Removes the paste step entirely.
- [ ] Auto-push to Google Calendar on save (setting, off by default).
- [ ] Read-only "busy" overlay of existing Google Calendar events on the
      calendar screen to spot conflicts before booking.
- [ ] Month view on the calendar screen.
- [ ] Map link / drive-time from the office.
- [ ] Rep assignment + "my appointments today" view.
- [ ] Export CSV / "Open Sheet" button.

## Platform vision (nk, 2026-11-06) — see docs/PLATFORM_PLAN.md

- [ ] Job pipeline board + activity timeline (CRM spine)
- [ ] On-site roofing report with photos → PDF, shareable to customer
- [ ] Customer portal: login, status, appointments, report, documents
- [ ] Claims management: carrier/adjuster/claim #, steps, checklist, deadlines
- [ ] Communication hub: templates, email/SMS from the file, all logged
- [ ] Invoicing & payments (Stripe), warranty & closeout, prospecting tools
- [ ] AI assists: parse adjuster letters, draft messages, tag damage photos
- [ ] **QuickBooks Online** sync: customers + invoices out, payments in (nk)
- [ ] **Nearmap**: aerial imagery on the customer file and in reports;
      roof measurements if the plan allows (nk)
- [ ] **Roofr**: measurement reports attached to the job; API if available (nk)

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
- [ ] Swap AI Studio key for **Vertex AI** via the linked GCP project (no API
      key to manage, enterprise billing).
- [ ] Mobile home-screen install (PWA-ish manifest via HtmlService).

## Decided

- 2026-11-06 — **Firebase** (Hosting, Auth, Firestore, Storage; Functions when
  needed). Replaces the Apps Script + Sheets + clasp plan, which could not
  carry the customer portal. Deploy loop: `git pull` + `firebase deploy`.
- 2026-11-06 — Staff access is an allowlist (`staff/{email}`) with roles
  owner / admin / pm, enforced in Firestore rules. Stripe for payments.
  QuickBooks Online stays as the books.
- 2026-11-06 — Rules first, AI second. The email format is fixed enough that
  regex is cheaper and more predictable; AI handles the leftovers.
- 2026-11-06 — The app is the source of truth for appointments; Google Calendar
  is a one-way mirror (app → Google). Avoids two-way sync headaches.
- 2026-11-06 — Mockup screens ship inside the real app (`public/index.html`,
  badged "mock") so they can be reviewed at the real URL; frozen copies go in
  `mockups/`.

## Rejected

- (none yet)

## Open questions

- SMS provider (Twilio / Google Voice / none at first).
- Customer login method for the portal: email link or SMS code.
- Domain name for the app.

- What does "Contract" mean in the blurb: contract *status* (none / pending /
  signed) or a contract *type*? The mockup assumes status.
- Does "Insured" mean the homeowner has insurance, or that the job is an
  insurance claim?
- Which fields are missing from the sample blurb that the setters sometimes
  include (email, roof age, storm date, notes)?
- Who else needs access to the app? (Determines `access` in `appsscript.json`:
  currently `ANYONE` with the link, running as you.)
