# ArmorTex Contact Book

Paste a lead blurb from the appointment-setter email, review the parsed fields,
save it to the contact book. Built on Google Apps Script, deployed with clasp.

Example input:

```
11/02/2026 1:00 PM Loretta Nelson 7195982885 214 Bayhills Dr Hideaway TX 75771 Homeowner Yes 4 Years Old SFH Insured No Contract
```

## Status

**v0 — UI mockup.** `src/Index.html` is a clickable mockup with sample data;
there is no parsing or storage yet. Deploy it to review the design in the real
environment, then we build the code behind it.

## Start here

- **Build & deploy:** [`docs/BUILD_AND_DEPLOY.md`](docs/BUILD_AND_DEPLOY.md)
- **Ideas notebook:** [`docs/IDEAS.md`](docs/IDEAS.md)
- **Mockups:** [`mockups/`](mockups/) (open the HTML file in a browser)

## Everyday loop

```bash
./deploy.sh "what changed"
```

which is just `git pull`, `clasp push -f`, and
`clasp create-deployment -i "$(cat .deployment-id)" -d "what changed"`.

## How it works (planned)

1. **Paste** the blurb into the web app.
2. **Parse** with rules for the standard format; fall back to Gemini for messy
   text.
3. **Review** the fields, with a confidence dot per field.
4. **Save** to a Google Sheet (one row per contact, original blurb kept).
   Duplicate phone numbers are flagged before writing.
