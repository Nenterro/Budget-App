"""Turn a bank SMS or push notification into a structured draft.

Nothing here decides what a transaction *is* - that is the app's job, because
only the app can read the (encrypted) account, payee and category names. This
module answers the narrow question the server can actually answer from the raw
text: how much, which way, roughly who, and off which card.

Templates live in JSON under TEMPLATE_DIR rather than in this file. A bank that
changes its wording is then a config edit and a reload, not a rebuild.
"""
import json
import logging
import os
import re
from datetime import datetime, timezone

from dateutil import parser as dateparser

log = logging.getLogger(__name__)

# --- Currency --------------------------------------------------------------
# Local messages write the same currency half a dozen ways.
CURRENCY_ALIASES = {
    "PKR": "PKR", "RS": "PKR", "RS.": "PKR", "RUPEES": "PKR", "₨": "PKR",
    "USD": "USD", "$": "USD", "US$": "USD",
    "EUR": "EUR", "€": "EUR",
    "GBP": "GBP", "£": "GBP",
    "AED": "AED", "SAR": "SAR", "INR": "INR", "₹": "INR",
}

# The trailing period matters: Askari writes "PKR. 100.00", and without it the
# currency matched but the amount that followed did not.
CURRENCY_PATTERN = (
    r"(?:PKR|Rs|RS|USD|US\$|\$|EUR|€|GBP|£|AED|SAR|INR|₹|₨)\.?"
)

# Comma-grouped first, then plain digits. Written as two alternatives ordered
# the other way round, `\d{1,3}` won on "PKR 2009" and the amount silently
# became 200 — any four-digit amount without a comma was being truncated.
AMOUNT_PATTERN = r"\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"

# --- Direction -------------------------------------------------------------
# Longest, most specific phrases first so "has been credited" is not read as a
# debit merely because "debit card" appears elsewhere in the same message.
DEBIT_WORDS = [
    "has been debited", "was debited", "debited", "debit of", "you spent",
    "spent", "withdrawn", "withdrawal", "you have sent", "sent to",
    "purchase of", "purchase at", "paid to", "payment of", "you paid",
    "transferred to", "charged", "deducted", "utilized", "utilised",
]
CREDIT_WORDS = [
    "has been credited", "was credited", "credited", "credit of",
    "you have received", "you received", "received from", "deposited",
    "deposit of", "refund of", "refunded", "cash in", "salary",
    "transferred from", "added to your",
    # Wallet apps phrase an incoming transfer as something the *other* party
    # did: "HUZAIFA SADEEM sent you PKR 100". Without these, the only cue in
    # the message is the word "sent", which reads as money going out.
    "sent you", "money received",
]

# Messages that are not transactions at all. Filtering these at ingest keeps
# the review queue from filling with noise the user has to dismiss by hand.
NOISE_PATTERNS = [
    r"\bOTP\b", r"one[- ]time password", r"verification code",
    r"\bdo not share\b", r"is your code", r"\bactivation code\b",
    r"available balance is", r"balance enquiry", r"beware of fraud",
    r"\bwin\b.{0,20}\bprize\b", r"congratulations", r"unsubscribe",
]

LAST4_PATTERNS = [
    r"(?:card|a/c|acct|account|ac)\s*(?:no\.?|number)?\s*(?:ending(?:\s+(?:in|with))?)?\s*[*x•\-]{0,8}\s*(\d{4})\b",
    r"[*x•]{2,}\s*(\d{4})\b",
    r"ending\s+(?:in\s+)?(\d{4})\b",
]

MERCHANT_PATTERNS = [
    r"\bat\s+(?P<merchant>[A-Za-z0-9][A-Za-z0-9 .,'&*/@_-]{2,40}?)(?=\s+on\b|\s+for\b|\.\s|,\s|\s*$|\s+Avl|\s+Bal)",
    r"\bto\s+(?P<merchant>[A-Za-z0-9][A-Za-z0-9 .,'&*/@_-]{2,40}?)(?=\s+on\b|\s+for\b|\.\s|,\s|\s*$|\s+Avl|\s+Bal)",
    r"\bfrom\s+(?P<merchant>[A-Za-z0-9][A-Za-z0-9 .,'&*/@_-]{2,40}?)(?=\s+on\b|\s+for\b|\.\s|,\s|\s*$|\s+Avl|\s+Bal)",
]

