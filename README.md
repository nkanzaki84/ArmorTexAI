# ArmorTex Outreach

The CRM for ArmorTex Roofs: one app with two sides. **Partners** (realtors,
inspectors, insurance agents, property managers) are reached by email, then a
call. **Homes** (1,074 target houses in Gregg County) are reached by postcard,
then a door knock. Every win becomes a roof report request handed to the job
manager (Roofr today, ArmorTex's own Job Manager later).

Google Apps Script web app + one Google Sheet, deployed with clasp, built the
same way as the SFM Job Manager.

## Start here

- **Specs:** [`docs/briefs/`](docs/briefs/) (Outreach design brief, marketing
  strategy briefing, Job Manager brief)
- **The system in one page:** [`docs/SYSTEM.md`](docs/SYSTEM.md)
- **Build & deploy:** [`docs/BUILD_AND_DEPLOY.md`](docs/BUILD_AND_DEPLOY.md)
- **Data model:** [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- **Ideas notebook:** [`docs/IDEAS.md`](docs/IDEAS.md)
- **Working context for Claude Code:** [`CLAUDE.md`](CLAUDE.md)

## Status

Version 1 (send and match) in progress, due Dec 1, 2026. Done and tested:
Sheet setup, roles, partner import, version assignment, daily batch builder,
version validation, campaign stats, settings. Next: sending and the reply
check, then wiring the screens.

## Everyday loop

```bash
git pull
```

```bash
clasp push -f
```

Reload the /dev URL. Promote to Tanner's /exec URL only when a batch is ready:

```bash
./deploy.sh "v0.1.x - what changed"
```

Tests: `npm test`.
