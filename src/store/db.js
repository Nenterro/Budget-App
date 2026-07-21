import localforage from 'localforage';

// Configure stores
export const transactionsStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'transactions'
});

export const accountsStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'accounts'
});

export const categoriesStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'categories'
});

export const payeesStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'payees'
});

export const settingsStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'settings'
});

export const budgetsStore = localforage.createInstance({
  name: 'BudgetApp',
  storeName: 'budgets'
});

// --- Transactions API ---

export async function getTransactions() {
  const transactions = [];
  await transactionsStore.iterate((value, key) => {
    // Only return non-deleted items
    if (!value.deleted) {
      transactions.push(value);
    }
  });
  // Sort by date descending
  return transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function saveTransaction(tx) {
  // Generate ID if missing
  if (!tx.id) {
    tx.id = generateId();
  }
  
  // Set sync flags
  tx.pendingSync = true;
  tx.updatedAt = new Date().toISOString();
  
  await transactionsStore.setItem(tx.id, tx);
  return tx;
}

export async function deleteTransaction(id) {
  const tx = await transactionsStore.getItem(id);
  if (tx) {
    // Soft delete for sync engine
    tx.deleted = true;
    tx.pendingSync = true;
    tx.updatedAt = new Date().toISOString();
    await transactionsStore.setItem(id, tx);
  }
}

export function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// --- Data Items API ---
export async function getItems(store) {
  const items = [];
  await store.iterate((value) => {
    if (!value.deleted) items.push(value);
  });
  return items;
}

export async function saveItem(store, item) {
  if (!item.id) item.id = generateId();
  item.pendingSync = true;
  item.updatedAt = new Date().toISOString();
  await store.setItem(item.id, item);
  return item;
}

export async function deleteItem(store, id) {
  const item = await store.getItem(id);
  if (item) {
    item.deleted = true;
    item.pendingSync = true;
    item.updatedAt = new Date().toISOString();
    await store.setItem(id, item);
  }
}

// --- Import / Export ---
export async function exportData() {
  const data = { transactions: [], categories: [], accounts: [], payees: [], budgets: [] };
  await transactionsStore.iterate(val => { data.transactions.push(val); });
  await categoriesStore.iterate(val => { data.categories.push(val); });
  await accountsStore.iterate(val => { data.accounts.push(val); });
  await payeesStore.iterate(val => { data.payees.push(val); });
  await budgetsStore.iterate(val => { data.budgets.push(val); });
  return JSON.stringify(data, null, 2);
}

export async function importData(jsonData) {
  try {
    const data = JSON.parse(jsonData);
    
    // Auto-detect Flutter format vs New App format
    const isFlutterFormat = (data.categories && data.categories.length > 0 && data.categories[0].iconPoint !== undefined) ||
                            (data.accounts && data.accounts.length > 0 && data.accounts[0].colorValue !== undefined) ||
                            (data.transactions && data.transactions.length > 0 && data.transactions[0].transferAccount !== undefined);

    const intToHex = (intColor) => {
      if (!intColor) return '#000000';
      return '#' + (intColor & 0x00FFFFFF).toString(16).padStart(6, '0');
    };

    const processItems = async (store, items, type) => {
      if (!items) return;
      const existingNames = new Set();
      await store.iterate(val => { if (val.name && !val.deleted) existingNames.add(val.name.toLowerCase()); });
      
      for (const item of items) {
        let newItem = { ...item };
        const itemName = item.name || 'Unnamed';
        if (existingNames.has(itemName.toLowerCase())) {
          continue; // Skip duplicate
        }
        existingNames.add(itemName.toLowerCase());
        
        if (isFlutterFormat) {
          newItem.id = generateId(); // PB-safe ID
          newItem.name = itemName;
          newItem.color = intToHex(item.colorValue);
          newItem.icon = type === 'categories' ? 'Tag' : type === 'accounts' ? 'CreditCard' : 'User';
          newItem.deleted = item.deleted || false;
          delete newItem.iconPoint; delete newItem.colorValue; delete newItem.isExpense; delete newItem.currency;
        } else {
          if (newItem.id && newItem.id.length !== 15) newItem.id = generateId();
        }
        await saveItem(store, newItem);
      }
    };

    await processItems(categoriesStore, data.categories, 'categories');
    await processItems(accountsStore, data.accounts, 'accounts');
    await processItems(payeesStore, data.payees, 'payees');
    await processItems(budgetsStore, data.budgets, 'budgets');

    if (data.transactions) {
      for (const tx of data.transactions) {
        let newTx = { ...tx };
        if (isFlutterFormat) {
          newTx.id = generateId();
          newTx.deleted = tx.deleted || false;
          
          const tAcc = String(tx.transferAccount || "").trim();
          if (tAcc && tAcc !== "null" && tAcc !== "undefined") {
            newTx.type = 2; // Transfer
            newTx.transferTo = tx.transferAccount;
            newTx.amount = Math.abs(tx.amount || 0);
          } else {
            const rawAmount = tx.amount || 0;
            newTx.type = rawAmount < 0 ? 0 : 1; // Expense or Income
            newTx.amount = Math.abs(rawAmount);
          }
          delete newTx.transferAccount; delete newTx.currency; delete newTx.transferAmount; delete newTx.sharedGroupId; delete newTx.sharedItemType;
        } else {
          if (newTx.id && newTx.id.length !== 15) newTx.id = generateId();
        }
        await saveTransaction(newTx);
      }
    }
    return true;
  } catch (err) {
    console.error("Import failed:", err);
    throw err;
  }
}