# Trailing fragments the merchant regexes tend to swallow.
MERCHANT_TRIM = re.compile(
    r"\b(on|dated|at|for|avl|available|bal|balance|txn|trx|ref|tid|trn)\b.*$",
    re.IGNORECASE,
)


def normalise_currency(raw):
    if not raw:
        return None
    key = raw.strip().upper().rstrip(".")
    return CURRENCY_ALIASES.get(key) or CURRENCY_ALIASES.get(key + ".") or None


def parse_amount(raw):
    """'1,234.50' -> 1234.5. Returns None rather than guessing on junk."""
    if raw is None:
        return None
    cleaned = str(raw).replace(",", "").replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    # A zero-amount alert is an advisory, not a transaction.
    return value if value > 0 else None


def looks_like_noise(text):
    for pattern in NOISE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def detect_direction(text):
    """'debit' | 'credit' | None, decided by whichever cue appears first.

    Position matters more than list order: a message reading "credited ... to
    your debit card" is a credit, and the earliest cue is the one describing
    what actually happened.
    """
    lowered = text.lower()
    best_kind, best_index = None, len(lowered) + 1
    for word in DEBIT_WORDS:
        index = lowered.find(word)
        if index != -1 and index < best_index:
            best_kind, best_index = "debit", index
    for word in CREDIT_WORDS:
        index = lowered.find(word)
        if index != -1 and index < best_index:
            best_kind, best_index = "credit", index
    return best_kind


def extract_last4(text):
    for pattern in LAST4_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def clean_merchant(raw):
    if not raw:
        return None
    value = MERCHANT_TRIM.sub("", raw).strip(" .,-*/")
    value = re.sub(r"\s{2,}", " ", value)
    # A bare number is an account or phone number, not a merchant name.
    if len(value) < 3 or value.isdigit():
        return None
    return value


def extract_merchant(text):
    for pattern in MERCHANT_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            merchant = clean_merchant(match.group("merchant"))
            if merchant:
                return merchant
    return None


def extract_amount_and_currency(text):
    """First currency-tagged amount that is not the running balance.

    Bank messages almost always quote the balance too. Taking the first match
    blindly picked up that balance whenever the message led with it, so an
    amount preceded by an 'avl'/'bal' cue is skipped.
    """
    pattern = re.compile(
        r"(?P<currency>" + CURRENCY_PATTERN + r")\s*(?P<amount>" + AMOUNT_PATTERN + r")",
        re.IGNORECASE,
    )
    for match in pattern.finditer(text):
        preceding = text[max(0, match.start() - 28):match.start()].lower()
        if re.search(r"\b(avl|avail\w*|bal\w*|limit|remaining)\b", preceding):
            continue
        return (
            parse_amount(match.group("amount")),
            normalise_currency(match.group("currency")),
        )
    return None, None


def extract_datetime(text, fallback):
    """A date the message states, else when we received it."""
    patterns = [
        r"\b(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)",
        r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)",
        r"\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)",
        # Space-separated, as Askari writes it: "on 09 09 26 at 22 39". The
        # "on"/"dated" cue is required — on its own this shape also matches a
        # time, a reference number, or any other run of digit pairs.
        r"(?:\bon|\bdated)\s+(\d{2}\s+\d{2}\s+\d{2})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        try:
            parsed = dateparser.parse(match.group(1), dayfirst=True, fuzzy=False)
        except (ValueError, OverflowError, TypeError):
            continue
        if not parsed:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        # A "date" in the future is a misparse, not a scheduled payment.
        if parsed <= fallback:
            return parsed
    return fallback


# --- Templates -------------------------------------------------------------

class Template:
    def __init__(self, raw):
        self.id = raw["id"]
        self.bank = raw.get("bank", "")
        self.senders = [re.compile(s, re.IGNORECASE) for s in raw.get("senders", [])]
        self.regex = re.compile(raw["match"], re.IGNORECASE | re.DOTALL)
        self.direction = raw.get("direction", "auto")
        self.confidence = float(raw.get("confidence", 0.9))

    def sender_matches(self, sender):
        if not self.senders:
            return True
        if not sender:
            return False
        return any(s.search(sender) for s in self.senders)


_templates = []


