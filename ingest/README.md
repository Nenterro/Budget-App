# Budget Ingest

Turns bank SMS and push notifications forwarded from an iPhone into reviewable
transaction drafts in the budget app.

```
iPhone Shortcut ──HTTPS──▶ budget-ingest ──▶ PocketBase `inbox_messages`
  (SMS / notification)      parse text          plaintext draft
                                                      │
                                                 realtime sync
                                                      ▼
                                       Budget app "Detected Transactions"
                                       you confirm ▶ real encrypted transaction
                                                     draft deleted
```

## Why it stops at drafts

The budget data is end-to-end encrypted. Accounts, payees, categories and
transactions are AES-GCM blobs on the server, and the key is derived from a PIN
that never leaves the phone. This service holds no key, so a transaction it
wrote would be unreadable to the app.

So the work is split at the only place it can be:

- **The server** does what raw text allows: amount, direction, merchant string,
  card digits, date.
- **The app** does what needs the key and your judgement: which account, which
  payee, which category — then encrypts and saves through the normal path.

A draft is the handover. It is the one piece of readable financial text on the
server, and it is short-lived: deleted the moment you approve or dismiss it,
and swept automatically after `INBOX_RETENTION_DAYS` (30 by default) if you
never get to it.

## Deployment

Lives in `~/Docker/budget-ingest` on the home server, wired into the main
`~/Docker/docker-compose.yml` as the `budget-ingest` service on port 8099.

```bash
cd ~/Docker/budget-ingest
cp .env.example .env      # already done - the token is generated
nano .env                 # fill PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD
chmod 600 .env

cd ~/Docker
docker compose up -d budget-ingest
docker compose logs -f budget-ingest
```

On first boot it authenticates as admin, creates the `inbox_messages`
collection if it is missing, and resolves `BUDGET_USER_EMAIL` to a user id. If
PocketBase is not up yet it retries with backoff rather than exiting, so
container start order does not matter.

Check it:

```bash
curl -s localhost:8099/health
# {"status":"ok","templates":24,"collection":"inbox_messages","error":null}
```

`status: "starting"` with a non-null `error` means it has not reached
PocketBase — the error says why.

## Exposing it

Add a proxy host in nginx-proxy-manager (`http://100.97.146.42:81`):

