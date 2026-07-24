import PocketBase from 'pocketbase';
import * as db from './db';
import { encryptPayload, decryptPayload, isUnlocked } from '../utils/crypto';

const PB_URLS = [
  'https://huz-budget.duckdns.org:8888',
  'https://huz-budget.duckdns.org',
  'http://192.168.18.49:8090'
];

export const pb = new PocketBase();

async function checkUrl(url) {
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

export async function connectPocketBase() {
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

  pb.baseUrl = ''; // Offline
  return null;
}

export async function syncStore(store, collectionName) {
  const record = await db.settingsStore.getItem('appsettings1234');
  const e2eeEnabled = record?.config?.security?.e2eeEnabled || false;

  if (e2eeEnabled && !isUnlocked()) return;

  try {
    const localItems = [];
    await store.iterate((value) => {
      if (value.pendingSync) localItems.push(value);
    });

    if (localItems.length > 0) {
      for (const item of localItems) {
        const payload = { ...item };
        delete payload.pendingSync;
        delete payload.updatedAt;
        const usersId = (pb.authStore.isValid && pb.authStore.model) ? pb.authStore.model.id : null;
        
        let syncPayload;
        if (e2eeEnabled) {
          const encrypted = await encryptPayload(payload);
          syncPayload = { encrypted_payload: encrypted };
        } else {
          syncPayload = { ...payload, encrypted_payload: null };
        }

        if (usersId) syncPayload.users = usersId;

        try {
          try {
            if (item.id.length === 15) {
              await pb.collection(collectionName).getOne(item.id);
              await pb.collection(collectionName).update(item.id, syncPayload);
            } else {
              throw new Error("Invalid PocketBase ID length");
            }
          } catch (e) {
            if (item.id.length === 15) {
              syncPayload.id = item.id;
            }
            const created = await pb.collection(collectionName).create(syncPayload);
            
            if (created.id !== item.id) {
              await store.removeItem(item.id);
              item.id = created.id;
            }
          }
          item.pendingSync = false;
          await store.setItem(item.id, item);
        } catch (err) {
          console.error(`PB Push Error [${collectionName}]:`, err);
        }
      }
    }

    const remoteItems = await pb.collection(collectionName).getFullList({ sort: '-created' });
    for (const remote of remoteItems) {
      let finalRemote = remote;
      
      if (remote.encrypted_payload) {
        if (!e2eeEnabled) continue; // Skip encrypted items if we disabled E2EE
        try {
          const decrypted = await decryptPayload(remote.encrypted_payload);
          decrypted.id = remote.id;
          finalRemote = decrypted;
        } catch (err) {
          console.error("Failed to decrypt incoming remote item", remote.id, err);
          continue;
        }
      }
      
      const local = await store.getItem(remote.id);
      if (!local || new Date(remote.updated) > new Date(local.updatedAt || 0)) {
        const merged = { ...local, ...finalRemote, pendingSync: false, updatedAt: remote.updated };
        await store.setItem(remote.id, merged);
      }
    }
  } catch (error) {
    console.error(`Sync Error [${collectionName}]:`, error);
  }
}

export async function syncAll() {
  if (!pb.baseUrl) {
    const connected = await connectPocketBase();
    if (!connected) return; // Stay offline
  }

  if (!pb.authStore.isValid) {
    return; // Do not sync if not logged in
  }

  await Promise.all([
    syncStore(db.transactionsStore, 'transactions'),
    syncStore(db.accountsStore, 'accounts'),
    syncStore(db.categoriesStore, 'categories'),
    syncStore(db.payeesStore, 'payees'),
    syncStore(db.settingsStore, 'settings'),
    syncStore(db.budgetsStore, 'budgets')
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
      
      const recordSet = await db.settingsStore.getItem('appsettings1234');
      const e2eeEnabled = recordSet?.config?.security?.e2eeEnabled || false;

      if (e.action === 'delete') {
        const item = await store.getItem(e.record.id);
        if (item) {
          item.deleted = true;
          await store.setItem(item.id, item);
        }
      } else {
        let finalRecord = e.record;
        if (e.record.encrypted_payload) {
          if (!e2eeEnabled) return;
          try {
            if (!isUnlocked()) return; 
            const decrypted = await decryptPayload(e.record.encrypted_payload);
            decrypted.id = e.record.id;
            finalRecord = decrypted;
          } catch (err) {
            console.error("Failed to decrypt realtime item", err);
            return;
          }
        }
        
        const localItem = await store.getItem(e.record.id);
        const merged = { ...localItem, ...finalRecord, pendingSync: false, updatedAt: e.record.updated };
        await store.setItem(merged.id, merged);
      }
      if (onUpdate) onUpdate(coll);
    }).catch(err => console.warn(`Subscribe error ${coll}:`, err));
  });

  return () => {
    collections.forEach(coll => pb.collection(coll).unsubscribe('*'));
  };
}
