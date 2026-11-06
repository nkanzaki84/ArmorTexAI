# Build & Deploy — ArmorTex Contact Book

The app is a **Google Apps Script web app** pushed from this repo with **clasp**.
Nothing is compiled: `src/` is pushed as-is to your Apps Script project, and a
*deployment* turns a pushed version into a stable URL.

```
GitHub (this repo)  --git pull-->  your laptop  --clasp push-->  Apps Script project  --clasp deploy-->  web app URL
```

Stack (planned, see `docs/IDEAS.md` for alternatives):

| Layer | Choice | Why |
|---|---|---|
| UI | HtmlService single page (`src/Index.html`) | One file, works on phone + desktop |
| Server | Apps Script V8 (`src/*.js`) | Free, no servers, runs as you |
| Storage | Google Sheet ("Contact Book") | Visible, filterable, exportable, zero setup |
| Parsing | Rules first, Gemini (Google AI / Vertex) for odd blurbs | Free + instant for the normal format |

---

## 1. One-time setup on your laptop

1. **Node 20 or newer** (clasp 3 requires it). Check with `node -v`.
2. **Install clasp** (3.x):

   ```bash
   npm install -g @google/clasp
   ```

3. **Turn on the Apps Script API** for your Google account (clasp can't push
   without it): <https://script.google.com/home/usersettings> → *Google Apps
   Script API* → **On**.
4. **Log in** (opens a browser):

   ```bash
   clasp login
   ```

5. **Clone the repo and check out the working branch**:

   ```bash
   git clone https://github.com/nkanzaki84/ArmorTexAI.git
   cd ArmorTexAI
   git checkout claude/brave-ride-ut2ts5
   ```

## 2. Create the Apps Script project (once)

`.clasp.json` is git-ignored because it points at *your* script. Pick one:

**Option A — let clasp create it** (from the repo root):

```bash
clasp create-script --type webapp --title "ArmorTex Contact Book" --rootDir src
```

```bash
git checkout -- src/appsscript.json
```

The second command matters: `create-script` pulls the brand-new project's empty
manifest into `src/`, overwriting ours. The checkout restores the real one
(time zone, V8 runtime, web app settings).

**Option B — create it in the browser**: go to <https://script.new>, name it,
open *Project Settings* → copy the **Script ID**, then:

```bash
cp .clasp.json.example .clasp.json
```

and paste the ID into `.clasp.json`.

Either way you should now have `.clasp.json` in the repo root with
`"rootDir": "src"`.

## 3. First push and first deployment

```bash
clasp push -f
```

```bash
clasp create-deployment -d "v0 mockup"
```

The output ends with a line like `- AKfycb...XYZ @1`. That `AKfycb…` string is
your **Deployment ID**. Save it once so later deploys reuse the same URL:

```bash
echo "AKfycb...XYZ" > .deployment-id
```

Open the app:

```bash
clasp open-web-app "$(cat .deployment-id)"
```

(or `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`). The first visit
shows Google's authorization screen; it's your own unverified script, so click
*Advanced* → *Go to ArmorTex Contact Book*.

## 4. Every update after that — the copy-paste loop

This is the block you'll get at the end of every change:

```bash
git pull
```

```bash
clasp push -f
```

```bash
clasp create-deployment -i "$(cat .deployment-id)" -d "what changed"
```

Or all three in one go:

```bash
./deploy.sh "what changed"
```

**Why `-i`?** `clasp create-deployment` *without* `-i` creates a brand-new
deployment with a brand-new URL every time. Passing the saved ID updates the
deployment you already bookmarked.

**Why `-f`?** It lets clasp overwrite the remote `appsscript.json` manifest, so
changes to time zone, scopes, or web app access actually land.

Tip while developing: `clasp push --watch` pushes on every file save. Visit the
`/dev` URL (`clasp open-script` → *Deploy* → *Test deployments*) to see the HEAD
code without redeploying.

## 5. Settings the app will need (when the real code lands)

These are **Script Properties** (Apps Script editor → ⚙ *Project Settings* →
*Script Properties*). They stay out of git.

| Property | Used for | Where to get it |
|---|---|---|
| `SHEET_ID` | The "Contact Book" spreadsheet | Optional. If missing the app creates a sheet on first run and stores the ID here itself. |
| `GEMINI_API_KEY` | AI parsing fallback | <https://aistudio.google.com/apikey> (free tier is plenty for this volume) |

If you'd rather use **Vertex AI** through a Google Cloud project instead of an
AI Studio key: link the script to your GCP project (*Project Settings* → *Google
Cloud Platform project*), enable the Vertex AI API, and the script calls Vertex
with its own OAuth token. No key to manage. That's a later swap; AI Studio is
the quickest path to a working v1.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `User has not enabled the Apps Script API` | Step 1.3, then wait a minute and retry. |
| `Project file already exists` on create | You already have `.clasp.json`. Delete it or skip to step 3. |
| Push says files would be overwritten / manifest error | Run `clasp push -f`. |
| New URL every deploy | You forgot `-i "$(cat .deployment-id)"`. List deployments with `clasp list-deployments`. |
| Web app shows old code | You pushed but didn't deploy (step 4, third command). |
| `Script function not found: doGet` | `src/Code.js` didn't push. `clasp show-file-status` lists what will be pushed. |
| "This app isn't verified" | Expected for a personal script. *Advanced* → *Go to…* |
| Wrong times on appointments | Time zone is set in `src/appsscript.json` (`America/Chicago`). |

## 7. Repo layout

```
ArmorTexAI/
├── src/                     # everything here is pushed to Apps Script
│   ├── appsscript.json      # manifest: time zone, runtime, web app access
│   ├── Code.js              # server entry (doGet) — becomes Code.gs remotely
│   └── Index.html           # the single-page UI (currently the v0 mockup)
├── mockups/                 # frozen UI mockups, one file per revision
│   └── v0-contact-book.html
├── docs/
│   ├── BUILD_AND_DEPLOY.md  # this file
│   └── IDEAS.md             # the ideas notebook
├── deploy.sh                # git pull + clasp push + clasp deploy
├── .clasp.json.example      # copy to .clasp.json and fill in your Script ID
└── .gitignore               # keeps .clasp.json / .deployment-id local
```
