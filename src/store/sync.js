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
    if (!connected) return;
  }
  if (!pb.authStore.isValid) return;

  // Settings first, then data stores in parallel
  await syncSettingsStore();
  await Promise.all([
    syncDataStore(db.transactionsStore, 'transactions'),
    syncDataStore(db.accountsStore, 'accounts'),
    syncDataStore(db.categoriesStore, 'categories'),
    syncDataStore(db.payeesStore, 'payees'),
    syncDataStore(db.budgetsStore, 'budgets')
  ]);
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

  collections.forEach(coll => {
    pb.collection(coll).subscribe('*', async function (e) {
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
    }).catch(err => console.warn(`Subscribe error ${coll}:`, err));
  });

  return () => {
    collections.forEach(coll => pb.collection(coll).unsubscribe('*'));
  };
}
