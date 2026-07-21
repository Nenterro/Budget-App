import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as db from '../store/db';
import { syncAll, setupRealtimeSync, connectPocketBase } from '../store/sync';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [payees, setPayees] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [exchangeRates, setExchangeRates] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const txs = await db.getTransactions();
      setTransactions(txs);
      
      let accts = await db.getItems(db.accountsStore);
      setAccounts(accts);

      let cats = await db.getItems(db.categoriesStore);
      setCategories(cats);

      let pys = await db.getItems(db.payeesStore);
      setPayees(pys);

      let bdgts = await db.getItems(db.budgetsStore);
      setBudgets(bdgts);
    } catch (err) {
      console.error("Failed to load local database:", err);
    }
  }, []);

  // Load initial data and setup sync
  useEffect(() => {
    let unsub = null;
    async function init() {
      await loadData();
      setIsLoading(false);

      const activeUrl = await connectPocketBase();
      if (activeUrl) {
        // Trigger background sync
        syncAll().then(() => loadData());

        // Setup Realtime subscriptions
        unsub = setupRealtimeSync((collection) => {
          loadData();
        });
      }
    }
    init();

    return () => {
      if (unsub) unsub();
    };
  }, [loadData]);


  const addTransaction = async (tx) => {
    if (Array.isArray(tx)) {
      const savedTxs = await Promise.all(tx.map(t => db.saveTransaction(t)));
      setTransactions(prev => [...savedTxs, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } else {
      const savedTx = await db.saveTransaction(tx);
      setTransactions(prev => [savedTx, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
    }
    syncAll();
  };

  const updateTransaction = async (tx) => {
    const savedTx = await db.saveTransaction(tx);
    setTransactions(prev => {
      const idx = prev.findIndex(p => p.id === savedTx.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = savedTx;
        return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      return [savedTx, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    syncAll();
  };

  const deleteTransaction = async (id) => {
    await db.deleteTransaction(id);
    setTransactions(prev => prev.filter(t => t.id !== id));
    syncAll();
  };

  const updateDataItem = async (store, item, setType) => {
    const saved = await db.saveItem(store, item);
    setType(prev => {
      const idx = prev.findIndex(p => p.id === saved.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = saved;
        return copy;
      }
      return [...prev, saved];
    });
    syncAll();
  };

  const deleteDataItem = async (store, id, setType) => {
    await db.deleteItem(store, id);
    setType(prev => prev.filter(p => p.id !== id));
    syncAll();
  };

  return (
    <DataContext.Provider value={{ 
      transactions, accounts, categories, payees, budgets, exchangeRates, setExchangeRates, isLoading, loadData,
      addTransaction, updateTransaction, deleteTransaction,
      saveAccount: (item) => updateDataItem(db.accountsStore, item, setAccounts),
      deleteAccount: (id) => deleteDataItem(db.accountsStore, id, setAccounts),
      saveCategory: (item) => updateDataItem(db.categoriesStore, item, setCategories),
      deleteCategory: (id) => deleteDataItem(db.categoriesStore, id, setCategories),
      savePayee: (item) => updateDataItem(db.payeesStore, item, setPayees),
      deletePayee: (id) => deleteDataItem(db.payeesStore, id, setPayees),
      saveBudget: (item) => updateDataItem(db.budgetsStore, item, setBudgets),
      deleteBudget: (id) => deleteDataItem(db.budgetsStore, id, setBudgets),
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
