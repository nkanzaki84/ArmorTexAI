# Build & Deploy — ArmorTex Outreach (Apps Script + clasp)

The app is a Google Apps Script web app backed by one Google Sheet. `src/` is
pushed as-is with clasp. There are two URLs:

- **/dev** runs whatever was last pushed. Daily driver. Only the deploying
  account can open it.
- **/exec** is pinned to a numbered version. Tanner's URL. Promote to it only
  when a batch is ready, because every promotion uses one of the script's 200
  lifetime versions.

```
GitHub ──git pull──▶ laptop ──clasp push -f──▶ /dev (test) ──./deploy.sh──▶ /exec (Tanner)
```

## 1. One-time: laptop

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

Log in as the account the app will run under (see section 2). Turn on the
Apps Script API for that account at <https://script.google.com/home/usersettings>.

```bash
git clone https://github.com/nkanzaki84/ArmorTexAI.git && cd ArmorTexAI && git checkout claude/brave-ride-ut2ts5 && npm install
```

## 2. One-time: the Apps Script project

**Which account?** The app sends email as the account that deploys it, and
the reply check reads that inbox. Decision (2026-11-19): **Brian's mailbox**,
brian@armortexroofs.com, which is the account `clasp login` already uses.

Already done on 2026-11-19: script id
`1z2Eqy4wg5bS4yvP-XTJqySW0mApdymXBlsT7Ps2scgydlwjz4HJ8foqv`. On a new machine
just write `.clasp.json` from `.clasp.json.example` with that id. To create a
fresh project instead (clasp 2.x on Brian's Mac; 3.x accepts the same):

```bash
clasp create --title "ArmorTex Outreach" --rootDir src
```

Choose `webapp` at the prompt. If no `.clasp.json` appears in the repo root,
write it by hand with the script id clasp printed.

```bash
git checkout -- src/appsscript.json
```

The second command restores our manifest (time zone, scopes, domain access),
which `create-script` overwrites with an empty one. You now have a
git-ignored `.clasp.json`.

## 3. First push and setup

```bash
clasp push -f
```

```bash
clasp open
```

(`clasp open-script` on clasp 3.x.) In the editor: pick `setup` in the function dropdown → Run → approve the
permissions (Sheets, Drive, Gmail). `setup()` creates the Sheet "ArmorTex
Outreach" with all tabs, seeds settings and versions A/B/C/E, and adds Brian
as owner. Re-running it is safe; it only appends missing columns.

Share the Sheet with Brian (Editor). Its URL shows on the Settings page too.

Then deploy once so /exec exists:

```bash
./deploy.sh "v0.1.0 first deploy"
```

Open the /dev URL (editor → Deploy → Test deployments) to work, or the /exec
URL from the deploy output for Tanner. Then on **Settings**:

1. **Team**: add Tanner as `sales`, Caitlin as `viewonly`.
2. **Sending**: business street address and opt-out line (sending is blocked
   until both exist), sender name, signature.
3. **Reply check**: press *Install / repair trigger* once. It runs
   `checkReplies` every 15 minutes as you.
4. **Test batch**: paste five of your own addresses → *Create test partners*.
   On **Campaign** write versions A/B/C (saving checks the footer rules). On
   **Today** press *Send anyway (test)* if it isn't a Tue–Thu. Reply from each
   inbox; within 15 minutes (or *Check replies now*) each shows under New
   replies against the right version. That is the version-1 done test.
5. Import the real realtor list, *Assign versions*, and Dec 1 is a normal Tuesday.

## 4. Every change

Pull and push to /dev, reload the /dev tab:

```bash
git pull
```

```bash
clasp push -f
```

Only when a batch is ready for Tanner:

```bash
./deploy.sh "v0.1.1 - what changed"
```

Bump `APP_VERSION` / `APP_BUILD_DATE` in `src/Config.gs` when you promote; the
footer shows it so screenshots tell you which build they are from.

## 5. Tests

```bash
npm test
```

Runs the Node test harness against a fake Apps Script runtime. No Google
account involved. Add a test before changing version assignment, batch
building, reply matching or do-not-contact.

Preview the whole app locally, with sample data and no Google account:

```bash
npm run preview
```

Open <http://127.0.0.1:8787/?page=today>. Add `&as=tanner@armortexroofs.com`
to see it as Tanner. Data resets when you stop the server.

## 6. Triggers

The reply check runs every 15 minutes from a time-driven trigger. Install it
from Settings → Reply check (or run `installTriggers()` in the editor) as the
deploying account. Sending itself has no trigger: a person presses Send.

Follow-ups are sent inside the original Gmail thread through the Gmail
advanced service, which `src/appsscript.json` enables; the first `clasp push -f`
after this change asks for the extra Gmail permission when you next run
anything from the editor. Approve it.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `User has not enabled the Apps Script API` | Section 1 link, wait a minute, retry. |
| `Project file already exists` | `.clasp.json` is there already; skip to section 3. |
| "Outreach Sheet not initialized" | Run `setup()` from the editor as the deploying account. |
| Page says you're not on the Users list | Owner adds you under Settings → Team. Email must match your Google sign-in exactly. |
| /exec shows old code | You pushed but didn't promote. `./deploy.sh`. |
| Emails send from the wrong person | The script runs as whoever deployed it. Re-create the project under the right account (section 2). |
| Wrong times | Time zone is in `src/appsscript.json` (`America/Chicago`). |
| Out of versions (200) | Create a new Apps Script project, point `.clasp.json` at it, push, run `setup()` with the existing Sheet ID set in Script Properties (`OUTREACH_SHEET_ID`). |

## 8. Repo layout

```
ArmorTexAI/
├── src/                  # pushed to Apps Script
│   ├── appsscript.json   # manifest: tz, scopes, DOMAIN access, run as deployer
│   ├── Config.gs         # tabs, headers, enums, settings, roles
│   ├── Code.gs           # doGet routing, include(), setup()
│   ├── sheet.gs          # read/write helpers
│   ├── users.gs          # roles + permission checks
│   ├── partners_server.gs       # import, version assignment, partner record
│   ├── campaign_server.gs       # versions, daily batch, stats, settings
│   └── *.html            # index shell + one include per page
├── tests/                # node --test; fakes/apps-script.js is the runtime
├── docs/
│   ├── briefs/           # the three PDF specs
│   ├── SYSTEM.md         # how the two apps fit, decisions
│   ├── DATA_MODEL.md     # every tab and column
│   ├── IDEAS.md          # ideas notebook
│   └── BUILD_AND_DEPLOY.md
├── CLAUDE.md             # working context for the next session
├── deploy.sh             # push + promote to /exec
└── .clasp.json.example
```
