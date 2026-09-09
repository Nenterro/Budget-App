"""Thin PocketBase client for the ingest service.

The service authenticates as an admin rather than as the budget user. It needs
that for two things the user token cannot do: creating the inbox collection on
first boot, and writing records owned by a user it is not logged in as.

Admin tokens expire, and the failure mode is a silent 401 on the one request
that mattered, so every call goes through `_request`, which re-authenticates
once and retries.
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger(__name__)


class PocketBaseError(RuntimeError):
    pass


class PocketBaseClient:
    def __init__(self, base_url, admin_email, admin_password, collection):
        self.base_url = base_url.rstrip("/")
        self.admin_email = admin_email
        self.admin_password = admin_password
        self.collection = collection
        self._token = None
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=15.0)

    async def close(self):
        await self._client.aclose()

    # --- auth -------------------------------------------------------------

    async def authenticate(self):
        response = await self._client.post(
            "/api/admins/auth-with-password",
            json={"identity": self.admin_email, "password": self.admin_password},
        )
        if response.status_code != 200:
            raise PocketBaseError(
                f"Admin auth failed ({response.status_code}): {response.text[:200]}"
            )
        self._token = response.json()["token"]
        log.info("Authenticated with PocketBase as admin")

    async def _request(self, method, path, **kwargs):
        if self._token is None:
            await self.authenticate()

        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = self._token
        response = await self._client.request(method, path, headers=headers, **kwargs)

        # A stale token looks exactly like a permissions bug from the outside.
        # Re-auth once so it does not.
        if response.status_code in (401, 403):
            await self.authenticate()
            headers["Authorization"] = self._token
            response = await self._client.request(method, path, headers=headers, **kwargs)

        return response

    # --- bootstrap --------------------------------------------------------

    async def _get_collection(self, name):
        response = await self._request("GET", f"/api/collections/{name}")
        if response.status_code == 200:
            return response.json()
        return None

    async def ensure_collection(self):
        """Create the inbox collection if it is not already there.

        Idempotent: on every boot after the first this is a single GET.
        """
        existing = await self._get_collection(self.collection)
        if existing:
            log.info("Collection '%s' already exists", self.collection)
            return existing

        users = await self._get_collection("users")
        if not users:
            raise PocketBaseError("The 'users' collection is missing")

        definition = {
            "name": self.collection,
            "type": "base",
            "schema": [
                {"name": "source", "type": "text", "required": True},
                {"name": "sender", "type": "text"},
                {"name": "rawText", "type": "text", "required": True},
                {"name": "receivedAt", "type": "date", "required": True},
                # PocketBase 0.22 rejects a json field with no explicit size
                # cap. A draft holds one parsed SMS, so this is generous.
                {"name": "parsed", "type": "json", "options": {"maxSize": 100000}},
                {"name": "templateId", "type": "text"},
                {"name": "confidence", "type": "number"},
                {"name": "status", "type": "text"},
                {"name": "dedupeHash", "type": "text"},
                {
                    "name": "users",
                    "type": "relation",
                    "required": True,
                    "options": {
                        "collectionId": users["id"],
                        "cascadeDelete": True,
                        "maxSelect": 1,
                    },
                },
            ],
            # Drafts are created by this service alone (admin, which bypasses
            # rules). The app only ever reads, updates and deletes its own.
            "listRule": "users = @request.auth.id",
            "viewRule": "users = @request.auth.id",
            "createRule": None,
            "updateRule": "users = @request.auth.id",
            "deleteRule": "users = @request.auth.id",
            "indexes": [
                f"CREATE INDEX idx_{self.collection}_dedupe "
                f"ON {self.collection} (dedupeHash)",
                f"CREATE INDEX idx_{self.collection}_received "
                f"ON {self.collection} (receivedAt)",
            ],
        }

        response = await self._request("POST", "/api/collections", json=definition)
        if response.status_code not in (200, 201):
            raise PocketBaseError(
                f"Could not create collection ({response.status_code}): "
                f"{response.text[:400]}"
            )
        log.info("Created collection '%s'", self.collection)
        return response.json()

    async def resolve_user_id(self, email):
        response = await self._request(
            "GET",
            "/api/collections/users/records",
            params={"filter": f'email = "{email}"', "perPage": 1},
        )
        if response.status_code != 200:
            raise PocketBaseError(
                f"User lookup failed ({response.status_code}): {response.text[:200]}"
            )
        items = response.json().get("items", [])
        if not items:
            raise PocketBaseError(f"No budget user found with email {email}")
        return items[0]["id"]

    # --- records ----------------------------------------------------------

    async def find_duplicate(self, dedupe_hash, user_id, window_hours):
        """True if the same message already arrived inside the window.

        Retries and a flaky mobile connection both resend, and a duplicate
        draft is worse than a missing one: it is a transaction the user might
        approve twice.
        """
        since = (
            datetime.now(timezone.utc) - timedelta(hours=window_hours)
        ).strftime("%Y-%m-%d %H:%M:%S")
        response = await self._request(
            "GET",
            f"/api/collections/{self.collection}/records",
            params={
                "filter": (
                    f'dedupeHash = "{dedupe_hash}" && users = "{user_id}" '
                    f'&& created >= "{since}"'
                ),
                "perPage": 1,
            },
        )
        if response.status_code != 200:
            # Failing open is the right call: a duplicate the user can dismiss
            # beats dropping a real transaction because a query failed.
            log.warning("Dedupe check failed: %s", response.text[:200])
            return None
        items = response.json().get("items", [])
        return items[0] if items else None

    async def create_draft(self, record):
        response = await self._request(
            "POST", f"/api/collections/{self.collection}/records", json=record
        )
        if response.status_code not in (200, 201):
            raise PocketBaseError(
                f"Draft create failed ({response.status_code}): {response.text[:300]}"
            )
        return response.json()

    async def purge_older_than(self, days, user_id):
        """Delete drafts nobody acted on. Plaintext financial text does not get
        to sit on the server indefinitely just because it was never reviewed."""
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).strftime("%Y-%m-%d %H:%M:%S")
        response = await self._request(
            "GET",
            f"/api/collections/{self.collection}/records",
            params={
                "filter": f'users = "{user_id}" && created < "{cutoff}"',
                "perPage": 200,
                "fields": "id",
            },
        )
        if response.status_code != 200:
            log.warning("Purge query failed: %s", response.text[:200])
            return 0

        deleted = 0
        for item in response.json().get("items", []):
            delete_response = await self._request(
                "DELETE", f"/api/collections/{self.collection}/records/{item['id']}"
            )
            if delete_response.status_code in (200, 204):
                deleted += 1
        if deleted:
            log.info("Purged %d expired inbox drafts", deleted)
        return deleted
