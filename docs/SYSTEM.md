# The ArmorTex System

Two apps, one seam. Full detail is in `docs/briefs/`; this page is the map.

```
            PEOPLE                                   HOUSES
┌──────────────────────────────┐   roof report   ┌──────────────────────────────┐
│  Outreach app (this repo)    │ ── request ───▶ │  Job manager                 │
│  Partners: email → call      │                 │  Roofr today (via Zapier)    │
│  Homes: postcard → knock     │ ◀── status ──── │  ArmorTex Job Manager later  │
│  versions, stats, referrals  │  report sent    │  report, estimate, contract, │
└──────────────────────────────┘  est. started   │  install, invoicing, warranty│
                                  signed/lost    └──────────────────────────────┘
                                  paid
```

**The line between them is the roof report.** The moment anyone asks for one,
the house moves into the job manager. The CRM never produces, stores or sends
a roof report.

## Outreach app (being built)

| | Partners side | Homes side |
|---|---|---|
| One record | realtor, inspector, insurance agent, property manager | a house from the Gregg County list (1,074) |
| Reach | email first, then a call | postcard first, then a knock. No email, no cold calls |
| Stages | Prospect → Contacted → Replied → Partner | Target → Mailed → Knocked → Talked → Roof check booked |
| A win | they send an address | the owner books a roof check |
| Tested | email versions A/B/C/E | postcard versions and neighborhoods |

Screens (phone first): Today · Partners · Partner record · Homes · Home record
· Campaign · Settings. A switch at the top moves between sides.

Build order: **1 Send and match** (Dec 1) → 2 Work the replies → 3 Homes
(before January) → 4 Referral network. Each version is used for real before
the next starts.

## Job manager (not being built now)

Roofr does it today. When built, it follows the SFM Job Manager pattern and
starts with Reports + Houses, then estimates, signed jobs, invoicing/QuickBooks,
after-the-job (warranty, reviews, Texas Roof Club). The hand-off package the
CRM sends is identical either way.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-06 | Repo starts as a contact-book idea on Apps Script; moved to Firebase for a whole-company hub. |
| 2026-11-18 | Brian's three briefs reframe the work as CRM (people) + job manager (houses). |
| 2026-11-19 | **Outreach app on Apps Script + Google Sheet + clasp**, SFM conventions, deployed under Tanner's account. Firebase stays as the escape hatch past a few thousand contacts (commit `0a7865b`, local tag `firebase-foundation`). |
| 2026-11-19 | Stripe for payments and QuickBooks Online as the books stay true for the job manager; not relevant to the CRM. |

## Who

| Person | Role in app | Does |
|---|---|---|
| Tanner Fought | sales | sends the daily batch, calls, logs referrals, knocks |
| Brian Kanzaki | owner | loads lists, writes versions, reads stats, builds the app |
| Caitlin | viewonly | social media and retargeting, outside the CRM |
