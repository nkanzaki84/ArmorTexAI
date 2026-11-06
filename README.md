# ArmorTex Contact Book

The company hub for ArmorTex: lead intake, calendar, job pipeline, roofing
reports, claims, invoicing, and a customer portal, all in one web app. Built on
Firebase (Google Cloud). See `docs/PLATFORM_PLAN.md` for the full picture.

First piece: paste a lead blurb from the appointment-setter email, review the
parsed fields, save it to the contact book.

Example input:

```
11/02/2026 1:00 PM Loretta Nelson 7195982885 214 Bayhills Dr Hideaway TX 75771 Homeowner Yes 4 Years Old SFH Insured No Contract
```

## Status

**Phase 0 — foundation (live).** Google sign-in, staff allowlist with roles
(owner / admin / pm), Team screen, Firestore + Storage security rules, emulator
setup, rules tests, one-command deploy. The Intake, Contacts and Calendar
screens are still clickable mockups with sample data (badged "mock"); phase 1
makes them real.

## Start here

- **Platform plan (vision, modules, build order, decisions):** [`docs/PLATFORM_PLAN.md`](docs/PLATFORM_PLAN.md)
- **Build & deploy (Firebase):** [`docs/BUILD_AND_DEPLOY.md`](docs/BUILD_AND_DEPLOY.md)
- **Data model:** [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- **Ideas notebook:** [`docs/IDEAS.md`](docs/IDEAS.md)
- **Mockups:** [`mockups/`](mockups/) (open the HTML file in a browser)

## Everyday loop

```bash
./deploy.sh "what changed"
```

which is just `git pull` and `firebase deploy`. Local dev: `npm run dev`.
Rules tests: `npm run test:rules`.

## How it works (planned)

1. **Paste** the blurb into the web app.
2. **Parse** with rules for the standard format; fall back to Gemini for messy
   text.
3. **Review** the fields, with a confidence dot per field.
4. **Save** to a Google Sheet (one row per contact, original blurb kept).
   Duplicate phone numbers are flagged before writing.
5. **Calendar** screen shows appointments from the book; **Push** mirrors them
   to a Google Calendar (event id stored per contact, so edits update in place).
6. Then: job pipeline, on-site roofing report, customer portal, claims,
   messaging, invoicing with Stripe and QuickBooks, warranty.
