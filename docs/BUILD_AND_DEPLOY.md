# Build & Deploy — ArmorTex Platform (Firebase)

The app runs on **Firebase** (Google Cloud): Hosting serves `public/`,
Authentication handles sign-in, Firestore is the database, Cloud Storage holds
photos and PDFs. Nothing is compiled; `firebase deploy` uploads what's in the
repo.

```
GitHub (this repo) --git pull--> your laptop --firebase deploy--> https://<project>.web.app
```

> Moving from Apps Script? The old `src/` + clasp setup is gone as of phase 0.
> `clasp` is no longer used.

---

## 1. One-time: your laptop

1. **Node 20 or newer** (`node -v`).
2. **Firebase CLI**:

   ```bash
   npm install -g firebase-tools
   ```

3. **Log in** (opens a browser):

   ```bash
   firebase login
   ```

4. **Clone and check out the branch**:

   ```bash
   git clone https://github.com/nkanzaki84/ArmorTexAI.git
   ```

   ```bash
   cd ArmorTexAI && git checkout claude/brave-ride-ut2ts5 && npm install
   ```

## 2. One-time: create the Firebase project (in the browser, ~10 minutes)

1. Go to <https://console.firebase.google.com> → **Create a project** → name it
   `ArmorTex` (Firebase will suggest an id like `armortex-app` or
   `armortex-xxxxx`; note the id). Google Analytics: off is fine.
2. **Upgrade to the Blaze plan** (⚙ → *Usage and billing* → *Modify plan*).
   Pay-as-you-go with the same free tier; needed for Cloud Storage and, later,
   Cloud Functions. At our size this stays at $0–10/month. Set a budget alert
   ($25) while you're there.
3. **Authentication** → *Get started* → *Sign-in method* → **Google** → Enable
   → pick a support email → Save.
4. **Firestore Database** → *Create database* → location **`us-south1`
   (Dallas)** → *Start in production mode* (our rules file takes over on first
   deploy).
5. **Storage** → *Get started* → same location → production mode.
6. Point the repo at the project:

   ```bash
   firebase use --add
   ```

   Pick the project, alias `default`. (This rewrites `.firebaserc`; commit it.)

## 3. First deploy

```bash
firebase deploy
```

Deploys hosting, Firestore rules + indexes, and Storage rules. The output ends
with `Hosting URL: https://<project-id>.web.app`.

**Bootstrap yourself as owner** (one time, the rules won't let anyone in until
a `staff` doc exists):

1. Firebase console → *Firestore Database* → **Start collection**.
2. Collection ID: `staff`
3. Document ID: `nkanzaki84@gmail.com` (your Google sign-in email, lowercase)
4. Fields: `name` (string) = your name, `role` (string) = `owner` → Save.

Open the Hosting URL, **Sign in with Google**, go to **Team**, add the PM and
the admin. They sign in at the same URL.

## 4. Every update — the copy-paste loop

```bash
git pull
```

```bash
firebase deploy
```

Or both in one:

```bash
./deploy.sh "what changed"
```

Deploy only part of it when you know what changed:

```bash
firebase deploy --only hosting
```

```bash
firebase deploy --only firestore:rules
```

## 5. Run it locally (optional, no cloud touched)

```bash
npm run dev
```

Starts the emulators: app at <http://127.0.0.1:5000>, emulator UI at
<http://127.0.0.1:4000>. The Auth emulator lets you invent any sign-in. Add a
`staff` doc in the emulator UI (Firestore tab) to get past the gate. Nothing
persists between runs unless you export.

Rules tests (emulator starts and stops itself):

```bash
npm run test:rules
```

## 6. Custom domain (when you want app.armortex.com)

Firebase console → *Hosting* → *Add custom domain* → follow the DNS steps.
Then Authentication → *Settings* → *Authorized domains* → add it. Sign-in
keeps working on the `.web.app` URL too.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not load Firebase config` on the page | Page wasn't served by Hosting (opened the file directly?). Use the Hosting URL or `npm run dev`. |
| Sign-in popup closes, then "is not on the team yet" | Expected until your `staff/<email>` doc exists (section 3). Email must match exactly, lowercase. |
| `Missing or insufficient permissions` | Rules deployed? `firebase deploy --only firestore:rules`. Signed in with the right Google account? |
| `HTTP Error: 403 … billing` on deploy | Blaze plan not enabled (section 2.2). |
| `No project active` | `firebase use --add`. |
| Popup blocked on sign-in | Allow popups for the site, or try again (second click usually works). |
| Changes don't show after deploy | Hard refresh (Ctrl/Cmd+Shift+R); JS/CSS cache is 5 minutes. |

## 8. Repo layout

```
ArmorTexAI/
├── public/                  # the web app (Hosting)
│   ├── index.html           # auth gate + app shell + screens
│   ├── app.js               # Firebase init, sign-in, roles, Team screen, mock interactions
│   └── styles.css
├── firestore.rules          # who can read/write what
├── firestore.indexes.json
├── storage.rules
├── firebase.json            # hosting/firestore/storage/emulator config
├── .firebaserc              # which Firebase project (set by `firebase use --add`)
├── tests/                   # rules tests (run in the emulator)
├── mockups/                 # frozen UI mockups
├── docs/                    # this file, PLATFORM_PLAN.md, DATA_MODEL.md, IDEAS.md
├── deploy.sh                # git pull + firebase deploy
└── package.json             # dev scripts: dev, test:rules, deploy
```
