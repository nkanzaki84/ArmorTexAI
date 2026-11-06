# ArmorTex Platform — How We Build It

**Vision (your words, condensed):** one web app that is the company's central
software and communication hub. The business runs the whole job in it (intake →
calendar → on-site roofing report → claim → invoicing → payments → warranty) and
the customer logs into the same app to see their file, their report, their
insurance and claim progress, messages, and warranty.

This document answers three questions: what the pieces are, what they share,
and in what order we build them. Build one piece at a time; each piece should be
usable the day it ships.

---

## 1. The two faces of the app

```
                     ┌───────────────────────────────┐
   Staff (PM/office) │        ArmorTex platform       │  Customer (homeowner)
   ───────────────── │                                │  ─────────────────────
   Intake            │  one customer file per job     │  My appointments
   Calendar          │  one job pipeline              │  My roofing report
   Job pipeline      │  one activity timeline         │  My insurance & claim
   Roofing report    │  one document store            │  Messages
   Claim management  │  one message thread            │  Invoices & pay
   Invoicing/payments│                                │  Warranty
   Prospecting       │                                │
                     └───────────────────────────────┘
```

Both sides look at the **same customer file**. Staff see everything; the
customer sees the parts marked customer-visible. That one rule keeps the two
faces from drifting into two apps.

## 2. Modules

Business side:

| Module | What it does | Mocked? |
|---|---|---|
| **Intake** | Paste blurb → parse → review → save customer + appointment | ✅ v0 |
| **Contacts / customer file** | Search, filter, the full file (spine of everything) | ✅ v0 (list + drawer) |
| **Calendar** | Week/agenda view, push to Google Calendar | ✅ v1 |
| **Job pipeline** | Kanban/stages: Lead → Appointment → Inspected → Claim filed → Approved → Build scheduled → In progress → Complete → Invoiced → Paid → Warranty | ⬜ |
| **Roofing report** | On-site form on the PM's phone: checklist, measurements, photos per slope, damage notes → PDF, shareable to customer | ⬜ |
| **Claims** | Insurance carrier, policy, claim #, adjuster, meeting date, status steps, document checklist, deadlines, supplement tracking | ⬜ |
| **Communication hub** | Every email/SMS/call/in-app message logged on the file; templates; reminders | ⬜ |
| **Invoicing & payments** | Invoices from the job, deductible + ACV + RCD line items, payment links, record checks | ⬜ |
| **Warranty & closeout** | Completion photos, warranty certificate, registration | ⬜ |
| **Prospecting** | Storm/hail lists, door-knock lists, follow-up queue, lead sources | ⬜ |
| **Admin** | Users & roles (owner, office, PM), settings, templates | ⬜ |

Customer side (one "portal" module, grows with the business modules):

| Screen | Needs from business side |
|---|---|
| Home / status: "where is my job" | Job pipeline |
| Appointments past & future | Calendar |
| Roofing report + photos | Roofing report |
| Insurance & claim guide: "what happens next, what we need from you" | Claims |
| Messages | Communication hub |
| Invoices & pay | Invoicing |
| Warranty | Warranty |

## 3. One data model

Everything hangs off **Customer → Property → Job**. A homeowner can have one
property and several jobs over the years (roof now, gutters after the next
storm), and the job is where the pipeline stage lives.

```
User (staff)            Customer ──< Property ──< Job ──< Appointment
  role: owner/office/PM    │                        ├──< Report ──< Photo
                           │                        ├──  Claim ──< ClaimStep
CustomerLogin              │                        ├──< Document (any PDF/photo)
  magic link / phone       │                        ├──< Message / Activity (timeline)
                           │                        ├──< Invoice ──< Payment
                           └── Contact info,        └──  Warranty
                               comm preferences
```

Core fields, first pass (everything from the blurb is here):

- **Customer**: first, last, phone, email, preferred contact, source, created by/at.
- **Property**: street, city, state, zip, type (SFH…), year built / age, homeowner yes/no, geocode.
- **Job**: stage, rep (PM), lead source, insured yes/no, contract status, storm date, notes, original blurb.
- **Appointment**: start, end, type (inspection / adjuster meeting / build / follow-up), Google event id.
- **Report**: date, inspector, roof type, layers, pitch, squares, damage checklist, recommendations, PDF url.
- **Claim**: carrier, policy #, claim #, adjuster name/phone, deductible, ACV/RCV, status, next step, due dates.
- **Message/Activity**: who, when, channel (email/SMS/call/app/note), body, customer-visible flag.
- **Invoice**: number, lines, total, due, status; **Payment**: amount, method, reference.

Every record carries `customerVisible: true/false`. The portal only ever
queries visible records. Internal notes default to hidden.

## 4. Platform decision — DECIDED 2026-11-06: Firebase

Chosen by nk. Phase 0 is built on it. The comparison below is kept for the
record.

Apps Script + Google Sheets is what we started on because it matches your
clasp workflow. It is great for the *internal* half. It is the wrong
foundation for the *customer* half, and the two halves have to share one
database. Honest comparison:

