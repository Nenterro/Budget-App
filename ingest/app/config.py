"""Runtime configuration, read once from the environment."""
import os


def _require(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class Settings:
    def __init__(self):
        # Where PocketBase lives. Inside the compose network this is the
        # container name, not the published port.
        self.pb_url = os.environ.get("PB_URL", "http://pocketbase:8090").rstrip("/")

        # Admin credentials. The service needs admin rights for two reasons:
        # it bootstraps the inbox collection on first boot, and it writes
        # records on behalf of a user it is not authenticated as.
        self.pb_admin_email = _require("PB_ADMIN_EMAIL")
        self.pb_admin_password = _require("PB_ADMIN_PASSWORD")

        # Which budget user the drafts belong to. Resolved to an id at startup.
        self.budget_user_email = _require("BUDGET_USER_EMAIL")

        # Shared secret the iPhone presents. Compared in constant time.
        self.ingest_token = _require("INGEST_TOKEN")

        self.collection = os.environ.get("INBOX_COLLECTION", "inbox_messages")

        # Templates are mounted rather than baked in, so tuning a bank's
        # pattern is an edit and a reload instead of an image rebuild.
        self.template_dir = os.environ.get("TEMPLATE_DIR", "/app/templates")

        # A draft nobody ever acted on is still readable financial text, so it
        # does not live forever.
        self.retention_days = int(os.environ.get("INBOX_RETENTION_DAYS", "30"))

        # How long an identical message is treated as a duplicate.
        self.dedupe_window_hours = int(os.environ.get("DEDUPE_WINDOW_HOURS", "24"))

        self.timezone = os.environ.get("INGEST_TIMEZONE", "Asia/Karachi")


settings = Settings()
