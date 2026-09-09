"""Budget ingest webhook.

Accepts a bank SMS or push notification forwarded from the phone, parses it
into a draft, and files that draft in PocketBase for the app to review.

It deliberately stops short of creating transactions. The budget data is
end-to-end encrypted and this service holds no key, so a transaction it wrote
would be unreadable to the app. Drafts are the handover point: the server does
the text wrangling, the app does the part that needs the key and the user's
judgement.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dateutil import parser as dateparser
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import parsers
from .config import settings
from .pocketbase import PocketBaseClient, PocketBaseError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("ingest")

PURGE_INTERVAL_SECONDS = 12 * 60 * 60

state = {"client": None, "user_id": None, "ready": False, "last_error": None}


# --- request models --------------------------------------------------------

class SmsPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    sender: str | None = Field(None, max_length=200)
    receivedAt: str | None = None


class NotificationPayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    title: str | None = Field(None, max_length=300)
    app: str | None = Field(None, max_length=200)
    receivedAt: str | None = None


class ParseTestPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    sender: str | None = None


# --- auth ------------------------------------------------------------------

def require_token(authorization, x_ingest_token):
    """Accept the secret from either header.

    iOS Shortcuts can send an Authorization header, but a custom header is far
    less fiddly to get right in the Shortcuts UI, so both work.
    """
    presented = None
    if authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:].strip()
    elif x_ingest_token:
        presented = x_ingest_token.strip()

    if not presented or not hmac.compare_digest(presented, settings.ingest_token):
        raise HTTPException(status_code=401, detail="Invalid or missing ingest token")


# --- rate limit ------------------------------------------------------------
# A public endpoint holding a static token deserves a ceiling. This is a small
# fixed-window counter per client address - enough to blunt a token guesser or
# a Shortcut stuck in a retry loop, without pretending to be a real WAF.
_rate_buckets = {}
RATE_LIMIT = 60
RATE_WINDOW = 60


def check_rate_limit(client_ip):
    now = time.time()
    window = int(now // RATE_WINDOW)
    key = (client_ip, window)

    # Drop windows that have rolled over so the dict cannot grow without bound.
    for existing in [k for k in _rate_buckets if k[1] < window - 1]:
        _rate_buckets.pop(existing, None)

    count = _rate_buckets.get(key, 0) + 1
    _rate_buckets[key] = count
    if count > RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many requests")


# --- helpers ---------------------------------------------------------------

def parse_received_at(raw):
    """Trust the phone's timestamp when it sends one, else use arrival time."""
    if not raw:
        return datetime.now(timezone.utc)
    try:
        parsed = dateparser.parse(raw)
    except (ValueError, OverflowError, TypeError):
        return datetime.now(timezone.utc)
    if not parsed:
        return datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def dedupe_hash(source, sender, text):
    """Identity of a message for duplicate suppression.

    Built from the text itself rather than from arrival time, because the
    thing being guarded against is the same message arriving twice at
    different times - a Shortcut retry, or a flaky upload. Bank messages carry
    a reference number or timestamp of their own, which is what keeps two
    genuinely separate purchases from colliding.
    """
    normalised = re.sub(r"\s+", " ", (text or "").strip().lower())
    digest = hashlib.sha256(
        f"{source}|{(sender or '').lower()}|{normalised}".encode("utf-8")
    )
    return digest.hexdigest()


async def store_draft(source, sender, text, received_at):
    if not state["ready"]:
        raise HTTPException(
            status_code=503,
            detail=f"Ingest service not connected to PocketBase: {state['last_error']}",
        )

    client = state["client"]
    user_id = state["user_id"]

    result = parsers.parse_message(text, sender=sender, received_at=received_at)

    # Nothing that looks like money in it - an OTP, a marketing blast, a
    # balance advisory. Acknowledge and drop, so the review queue stays worth
    # opening.
    if result["isNoise"]:
        log.info("Ignored non-transactional message from %s", sender or "unknown")
        return {"stored": False, "reason": "not-transactional", "parsed": result}

    digest = dedupe_hash(source, sender, text)
    duplicate = await client.find_duplicate(
        digest, user_id, settings.dedupe_window_hours
    )
    if duplicate:
        log.info("Duplicate message ignored (existing draft %s)", duplicate["id"])
        return {"stored": False, "reason": "duplicate", "id": duplicate["id"],
                "parsed": result}

    record = {
        "source": source,
        "sender": sender or "",
        "rawText": text,
        "receivedAt": received_at.strftime("%Y-%m-%d %H:%M:%S.%fZ"),
        "parsed": result["parsed"],
        "templateId": result["templateId"] or "",
        "confidence": result["confidence"],
        "status": "pending",
        "dedupeHash": digest,
        "users": user_id,
    }

    try:
        created = await client.create_draft(record)
    except PocketBaseError as err:
        log.error("Failed to store draft: %s", err)
        raise HTTPException(status_code=502, detail=str(err)) from err

    log.info(
        "Stored draft %s (%s %s, confidence %.2f, template %s)",
        created["id"],
        result["parsed"].get("currency"),
        result["parsed"].get("amount"),
        result["confidence"],
        result["templateId"] or "generic",
    )
    return {"stored": True, "id": created["id"], "parsed": result}


