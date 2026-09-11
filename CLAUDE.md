# Budget App

An end-to-end encrypted personal budget app. React + Vite frontend, PocketBase
for storage, and a small Python service that turns forwarded bank SMS into
reviewable drafts.

## Where things live, and how they ship

Two halves, two completely separate deployment paths. Nearly every mistake in
this project has come from confusing them.

### Frontend — this repo

Everything in this repository is frontend: `src/`, `public/`, `index.html`,
`tests/`, the Vite and Vercel config.

- Worked on locally, on the dev machine.
- Committed and pushed to **`main`** on GitHub.
- **Vercel builds `main` and nothing else.** Pushing to `main` is the deploy.

Work on a branch if you like, but nothing is live until it reaches `main`. A
commit sitting on a feature branch is not deployed, however finished it looks,
and neither is one sitting unpushed on a local `main`.

### Backend — the home server only

The backend does not live here and is not in version control. It lives on the
home server under `~/Docker`, wired into one `docker-compose.yml`, and is
edited in place over SSH.

- `budget-ingest` — the SMS/notification parser (FastAPI). Source in
  `~/Docker/budget-ingest`.
- `pocketbase` — storage and auth, on port 8090, published as
  `huz-budget.duckdns.org:8888`.
- `duckdns` — keeps the duckdns hostnames pointed at the current IP.

So a backend change is not live until the container is rebuilt. Pushing to
GitHub does nothing for it — there is nothing here to push.

**Do not add backend code to this repo.** `/ingest/` is in `.gitignore` for
that reason, and the history explains it: the ingest service was tracked here
until September 2026, which gave one service two copies and nothing to keep
them in step. A parser fix landed in the tracked copy and never reached the
server, so the running parser stayed three days stale and kept misreading
outgoing RAAST transfers. It looked like a parser bug; it was a delivery bug.

## Working on the backend

The SSH address, server paths, the public routing table and the common
commands are in **`CLAUDE.local.md`**, which is gitignored because this repo is
public. It loads automatically alongside this file. If it is missing — a fresh
clone, a different machine — ask the user rather than guessing.

Then:

```bash
cd ~/Docker/budget-ingest

# Parser tests. This is now the ONLY place they exist - they left this repo
# with the rest of the service. Run them after any parser or template edit.
python3 -m tests.test_parsers

cd ~/Docker
docker compose up -d --build budget-ingest
```

Two things worth knowing before reaching for a rebuild:

- **Templates are bind-mounted**, not baked into the image. Editing
  `templates/*.json` needs only `POST /admin/reload` — no rebuild.
- **Python code is `COPY`'d in** at build time, so changes to `app/*.py` do
  need `--build`.

`budget-ingest` has `depends_on: pocketbase`, so rebuilding it recreates
PocketBase too — a few seconds of database downtime.

**Restarting and rebuilding the containers is pre-authorised.** A backend
change is not live until you do, so finishing the edit means shipping it: run
the restart or rebuild yourself rather than handing the user a command. Say
what you ran and what it cost, and prefer the cheaper option when it will do —
a template-only edit reloads without touching a container at all.

To check what the running service actually thinks of a message, without
storing anything:

```bash
cd ~/Docker/budget-ingest && TOKEN=$(grep -E '^INGEST_TOKEN=' .env | cut -d= -f2-)
curl -s -X POST http://127.0.0.1:8099/parse/test \
  -H "X-Ingest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"<the SMS>","sender":"Askari"}'
```

When a draft parses wrong, check this first. It distinguishes a genuine parser
fault from a stale container, and those look identical from the app.

## How a draft reaches the app

```
iPhone Shortcut ──HTTPS──▶ budget-ingest ──▶ PocketBase `inbox_messages`
   (SMS / notification)     parses text        plaintext draft
                                                     │ realtime sync
                                                     ▼
                                      "Detected Transactions" in the app
                                      you confirm ▶ encrypted transaction
```

The app does **no parsing**. `src/store/inbox.js` reads back the `parsed` JSON
column the server already wrote, so anything wrong with a draft's amount,
payee, date or last4 was decided on the server before the app saw it.

The split exists because the budget data is end-to-end encrypted: accounts,
payees, categories and transactions are AES-GCM blobs, and the key comes from
a PIN that never leaves the phone. The server holds no key, so it can only do
what raw text allows. The app does what needs the key and your judgement.

A draft already in the inbox was parsed at receive time and will not re-parse
itself. After fixing the parser, the old draft has to be dismissed and the
message re-forwarded.

## This repo

```bash
npm run dev
npx vite build
node tests/run.mjs     # frontend test suite
```

- The repo is **public**. No secrets, tokens, internal addresses or
  server-side config in committed files.
- Stats, charts, budgets and dashboard widgets all read transactions through
  `getEffectiveReportingItems` in `src/utils/txAdjustments.js`, which nets a
  shared expense down to your own share and wipes a repaid loan from both
  sides. New reporting surfaces should go through it too, or they will
  disagree with the ones that do.
- Modal and page styling comes from the tokens and shared shell in
  `src/index.css` — surfaces, borders, radii, the modal shell, buttons, the
  segmented control. Component stylesheets should consume those rather than
  restating literals. Class names defined in one component's stylesheet but
  used by another have broken repeatedly under code splitting; shared ones
  belong in `index.css`, which is always loaded.
