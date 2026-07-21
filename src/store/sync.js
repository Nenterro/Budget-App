import PocketBase from 'pocketbase';
import * as db from './db';

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
        if (pb.authStore.isValid && pb.authStore.model) {
          payload.users = pb.authStore.model.id;
        }

        try {
          try {
            if (item.id.length === 15) {
              await pb.collection(collectionName).getOne(item.id);
              await pb.collection(collectionName).update(item.id, payload);
            } else {
              throw new Error("Invalid PocketBase ID length");
            }
          } catch (e) {
            if (item.id.length === 15) {
              payload.id = item.id;
            } else {
              delete payload.id; // Let PocketBase generate a valid 15-char ID
            }
            const created = await pb.collection(collectionName).create(payload);
            
            if (created.id !== item.id) {
              // We must replace the old local 36-char record with the new 15-char record
              await store.removeItem(item.id);
              item.id = created.id;
            }
          }
          item.pendingSync = false;
          await store.setItem(item.id, item);
        } catch (err) {
          console.error(`PB Push Error [${collectionName}]:`, err);
          const details = err.response?.data ? JSON.stringify(err.response.data) : (err.message || JSON.stringify(err));
          alert(`PocketBase Error on ${collectionName}: ` + details);
        }
      }
    }

    const remoteItems = await pb.collection(collectionName).getFullList({ sort: '-created' });
    for (const remote of remoteItems) {
      const local = await store.getItem(remote.id);
      if (!local || new Date(remote.updated) > new Date(local.updatedAt || 0)) {
        const merged = { ...local, ...remote, pendingSync: false, updatedAt: remote.updated };
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
      if (e.action === 'delete') {
        const item = await store.getItem(e.record.id);
        if (item) {
          item.deleted = true;
          await store.setItem(item.id, item);
        }
      } else {
        const localItem = await store.getItem(e.record.id);
        const merged = { ...localItem, ...e.record, pendingSync: false, updatedAt: e.record.updated };
        await store.setItem(merged.id, merged);
      }
      if (onUpdate) onUpdate(coll);
    }).catch(err => console.warn(`Subscribe error ${coll}:`, err));
  });

  return () => {
    collections.forEach(coll => pb.collection(coll).unsubscribe('*'));
  };
}
