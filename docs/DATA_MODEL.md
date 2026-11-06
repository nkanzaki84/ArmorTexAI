# Data Model (Firestore)

Top-level collections, flat on purpose: Firestore queries are per collection,
and "all jobs in stage X" or "all appointments this week" are the questions we
ask most. Links are by id fields.

Status: **phase 0** — only `staff` and `settings` are used. The rest are
defined so the security rules and the code agree from the start.

## staff/{email}  (phase 0, live)

Allowlist of who can sign in. The document id is the Google account email.

| field | type | notes |
|---|---|---|
| name | string | shown in the app |
| role | `owner` \| `admin` \| `pm` | owner: everything; admin: everything but owner-only; pm: jobs, reports, calendar |
| addedBy | string | email |
| addedAt | timestamp | |

## settings/{key}  (phase 0, live)

One doc per setting group, e.g. `settings/calendar` → `{ calendarId }`.
Staff read, admins write.

## customers/{id}  (phase 1)

| field | type |
|---|---|
| first, last | string |
| phone | string, digits only (`7195982885`); formatted in UI |
| email | string? |
| preferredContact | `call` \| `text` \| `email` |
| property | map: `{ street, city, state, zip, type, yearBuilt?, ageYears?, homeowner: bool, geo?: {lat,lng} }` |
| source | string (`email-setter`, `door-knock`, `referral`, `web`) |
| createdAt, createdBy, updatedAt | |
| rawBlurb | string, the original paste |
| portalUid | string?, set when the customer first logs in (phase 4) |

One property per customer for now. If a customer has two houses, that's two
customer records. Revisit if it actually happens.

## jobs/{id}  (phase 2)

| field | type |
|---|---|
| customerId | ref id |
| stage | `lead` → `appointment` → `inspected` → `claim-filed` → `approved` → `build-scheduled` → `in-progress` → `complete` → `invoiced` → `paid` → `warranty` (plus `lost`) |
| rep | staff email |
| insured | bool |
| contract | `none` \| `pending` \| `signed` |
| stormDate | date? |
| notes | string |
| customerVisible | bool, default true |
| createdAt, updatedAt | |

## appointments/{id}  (phase 1)

| field | type |
|---|---|
| customerId, jobId | ids |
| start, end | timestamps |
| type | `inspection` \| `adjuster` \| `build` \| `follow-up` |
| rep | staff email |
| googleEventId | string?, set after push |
| googleCalendarId | string? |
| syncedAt | timestamp? |
| customerVisible | bool |

## activities/{id}  (phase 2)

The timeline on the customer file. One doc per thing that happened.

| field | type |
|---|---|
| customerId, jobId | ids |
| at | timestamp |
| by | staff email or `customer` or `system` |
| channel | `note` \| `call` \| `text` \| `email` \| `app` \| `system` |
| body | string |
| customerVisible | bool, default false for notes |

## Later collections (shape sketched in PLATFORM_PLAN.md)

`reports` (phase 3), `claims` (phase 5), `messages` (phase 6), `invoices` and
`payments` (phase 7), `warranties` (phase 8). Photos and PDFs live in Cloud
Storage under `jobs/{jobId}/…` with the Firestore doc holding the path.

## Rules of thumb

- Every record that a customer might see carries `customerVisible` and
  `customerId`. Portal rules (phase 4) are just: signed-in customer, record's
  `customerId` matches theirs, `customerVisible == true`.
- Timestamps are Firestore timestamps, never strings. Display formatting is the
  UI's job, in `America/Chicago`.
- Phone numbers are stored as digits only and are the duplicate-check key.