| Field | Value |
| --- | --- |
| Domain | e.g. `huz-ingest.duckdns.org` |
| Scheme | `http` |
| Forward host | `budget-ingest` (or the server's LAN IP) |
| Forward port | `8099` |
| Block common exploits | on |
| Websockets | off |
| SSL | request a Let's Encrypt certificate, force SSL, HTTP/2 |

The endpoint must be reachable over the public internet, not just Tailscale,
or the Shortcut silently fails whenever the VPN is off — which on a phone is
most of the time.

**Use port 8888, not 443.** The ISP blocks inbound 443 on this connection,
which is why PocketBase is already published on 8888. nginx-proxy-manager maps
both `443:443` and `8888:443`, so the same proxy host serves both — but only
the 8888 URL answers from outside:

```
https://huz-ingest.duckdns.org:8888/health   # works
https://huz-ingest.duckdns.org/health        # times out
```

What protects it: a 256-bit token per person, a 60 requests/minute per-IP
ceiling, and the fact that the worst a valid token can do is put a draft in a
queue that person has to approve by hand.

## The iPhone Shortcuts

One shortcut per bank, rather than one catch-all. Each automation is filtered
to that bank's sender and hardcodes the `sender` value it posts, which means
template matching never depends on how iOS happens to report the sender — and
a bank whose parsing is misbehaving can be switched off on its own.

### Build the shortcut

**Shortcuts ▸ + ▸ Add Action ▸ Get Contents of URL**

| Field | Value |
| --- | --- |
| URL | `https://huz-ingest.duckdns.org:8888/ingest/sms` |
| Method | `POST` |
| Headers | `X-Ingest-Token`: *your key from Settings ▸ Detection Rules* |
| Request Body | JSON |

JSON fields:

| Key | Type | Value |
| --- | --- | --- |
| `text` | Text | **Shortcut Input** (the message body) |
| `sender` | Text | a fixed string — see the table below |

`receivedAt` is optional; leave it out and the server timestamps on arrival.

### Routing to the right person

Each person has their own ingest key, shown in the budget app under
**Settings ▸ Detection Rules ▸ Your ingest key**. They paste that into the
`X-Ingest-Token` header of their own shortcut, and that is the whole setup.

The key identifies the account by itself, so a shortcut carries no email and no
`user` field, and a message sent with it can only ever reach that person's
budget. There is nothing to configure on the server: the key is minted by the
app, stored on the user's own record, and looked up here.

Keys are looked up on every request rather than cached, so **Create a new key**
in the app retires the old one immediately — which is what makes it useful when
a phone is lost.

The shared `INGEST_TOKEN` still works and still honours a `user` field naming
an account email, which is what the shortcuts predating per-person keys use.
It also remains the credential for `/parse/test`, `/templates` and
`/admin/reload`, which are server-wide rather than anyone's in particular.

Prefer the per-person key. The shared token can file into any account on the
server by naming its email, so it should not go beyond whoever administers it.

### Notifications

`POST /ingest/notification` takes `{"body": ..., "title": ..., "app": ...}` and
parses title and body as one message, since either half can carry the amount.

Point whatever notification-forwarding automation you use at that endpoint with
the same `X-Ingest-Token` header, mapping the notification's app name to `app`
and its text to `body`. Everything downstream — parsing, dedupe, the review
queue — is identical to the SMS path; `source` is recorded as `notification` so
the two can be told apart.

## Tuning the parsers

Templates are JSON in `templates/`, mounted into the container rather than
baked into the image, so changing one is an edit and a reload:

```bash
# See how a real message parses, without storing anything
curl -s -X POST https://huz-ingest.duckdns.org:8888/parse/test \
  -H "X-Ingest-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Your Debit Card ending 4321 was used for PKR 3,499.00 at METRO on 08-Sep-26","sender":"UBL"}'

nano templates/10-wallets.json

curl -s -X POST https://huz-ingest.duckdns.org:8888/admin/reload \
  -H "X-Ingest-Token: $TOKEN"
```

Files load in filename order and the **first** template whose sender and regex
both match wins, so precise patterns belong in `10-` and broad sender
recognition in `20-`.

- `10-wallets.json` — patterns with named groups (`amount`, `currency`,
  `merchant`, `last4`, `date`, `reference`) for senders whose wording is
  stable.
- `20-banks.json` — sender recognition only. The regex is `.`; all these do is
  label the bank and let the generic extractors do the work. That is
  deliberate: bank wording changes often, and the generic amount extractor
  already knows to skip the running balance, which hand-written per-bank
  regexes usually get wrong.

Any group a template omits is filled in afterwards by the generic extractors,
so a template only has to describe what is genuinely distinctive.

Run the parser tests after editing:

```bash
docker exec budget-ingest python -m tests.test_parsers   # if tests were copied
# or, on the host:
cd ~/Docker/budget-ingest && python3 -m tests.test_parsers
```

## Endpoints

All except `/health` require the token, in either `Authorization: Bearer <t>`
or `X-Ingest-Token: <t>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness, template count, connection error |
| POST | `/ingest/sms` | `{text, sender?, receivedAt?}` |
| POST | `/ingest/notification` | `{body, title?, app?, receivedAt?}` |
| POST | `/ingest` | Loose: JSON with any of text/body/message, or bare text |
| POST | `/parse/test` | Dry run — parse and return, store nothing |
| GET | `/templates` | What is loaded |
| POST | `/admin/reload` | Re-read the template directory |

An ingest call returns `{"stored": true, "id": ...}`, or `stored: false` with a
reason:

- `not-transactional` — an OTP, a marketing blast, a balance advisory. Dropped
  on purpose, so the review queue stays worth opening.
- `duplicate` — the same text already arrived within `DEDUPE_WINDOW_HOURS`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PB_URL` | `http://pocketbase:8090` | PocketBase, by container name |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | — | Admin login, required |
| `BUDGET_USER_EMAIL` | — | Whose queue drafts go into when none is named |
| `INGEST_USERS` | `{}` | Optional JSON of short alias -> email, for the shared token |
| `INGEST_TOKEN` | — | Shared secret for the Shortcut |
| `INBOX_COLLECTION` | `inbox_messages` | Collection name |
| `INBOX_RETENTION_DAYS` | `30` | Age at which unreviewed drafts are swept |
| `DEDUPE_WINDOW_HOURS` | `24` | How long identical text counts as a repeat |
