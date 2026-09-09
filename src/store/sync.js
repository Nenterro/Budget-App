import PocketBase from 'pocketbase';
import * as db from './db';
import { encryptPayload, decryptPayload, isUnlocked } from '../utils/crypto';

export const PB_URLS = [
  'https://huz-budget.duckdns.org:8888',
  'https://huz-budget.duckdns.org',
  'http://192.168.18.49:8090'
];

export const pb = new PocketBase('https://huz-budget.duckdns.org:8888');

export async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/api/health`, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// AuthContext and DataContext both need a reachable server at boot. Without
// this the two probes ran side by side, each walking the URL list with its own
// 5s timeouts.
let connectInFlight = null;

export function connectPocketBase() {
  if (!connectInFlight) {
    connectInFlight = resolvePocketBaseUrl().finally(() => { connectInFlight = null; });
  }
  return connectInFlight;
}

async function resolvePocketBaseUrl() {
  const savedUrl = localStorage.getItem('PB_URL');
  
  // Try saved URL first if it exists
  if (savedUrl && await checkUrl(savedUrl)) {
    pb.baseUrl = savedUrl;
    return savedUrl;
  }

  // Fallback to iterating through our list
  for (const url of PB_URLS) {
    if (url === savedUrl) continue;
    if (await checkUrl(url)) {
      localStorage.setItem('PB_URL', url);
      pb.baseUrl = url;
      return url;
    }
  }

  // Nothing answered. Keep a usable default on the client so later retries have
  // somewhere to go, but still report the failure - an empty baseUrl makes
  // PocketBase fall back to the page origin, which silently 404s every request.
  pb.baseUrl = PB_URLS[0];
  return null;
}

// ─── Observable sync state ───
//
// Sync used to fail silently: a dead realtime connection or a rejected push
// only ever reached console.warn, so from the outside "my other device never
// updated" was indistinguishable from "nothing changed". Everything now reports
// into one place that the UI can render.
//
//   mode      pending | synced | syncing | offline | expired | signed-out | guest | error
//   realtime  off | connecting | live | failed
//   session   unknown | active | expired | guest | none
const syncListeners = new Set();

let syncState = {
  mode: 'pending',
  realtime: 'off',
  session: 'unknown',
  lastSyncAt: null,
  lastError: null,
  lastTrigger: null
};

export function getSyncState() {
  return syncState;
}

export function onSyncStateChange(listener) {
  syncListeners.add(listener);
  listener(syncState);
  return () => syncListeners.delete(listener);
}

function setSyncState(patch) {
  syncState = { ...syncState, ...patch };
  for (const listener of syncListeners) {
    try {
      listener(syncState);
    } catch (e) {
      // A broken listener must not take the sync engine down with it.
    }
  }
}

// ─── Settings ID Mapping ───
// Local settings use a fixed key 'appsettings1234' (14 chars).
// PocketBase auto-generates 15-char IDs. We store the mapping so
// we can update the correct remote record instead of creating duplicates.

function getSettingsPbId() {
  return localStorage.getItem('BUDGET_SETTINGS_PB_ID') || null;
}

function setSettingsPbId(pbId) {
  localStorage.setItem('BUDGET_SETTINGS_PB_ID', pbId);
}

// ─── Session state ───
//
// A PocketBase token expires on its own, and the SDK neither refreshes it nor
// clears it: `authStore.model` stays populated, so the app still looks signed
// in and behaves normally while every sync silently stops. That is how a device
// ends up accumulating changes nobody is backing up. The difference that
// matters is therefore not "signed in or not" but:
//
//   active   token present and still valid — syncing
//   expired  token present but rejected or past its expiry — NOT syncing
//   guest    local by choice
//   none     no token at all (a genuine sign-out)
export function getAuthSessionState() {
  if (pb.authStore.isValid) return 'active';
  if (typeof localStorage !== 'undefined' && localStorage.getItem('BUDGET_GUEST_SESSION') === '1') return 'guest';
  return pb.authStore.token ? 'expired' : 'none';
}

// Reports the current session into the observable state so the UI can warn
// about an expired session even when no sync is attempted.
export function reportAuthState() {
  const session = getAuthSessionState();
  if (session === 'active') {
    setSyncState({ session });
    return session;
  }
  const mode = session === 'guest' ? 'guest' : session === 'expired' ? 'expired' : 'signed-out';
  setSyncState({
    session,
    mode,
    lastError: session === 'expired'
      ? 'This device is signed out: the saved session expired or was rejected by the server.'
      : syncState.lastError
  });
  return session;
}

// The server can reject a token that has not yet expired (password changed,
// account removed, server data reset). Only 401 is treated as an authentication
// failure — 403 is an access-rule refusal on an otherwise valid session.
pb.afterSend = function (response, data) {
  if (response?.status === 401 && pb.authStore.token && !/\/api\/collections\/[^/]+\/auth-with/.test(response.url || '')) {
    setSyncState({
      session: 'expired',
      mode: 'expired',
      lastError: 'The server rejected this device\'s session. Sign in again to resume syncing.'
    });
  }
  return data;
};

// ─── Keeping the session alive ───
//
// Nothing in the app ever renewed the token, so every device was on a countdown
// to silently falling out of sync. Refreshing while the token is still valid
// keeps a device that is used regularly signed in indefinitely.
const REFRESH_WHEN_REMAINING_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const REFRESH_THROTTLE_MS = 30 * 60 * 1000;

let lastRefreshAttempt = 0;
let refreshInFlight = null;

function getTokenExpiry() {
  const token = pb.authStore.token;
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.exp ? payload.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

export function getSessionExpiryAt() {
  return getTokenExpiry();
}

export function refreshAuth() {
  if (refreshInFlight) return refreshInFlight;
  lastRefreshAttempt = Date.now();
  refreshInFlight = pb.collection('users').authRefresh()
    .then(() => {
      setSyncState({ session: 'active' });
      return true;
    })
    .catch(err => {
      // A network failure must not be mistaken for a dead session; only the
      // server actually refusing the token counts. (afterSend has already
      // flagged a 401 by the time this runs.)
      if (err?.status === 401 || err?.status === 403) reportAuthState();
      return false;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

// Cheap enough to call before every sync: it only reaches the network when the
// token is genuinely approaching its expiry.
export async function ensureFreshAuth() {
  if (!pb.authStore.isValid) return false;
  if (Date.now() - lastRefreshAttempt < REFRESH_THROTTLE_MS) return true;
  const expiresAt = getTokenExpiry();
  if (expiresAt && expiresAt - Date.now() > REFRESH_WHEN_REMAINING_MS) return true;
  return refreshAuth();
}

// ─── How much is only on this device ───
//
// What makes an expired session worth interrupting the user over is unpushed
// work, so the warning can say how much there is.
export async function countPendingChanges() {
  const stores = [
    db.transactionsStore,
    db.accountsStore,
    db.categoriesStore,
    db.payeesStore,
    db.budgetsStore
  ];
  let count = 0;
  await Promise.all(stores.map(store =>
    store.iterate(value => { if (value?.pendingSync) count += 1; }).catch(() => {})
  ));
  return count;
}

// ─── Helper: get current user ID safely ───
function getCurrentUserId() {
  return (pb.authStore.isValid && pb.authStore.model) ? pb.authStore.model.id : null;
}

// ─── Helper: check E2EE state from localforage ───
async function getE2eeState() {
  const record = await db.settingsStore.getItem('appsettings1234');
  return record?.config?.security?.e2eeEnabled || false;
}

// ─── Sync a single settings record (special handling for ID mismatch) ───
async function syncSettingsStore() {
  const store = db.settingsStore;
  const collectionName = 'settings';
  const e2eeEnabled = await getE2eeState();
  const usersId = getCurrentUserId();

  if (e2eeEnabled && !isUnlocked()) return;

  try {
    // ── PHASE 1: Pull remote settings first ──
    const fetchOptions = { sort: '-created' };
    if (usersId) {
      fetchOptions.filter = `users = "${usersId}"`;
    }

    let remoteSettings;
    try {
      remoteSettings = await pb.collection(collectionName).getFullList(fetchOptions);
    } catch (e) {
      console.warn('Failed to fetch remote settings:', e);
      remoteSettings = [];
    }

    if (remoteSettings.length > 0) {
      const remote = remoteSettings[0];
      // Save the PocketBase ID mapping
      setSettingsPbId(remote.id);

      let finalRemote = null;

      if (remote.encrypted_payload && e2eeEnabled && isUnlocked()) {
        try {
          const decrypted = await decryptPayload(remote.encrypted_payload);
          decrypted.id = 'appsettings1234';
          finalRemote = decrypted;
        } catch (err) {
          console.error('Failed to decrypt remote settings:', err);
        }
      } else if (!remote.encrypted_payload) {
        finalRemote = { ...remote, id: 'appsettings1234' };
      } else if (remote.encrypted_payload && !e2eeEnabled) {
        // Remote is encrypted but local says E2EE is off — trust the remote: E2EE is on
        // We can't decrypt yet, but we mark it so the caller knows to prompt PIN
        finalRemote = { ...remote, id: 'appsettings1234' };
      }

      if (finalRemote) {
        const local = await store.getItem('appsettings1234');
        if (!local || new Date(remote.updated) > new Date(local.updatedAt || 0)) {
          const merged = { ...local, ...finalRemote, id: 'appsettings1234', pendingSync: false, updatedAt: remote.updated };
          await store.setItem('appsettings1234', merged);
        }
      }
    }

    // ── PHASE 2: Push local pending settings ──
    const localSettings = await store.getItem('appsettings1234');
    if (localSettings && localSettings.pendingSync) {
      const payload = { ...localSettings };
      delete payload.pendingSync;
      delete payload.updatedAt;

      let syncPayload;
      if (e2eeEnabled && isUnlocked()) {
        const encrypted = await encryptPayload(payload);
        syncPayload = { encrypted_payload: encrypted };
        // Clear plaintext fields
        for (const key of Object.keys(payload)) {
          if (!['id', 'collectionId', 'collectionName', 'created', 'updated', 'users', 'expand', 'encrypted_payload'].includes(key)) {
            const val = payload[key];
            if (typeof val === 'number') syncPayload[key] = 0;
            else if (typeof val === 'boolean') syncPayload[key] = false;
            else syncPayload[key] = "";
          }
        }
      } else {
        syncPayload = { ...payload, encrypted_payload: "" };
      }

      if (usersId) syncPayload.users = usersId;
      // Remove the local-only ID from the payload sent to PocketBase
      delete syncPayload.id;

      try {
        const pbId = getSettingsPbId();
        if (pbId) {
          // Update existing remote record
          await pb.collection(collectionName).update(pbId, syncPayload);
        } else {
          // Create new remote record
          const created = await pb.collection(collectionName).create(syncPayload);
          setSettingsPbId(created.id);
        }
        localSettings.pendingSync = false;
        await store.setItem('appsettings1234', localSettings);
      } catch (err) {
        console.error('PB Settings Push Error:', err);
      }
    }
  } catch (error) {
    console.error('Settings Sync Error:', error);
  }
}

// ─── Sync a regular data store (transactions, accounts, etc.) ───
async function syncDataStore(store, collectionName) {
  const e2eeEnabled = await getE2eeState();
  const usersId = getCurrentUserId();

  if (e2eeEnabled && !isUnlocked()) return;

  try {
    // ── PHASE 1: Pull remote records first ──
    const fetchOptions = { sort: '-created' };
    if (usersId) {
      fetchOptions.filter = `users = "${usersId}"`;
    }

    let remoteItems;
    try {
      remoteItems = await pb.collection(collectionName).getFullList(fetchOptions);
    } catch (e) {
      console.warn(`Failed to fetch remote ${collectionName}:`, e);
      remoteItems = [];
    }

    for (const remote of remoteItems) {
      let finalRemote = null;

      if (remote.encrypted_payload) {
        if (!e2eeEnabled || !isUnlocked()) continue;
        try {
          const decrypted = await decryptPayload(remote.encrypted_payload);
          decrypted.id = remote.id;
          finalRemote = decrypted;
        } catch (err) {
          console.error(`Failed to decrypt remote ${collectionName} item`, remote.id, err);
          continue;
        }
      } else {
        finalRemote = remote;
      }

      if (!finalRemote) continue;

      const local = await store.getItem(remote.id);
      if (!local || new Date(remote.updated) > new Date(local.updatedAt || 0)) {
        // Only overwrite if remote is newer or local doesn't exist
        if (local && local.pendingSync) {
          // Local has unsaved changes — skip overwriting, we'll push these next
          continue;
        }
        const merged = { ...finalRemote, pendingSync: false, updatedAt: remote.updated };
        await store.setItem(remote.id, merged);
      }
    }

    // ── PHASE 2: Push local pending items ──
    // Anything written here is newer than the PHASE 1 snapshot, so PHASE 3
    // must not judge it against that snapshot.
    const justSynced = new Set();
    const localItems = [];
    await store.iterate((value) => {
      if (value && value.pendingSync) localItems.push(value);
    });

    for (const item of localItems) {
      if (item.deleted) {
        // The tombstone is only dropped once the server has actually accepted
        // the delete (or confirmed the record was never there). Removing it
        // regardless meant a delete made while offline was forgotten, and the
        // next successful pull brought the transaction straight back.
        let confirmed = true;
        if (item.id && item.id.length === 15) {
          try {
            await pb.collection(collectionName).delete(item.id);
          } catch (err) {
            // 404 means it is already gone remotely — that counts as done.
            confirmed = err?.status === 404;
            if (!confirmed) console.warn(`PB Delete Error [${collectionName}]:`, err);
          }
        }
        if (confirmed) await store.removeItem(item.id);
        continue;
      }

      const payload = { ...item };
      delete payload.pendingSync;
      delete payload.updatedAt;

      let syncPayload;
      if (e2eeEnabled && isUnlocked()) {
        const encrypted = await encryptPayload(payload);
        syncPayload = { encrypted_payload: encrypted };
        // Clear plaintext fields
        for (const key of Object.keys(payload)) {
          if (!['id', 'collectionId', 'collectionName', 'created', 'updated', 'users', 'expand', 'encrypted_payload'].includes(key)) {
            const val = payload[key];
            if (typeof val === 'number') syncPayload[key] = 0;
            else if (typeof val === 'boolean') syncPayload[key] = false;
            else syncPayload[key] = "";
          }
        }
      } else {
        syncPayload = { ...payload, encrypted_payload: "" };
      }

      if (usersId) syncPayload.users = usersId;

      try {
        try {
          if (item.id && item.id.length === 15) {
            await pb.collection(collectionName).getOne(item.id);
            await pb.collection(collectionName).update(item.id, syncPayload);
          } else {
            throw new Error("Invalid PocketBase ID length");
          }
        } catch (e) {
          if (item.id && item.id.length === 15) {
            syncPayload.id = item.id;
          }
          const created = await pb.collection(collectionName).create(syncPayload);

          if (created.id !== item.id) {
            const oldId = item.id;
            await store.removeItem(oldId);
            item.id = created.id;

            // If this item was a parent or child, update references across store
            if (collectionName === 'transactions') {
              await store.iterate((value, key) => {
                let updated = false;
                if (value.parentExpenseShareTxId === oldId) {
                  value.parentExpenseShareTxId = created.id;
                  updated = true;
                }
                if (value.repayments) {
                  value.repayments = value.repayments.map(r => r.linkedTxId === oldId ? { ...r, linkedTxId: created.id } : r);
                  updated = true;
                }
                if (value.writeOffs) {
                  value.writeOffs = value.writeOffs.map(w => w.linkedTxId === oldId ? { ...w, linkedTxId: created.id } : w);
                  updated = true;
                }
                if (updated) {
                  store.setItem(key, value);
                }
              });
            }
          }
        }
        item.pendingSync = false;
        await store.setItem(item.id, item);
        justSynced.add(item.id);
      } catch (err) {
        console.error(`PB Push Error [${collectionName}]:`, err);
      }
    }

    // ── PHASE 3: Clean up local records deleted remotely ──
    //
    // `remoteIds` is the PHASE 1 snapshot, taken before anything was pushed.
    // Records created during PHASE 2 carry a fresh PocketBase id and are no
    // longer pendingSync, so without excluding them this step deleted the very
    // transaction that had just been saved — which is why a new transaction
    // vanished until the next refresh pulled it back down.
    const remoteIds = new Set(remoteItems.map(r => r.id));
    const staleKeys = [];
    await store.iterate((value, key) => {
      if (!key || key.length !== 15) return;
      if (!value || value.pendingSync) return;
      if (justSynced.has(key)) return;
      if (remoteIds.has(key)) return;
      staleKeys.push(key);
    });
    // Removals are awaited rather than fired off inside iterate, so the store
    // is settled before callers reload from it.
    for (const key of staleKeys) {
      await store.removeItem(key);
    }
  } catch (error) {
    console.error(`Sync Error [${collectionName}]:`, error);
  }
}

// ─── Public API ───

// Sync only settings (used during startup before full sync)
export async function syncSettings() {
  if (!pb.baseUrl) {
    const connected = await connectPocketBase();
    if (!connected) return;
  }
  if (!pb.authStore.isValid) return;

  await syncSettingsStore();
}

// Full sync of all stores.
//
// Runs are serialised: two overlapping passes each take their own PHASE 1
// snapshot of the server, and the older snapshot then makes PHASE 3 delete
// records the newer pass had only just created. A queued follow-up run is
// collapsed into a single one, so a burst of saves costs at most one extra pass.
let syncInFlight = null;
let syncQueued = false;

export function syncAll() {
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    try {
      // Keep draining while callers keep asking. The flag is cleared before
      // each pass so a request made *during* that pass still earns another one.
      do {
        syncQueued = false;
        await runSyncAll();
      } while (syncQueued);
    } finally {
      syncInFlight = null;
      syncQueued = false;
    }
  })();
  return syncInFlight;
}

async function runSyncAll() {
  if (!pb.baseUrl) {
    const connected = await connectPocketBase();
    if (!connected) {
      setSyncState({ mode: 'offline', lastError: 'No PocketBase server reachable' });
      return;
    }
  }
  // Renew before deciding, so a session that is merely near its expiry is kept
  // alive rather than being allowed to lapse between two syncs.
  await ensureFreshAuth();

  if (reportAuthState() !== 'active') return;

  setSyncState({ mode: 'syncing' });

  // A push that the server rejects has to be visible, not just logged.
  const failures = [];
  const track = (name, promise) => promise.catch(err => {
    failures.push(`${name}: ${err?.message || err}`);
  });

  // Settings first, then data stores in parallel
  await track('settings', syncSettingsStore());
  await Promise.all([
    track('transactions', syncDataStore(db.transactionsStore, 'transactions')),
    track('accounts', syncDataStore(db.accountsStore, 'accounts')),
    track('categories', syncDataStore(db.categoriesStore, 'categories')),
    track('payees', syncDataStore(db.payeesStore, 'payees')),
    track('budgets', syncDataStore(db.budgetsStore, 'budgets'))
  ]);

  if (failures.length) {
    setSyncState({ mode: 'error', lastError: failures.join('; ') });
  } else {
    setSyncState({ mode: 'synced', lastSyncAt: Date.now(), lastError: null });
  }
}

// ─── Automatic sync ───
//
// Realtime is an optimisation, not a guarantee. An EventSource does not survive
// a backgrounded PWA, a screen lock or a network switch, and the 0.21.x SDK
// never re-authenticates the stream when the auth token changes — so a device
// left sitting on a page could go indefinitely without hearing about anything.
// These triggers are what actually make "change it here, see it there" work:
// coming back to the app, regaining focus, regaining network, and a slow poll
// while the app is on screen.
export function startAutoSync({ intervalMs = 45000, onSynced } = {}) {
  let stopped = false;

  const run = async (trigger) => {
    if (stopped) return;
    // An expired token used to end the run right here, which meant the state
    // the UI renders was never updated again — the app went quiet at exactly
    // the moment it had something to say.
    if (!pb.authStore.isValid) {
      reportAuthState();
      return;
    }
    // No point polling a tab nobody is looking at; the visibility handler
    // catches up the moment it comes back.
    if (trigger === 'interval' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    setSyncState({ lastTrigger: trigger });
    try {
      await syncAll();
      if (!stopped && onSynced) await onSynced(trigger);
    } catch (err) {
      if (!stopped) setSyncState({ mode: 'error', lastError: err?.message || String(err) });
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') run('visible');
  };
  const onFocus = () => run('focus');
  const onOnline = () => run('online');
  // The SDK has no reaction of its own to a login or a token refresh.
  const offAuthChange = pb.authStore.onChange(() => run('auth-change'));

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  const timer = setInterval(() => run('interval'), intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    if (offAuthChange) offAuthChange();
  };
}

// Subscribe to real-time events
export function setupRealtimeSync(onUpdate) {
  const collections = ['transactions', 'accounts', 'categories', 'payees', 'settings', 'budgets'];
  const stores = {
    transactions: db.transactionsStore,
    accounts: db.accountsStore,
    categories: db.categoriesStore,
    payees: db.payeesStore,
    settings: db.settingsStore,
    budgets: db.budgetsStore
  };

  // Disposed setups must not touch state belonging to a newer one.
  let disposed = false;
  const unsubscribers = [];

  setSyncState({ realtime: 'connecting' });

  const ready = Promise.all(collections.map(coll => {
    return pb.collection(coll).subscribe('*', buildHandler(coll, stores, onUpdate))
      .then(unsubscribe => {
        // A teardown that landed while this was in flight still has to win.
        if (disposed) return unsubscribe();
        unsubscribers.push(unsubscribe);
      })
      .catch(err => {
        console.warn(`Subscribe error ${coll}:`, err);
        if (!disposed) {
          setSyncState({ realtime: 'failed', lastError: `realtime ${coll}: ${err?.message || err}` });
        }
      });
  })).then(() => {
    if (!disposed && unsubscribers.length === collections.length) {
      setSyncState({ realtime: 'live' });
    }
  });

  // Each subscription is dropped by its own handle rather than by wiping the
  // collection's topic. `unsubscribe('*')` removed every listener on that
  // collection, so a teardown resolving after the next setup had subscribed
  // silently killed the new subscriptions too — and nothing reported it.
  return async () => {
    disposed = true;
    await ready.catch(() => {});
    await Promise.all(unsubscribers.map(fn => Promise.resolve().then(fn).catch(() => {})));
    unsubscribers.length = 0;
    setSyncState({ realtime: 'off' });
  };
}

function buildHandler(coll, stores, onUpdate) {
  return (
    async function (e) {
      const store = stores[coll];
      
      const currentUserId = getCurrentUserId();
      if (currentUserId && e.record.users && e.record.users !== currentUserId) {
        return; // Ignore records that belong to another user
      }

      const e2eeEnabled = await getE2eeState();

      if (e.action === 'delete') {
        if (coll === 'settings') {
          // Don't delete local settings on remote delete events
          return;
        }
        await store.removeItem(e.record.id);
      } else {
        let finalRecord = e.record;

        if (e.record.encrypted_payload) {
          if (!e2eeEnabled || !isUnlocked()) return;
          try {
            const decrypted = await decryptPayload(e.record.encrypted_payload);
            decrypted.id = e.record.id;
            finalRecord = decrypted;
          } catch (err) {
            console.error("Failed to decrypt realtime item", err);
            return;
          }
        }

        if (coll === 'settings') {
          // Map remote settings to local fixed key
          setSettingsPbId(e.record.id);
          const localKey = 'appsettings1234';
          const localItem = await store.getItem(localKey);
          const merged = { ...localItem, ...finalRecord, id: localKey, pendingSync: false, updatedAt: e.record.updated };
          await store.setItem(localKey, merged);
        } else {
          const localItem = await store.getItem(e.record.id);
          const merged = { ...localItem, ...finalRecord, pendingSync: false, updatedAt: e.record.updated };
          await store.setItem(merged.id, merged);
        }
      }
      if (onUpdate) onUpdate(coll);
    }
  );
}