| Need | Apps Script + Sheets | Firebase (Google Cloud) |
|---|---|---|
| Staff tools, intake, calendar | ✅ fine | ✅ fine |
| Customer login (no Google account needed) | ⚠️ homemade magic-link tokens | ✅ built-in: email link, phone/SMS code, Google |
| Photos per job (hundreds of MB) | ⚠️ Drive, slow uploads from phone | ✅ Cloud Storage, resumable uploads |
| Many users editing at once | ⚠️ Sheets locks, 6-minute execution cap | ✅ Firestore, real-time |
| Your own domain (app.armortex.com) | ❌ script.google.com URL only | ✅ |
| Stripe payments + webhooks | ⚠️ possible, fiddly | ✅ Cloud Functions |
| Email volume | ⚠️ 100–1,500/day quota | ✅ any provider |
| Gemini / AI | ✅ via API key | ✅ Firebase AI Logic / Vertex AI |
| Deploy loop | `clasp push` + `clasp deploy` | `firebase deploy` (same one-line habit) |
| Cost at your size | free | free tier covers it; expect $0–10/month |
| Setup effort | lowest | one afternoon more |

**Recommendation: build on Firebase from the start.** It is Google Cloud, it
gives the customer portal real logins and file storage, and the deploy loop is
the same shape you like (`git pull`, `firebase deploy`). Everything done so far
carries over: the mockup HTML becomes the frontend as-is, the parser logic is
plain JavaScript, and the data model above maps straight onto Firestore
collections. Switching now, at the mockup stage, costs nothing. Switching after
the internal tools are live on Sheets means a migration.

What Firebase gives us, piece by piece:

- **Hosting** — the web app on your domain, deployed with `firebase deploy`.
- **Authentication** — staff sign in with Google; customers sign in with an
  email link or SMS code (no password to forget).
- **Firestore** — the database (customers, jobs, claims…), rules enforce
  "customers see only their own visible records".
- **Cloud Storage** — photos, reports, PDFs.
- **Cloud Functions** — Google Calendar push, PDF generation, Stripe webhooks,
  Gemini calls, scheduled reminders.
- **Firebase AI Logic** — Gemini from the app for parsing and drafting.

If you would rather stay on Apps Script anyway, the build order below still
holds; I'd just plan on the customer portal being a second app later.

## 5. Build order (one piece at a time)

Each phase = mockup first, then code, then you use it for real before the next
one starts. Rough effort is in working sessions, not calendar time.

| # | Piece | You get | Effort |
|---|---|---|---|
| 0 | **Foundation** | Firebase project, staff login, empty app on your domain, deploy loop, data model | 1–2 |
| 1 | **Intake + contacts + calendar + Google Calendar push** | What's mocked today, working. Replaces the email-to-wherever step. | 2–3 |
| 2 | **Job pipeline + timeline** | Every job on a board by stage; every call/note logged. The CRM spine. | 2 |
| 3 | **Roofing report (on-site)** | PM fills it on the phone with photos; PDF out; "share with customer" toggle. | 3–4 |
| 4 | **Customer portal v1** | Customer logs in, sees status, appointments, report, documents. | 2–3 |
| 5 | **Claims** | Insurance info, claim steps, document checklist, deadlines; customer sees "what's next". | 2–3 |
| 6 | **Communication hub** | Templates, email/SMS from the file, everything logged; Gmail lead auto-ingest. | 2–3 |
| 7 | **Invoicing & payments** | Invoices from the job, Stripe pay link in the portal, payment records. | 2–3 |
| 8 | **Warranty & closeout** | Completion photos, warranty certificate in the portal. | 1 |
| 9 | **Prospecting** | Storm lists, follow-up queue, lead source reporting. | 2+ |
| 10 | **AI assists** (sprinkled in as we go) | Blurb parsing, claim-letter summaries, message drafts, photo damage tagging. | ongoing |

Phases 1–3 make the business side useful fast. Phase 4 is the first thing a
customer touches, and by then there is real content (report, appointments) for
them to see.

## 6. Mockups still to draw

In order: job pipeline board · full customer file page · roofing report (phone)
· customer portal home · claim tracker (staff + customer views) · message
thread · invoice + pay screen. One screen per sitting, same mockup file.

## 7. Answers so far (2026-11-06)

| Question | Answer |
|---|---|
| Platform | **Firebase** |
| Team | 3 people: nk (owner; developer + accountant), one admin, one PM. Roles: `owner`, `admin`, `pm`. |
| Payments | **Stripe** |
| Existing tools | **QuickBooks Online** (keep; sync invoices/payments in phase 7) |
| Wanted integrations | **Nearmap** (aerial imagery / measurements on the property), **Roofr** (roof reports / measurements) |

Integration notes:

- **QuickBooks Online**: OAuth app via Intuit developer portal; push customers
  and invoices, pull payment status. Lives in Cloud Functions (phase 7).
- **Nearmap**: API key, tile/imagery endpoints, and (on higher tiers) AI roof
  measurements. First use: show the aerial of the property on the customer
  file and in the report (phase 3). Check plan/pricing before building.
- **Roofr**: measurement reports and proposals. Confirm whether their API is
  open to us; otherwise attach the Roofr PDF to the job as a document (phase 3)
  and link out.

Still open:

1. SMS provider: Twilio, Google Voice, or none at first?
2. Domain name for the app (e.g. app.armortex.com)?
3. Customer login: email link, or SMS code? (Most homeowners: SMS is easiest.)
4. A sample of the current roof report, to mock the on-site report screen.