def load_templates(directory):
    """Read every *.json in the template directory. A broken file is skipped
    with a log line rather than taking the whole service down with it."""
    global _templates
    loaded = []
    if not os.path.isdir(directory):
        log.warning("Template directory %s does not exist", directory)
        _templates = []
        return _templates

    for name in sorted(os.listdir(directory)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(directory, name)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            for entry in payload.get("templates", []):
                loaded.append(Template(entry))
        except (OSError, ValueError, KeyError, re.error) as err:
            log.error("Skipping template file %s: %s", path, err)

    _templates = loaded
    log.info("Loaded %d templates", len(_templates))
    return _templates


def get_templates():
    return _templates


# --- Entry point -----------------------------------------------------------

def parse_message(text, sender=None, received_at=None):
    """Return a draft dict. Always returns something; `confidence` and
    `isNoise` say how much to trust it."""
    received_at = received_at or datetime.now(timezone.utc)
    text = re.sub(r"\s+", " ", (text or "").strip())

    draft = {
        "amount": None,
        "currency": None,
        "direction": None,
        "merchant": None,
        "last4": None,
        "bank": None,
        "occurredAt": received_at.isoformat(),
        "reference": None,
    }

    if not text or looks_like_noise(text):
        return {
            "parsed": draft, "confidence": 0.0, "templateId": None,
            "isNoise": True,
        }

    template_id = None
    confidence = 0.0
    # A template that carries no `date` group must still get the date the
    # message states, rather than silently keeping the arrival time.
    date_from_template = False

    for template in _templates:
        if not template.sender_matches(sender):
            continue
        match = template.regex.search(text)
        if not match:
            continue

        groups = match.groupdict()
        draft["amount"] = parse_amount(groups.get("amount"))
        draft["currency"] = normalise_currency(groups.get("currency")) or "PKR"
        draft["merchant"] = clean_merchant(groups.get("merchant"))
        draft["last4"] = groups.get("last4")
        draft["reference"] = groups.get("reference")
        draft["bank"] = template.bank

        if template.direction in ("debit", "credit"):
            draft["direction"] = template.direction
        else:
            draft["direction"] = detect_direction(text)

        if groups.get("date"):
            try:
                parsed_date = dateparser.parse(groups["date"], dayfirst=True)
                if parsed_date:
                    if parsed_date.tzinfo is None:
                        parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                    draft["occurredAt"] = parsed_date.isoformat()
                    date_from_template = True
            except (ValueError, OverflowError, TypeError):
                pass

        template_id = template.id
        confidence = template.confidence
        break

    # No template claimed it - fall back to the generic extractors. This is the
    # path every unknown sender takes, so it has to degrade gracefully.
    if template_id is None:
        amount, currency = extract_amount_and_currency(text)
        draft["amount"] = amount
        draft["currency"] = currency or "PKR"
        draft["direction"] = detect_direction(text)
        draft["merchant"] = extract_merchant(text)
        draft["last4"] = extract_last4(text)
        confidence = 0.5

    # Fill anything the template left blank from the generic extractors, so a
    # template only has to describe the parts that are actually distinctive.
    if draft["last4"] is None:
        draft["last4"] = extract_last4(text)
    if draft["merchant"] is None:
        draft["merchant"] = extract_merchant(text)
    if draft["direction"] is None:
        draft["direction"] = detect_direction(text)
    if draft["amount"] is None:
        amount, currency = extract_amount_and_currency(text)
        draft["amount"] = amount
        if currency:
            draft["currency"] = currency
    if not date_from_template:
        draft["occurredAt"] = extract_datetime(text, received_at).isoformat()
    # A cross-cutting template (a card-purchase pattern that matches whoever
    # sent it) names no bank, so the sender is the best label available.
    if not draft["bank"]:
        draft["bank"] = sender or None

    # Confidence reflects what actually came out, not just which path ran.
    if draft["amount"] is None:
        confidence = 0.0
    else:
        if draft["direction"] is None:
            confidence -= 0.25
        if draft["merchant"] is None:
            confidence -= 0.15
        if draft["last4"] is None:
            confidence -= 0.05
    confidence = max(0.0, min(1.0, round(confidence, 2)))

    return {
        "parsed": draft,
        "confidence": confidence,
        "templateId": template_id,
        "isNoise": draft["amount"] is None,
    }
