import { pb, connectPocketBase } from './sync';

// Drafts parsed from forwarded SMS and notifications by the ingest service.
//
// These are the one thing in this app that lives only on the server. Every
// other store is local-first and end-to-end encrypted; a draft is neither,
// because the server has to be able to read the text it just parsed and holds
// no key to encrypt it with. That is also why a draft is short-lived: it is
// deleted the moment it becomes a transaction, and the server sweeps anything
// still sitting here after INBOX_RETENTION_DAYS.
export const INBOX_COLLECTION = 'inbox_messages';

// The collection is created by the ingest service on its first boot, so a
// budget app talking to a server without it is a normal state, not an error.
// It gets reported once and then stops nagging.
let collectionMissing = false;

function isMissingCollection(err) {
  return err?.status === 404;
}

async function ensureConnection() {
  if (!pb.baseUrl) await connectPocketBase();
  return pb.authStore.isValid;
}

export function inboxUnavailable() {
  return collectionMissing;
}

/** Pending drafts for the signed-in user, newest first. */
export async function fetchPendingDrafts() {
  if (!(await ensureConnection())) return [];
  const userId = pb.authStore.model?.id;
  if (!userId) return [];

  try {
    const items = await pb.collection(INBOX_COLLECTION).getFullList({
      filter: `users = "${userId}" && status = "pending"`,
      sort: '-receivedAt'
    });
    collectionMissing = false;
    return items.map(normaliseDraft);
  } catch (err) {
    if (isMissingCollection(err)) {
      if (!collectionMissing) {
        console.info('Inbox collection not present yet — is the ingest service running?');
      }
      collectionMissing = true;
      return [];
    }
    console.warn('Failed to load inbox drafts:', err);
    return [];
  }
}

// `parsed` is a JSON column, so PocketBase can hand it back as either an
// object or a string depending on how it was written. Callers should not have
// to care which.
function normaliseDraft(record) {
  let parsed = record.parsed;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  return { ...record, parsed: parsed || {} };
}

// --- Per-person ingest token ----------------------------------------------
//
// The secret the phone's shortcut presents. It lives on the user's own record
// rather than in settings, in plain text, and both of those are deliberate:
// the ingest service has to be able to read it to know who is sending, so it
// cannot be inside the encrypted payload. The users collection only lets a
// record be viewed or updated by the person it belongs to, so one person's
// token is not visible to another regardless.

const TOKEN_FIELD = 'ingest_token';

/** 32 random bytes as hex, from the platform CSPRNG. */
function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** The signed-in user's token, minting one the first time it is asked for. */
export async function getOrCreateIngestToken() {
  if (!(await ensureConnection())) return null;
  const user = pb.authStore.model;
  if (!user?.id) return null;

  // The cached auth record can predate the field existing, so the record is
  // re-read rather than trusted.
  let record;
  try {
    record = await pb.collection('users').getOne(user.id);
  } catch (err) {
    console.warn('Could not read the ingest token:', err);
    return null;
  }

  if (record[TOKEN_FIELD]) return record[TOKEN_FIELD];
  return regenerateIngestToken();
}

/** Mint a fresh token, retiring whatever the shortcuts are using now. */
export async function regenerateIngestToken() {
  if (!(await ensureConnection())) return null;
  const user = pb.authStore.model;
  if (!user?.id) return null;

  const token = newToken();
  try {
    await pb.collection('users').update(user.id, { [TOKEN_FIELD]: token });
    return token;
  } catch (err) {
    // Most likely the ingest service has never run, so the field does not
    // exist on the collection yet.
    console.warn('Could not save the ingest token:', err);
    return null;
  }
}

/** Remove a draft once it has become a transaction, or been rejected. */
export async function deleteDraft(id) {
  try {
    await pb.collection(INBOX_COLLECTION).delete(id);
    return true;
  } catch (err) {
    // Already gone is the outcome we wanted anyway.
    if (err?.status === 404) return true;
    console.warn('Failed to delete inbox draft:', err);
    return false;
  }
}

/**
 * Live updates for the review queue.
 *
 * Returns an unsubscribe function. A failure here is not fatal — the queue is
 * also refreshed whenever the modal opens and whenever the app regains focus,
 * so a dead EventSource costs freshness, not correctness.
 */
export async function subscribeInbox(onChange) {
  if (!(await ensureConnection())) return () => {};
  const userId = pb.authStore.model?.id;

  try {
    const unsubscribe = await pb.collection(INBOX_COLLECTION).subscribe('*', (event) => {
      if (userId && event.record?.users && event.record.users !== userId) return;
      onChange(event.action, normaliseDraft(event.record));
    });
    return unsubscribe;
  } catch (err) {
    if (!isMissingCollection(err)) {
      console.warn('Inbox realtime subscribe failed:', err);
    }
    return () => {};
  }
}