# --- lifecycle -------------------------------------------------------------

async def purge_loop():
    while True:
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)
        try:
            if state["ready"]:
                await state["client"].purge_older_than(
                    settings.retention_days, state["user_id"]
                )
        except Exception as err:  # noqa: BLE001 - a sweep must never kill the app
            log.warning("Purge run failed: %s", err)


async def connect():
    """Bring the PocketBase side up. Retried in the background so the webhook
    still binds its port when PocketBase is slow to start."""
    client = PocketBaseClient(
        settings.pb_url,
        settings.pb_admin_email,
        settings.pb_admin_password,
        settings.collection,
    )
    state["client"] = client
    await client.authenticate()
    await client.ensure_collection()
    state["user_id"] = await client.resolve_user_id(settings.budget_user_email)
    state["ready"] = True
    state["last_error"] = None
    log.info("Ready. Filing drafts for user %s", state["user_id"])
    await client.purge_older_than(settings.retention_days, state["user_id"])


async def connect_with_retry():
    delay = 5
    while not state["ready"]:
        try:
            await connect()
        except Exception as err:  # noqa: BLE001 - keep retrying, report why
            state["last_error"] = str(err)
            log.error("Startup connection failed (retrying in %ds): %s", delay, err)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 300)


@asynccontextmanager
async def lifespan(_app):
    parsers.load_templates(settings.template_dir)
    connector = asyncio.create_task(connect_with_retry())
    purger = asyncio.create_task(purge_loop())
    try:
        yield
    finally:
        for task in (connector, purger):
            task.cancel()
        if state["client"]:
            await state["client"].close()


app = FastAPI(title="Budget Ingest", version="1.0.0", lifespan=lifespan)


# --- routes ----------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok" if state["ready"] else "starting",
        "templates": len(parsers.get_templates()),
        "collection": settings.collection,
        "error": state["last_error"],
    }


@app.post("/ingest/sms")
async def ingest_sms(
    payload: SmsPayload,
    request: Request,
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    require_token(authorization, x_ingest_token)
    check_rate_limit(request.client.host if request.client else "unknown")
    return await store_draft(
        "sms", payload.sender, payload.text, parse_received_at(payload.receivedAt)
    )


@app.post("/ingest/notification")
async def ingest_notification(
    payload: NotificationPayload,
    request: Request,
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    require_token(authorization, x_ingest_token)
    check_rate_limit(request.client.host if request.client else "unknown")

    # A notification splits what an SMS says in one string across title and
    # body, and either half can hold the amount. Parse them as one message.
    text = " ".join(part for part in (payload.title, payload.body) if part)
    sender = payload.app or payload.title
    return await store_draft(
        "notification", sender, text, parse_received_at(payload.receivedAt)
    )


@app.post("/ingest")
async def ingest_any(
    request: Request,
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    """Loose entry point for automations that cannot shape a JSON body.

    Takes JSON with any of text/body/message, or a bare text/plain body.
    """
    require_token(authorization, x_ingest_token)
    check_rate_limit(request.client.host if request.client else "unknown")

    raw = await request.body()
    body = raw.decode("utf-8", errors="replace").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body")

    text, sender, received, source = None, None, None, "sms"
    try:
        data = json.loads(body)
        if isinstance(data, dict):
            text = data.get("text") or data.get("body") or data.get("message")
            title = data.get("title")
            if title and text and title not in text:
                text = f"{title} {text}"
            elif title and not text:
                text = title
            sender = data.get("sender") or data.get("from") or data.get("app")
            received = data.get("receivedAt") or data.get("date")
            source = data.get("source") or source
        elif isinstance(data, str):
            text = data
    except json.JSONDecodeError:
        text = body

    if not text:
        raise HTTPException(
            status_code=400, detail="No message text found in request body"
        )
    if source not in ("sms", "notification", "email"):
        source = "sms"

    return await store_draft(source, sender, text[:4000], parse_received_at(received))


@app.post("/parse/test")
async def parse_test(
    payload: ParseTestPayload,
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    """Dry run: parse and return, store nothing.

    This is how a new bank's format gets pinned down - paste a real message,
    look at what came out, adjust the template, reload, repeat.
    """
    require_token(authorization, x_ingest_token)
    return parsers.parse_message(
        payload.text, sender=payload.sender, received_at=datetime.now(timezone.utc)
    )


@app.get("/templates")
async def list_templates(
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    require_token(authorization, x_ingest_token)
    return {
        "count": len(parsers.get_templates()),
        "templates": [
            {"id": t.id, "bank": t.bank, "confidence": t.confidence,
             "senders": [s.pattern for s in t.senders]}
            for t in parsers.get_templates()
        ],
    }


@app.post("/admin/reload")
async def reload_templates(
    authorization: str | None = Header(None),
    x_ingest_token: str | None = Header(None),
):
    require_token(authorization, x_ingest_token)
    loaded = parsers.load_templates(settings.template_dir)
    return {"reloaded": len(loaded)}


@app.exception_handler(PocketBaseError)
async def pocketbase_error_handler(_request, exc):
    return JSONResponse(status_code=502, content={"detail": str(exc)})
