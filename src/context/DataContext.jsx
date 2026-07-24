import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as db from '../store/db';
import { pb, syncAll, setupRealtimeSync, connectPocketBase } from '../store/sync';
import { isUnlocked, tryRestoreSession, deriveKey } from '../utils/crypto';

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

  const [unlocked, setUnlocked] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // Load initial data and setup sync
  useEffect(() => {
    let unsub = null;
    async function init() {
      await loadData();
      setIsLoading(false);

      const activeUrl = await connectPocketBase();
      if (activeUrl) {
        const restored = await tryRestoreSession();
        if (restored) {
          setUnlocked(true);
          syncAll().then(() => loadData());
          unsub = setupRealtimeSync((collection) => {
            loadData();
          });
        } else {
          setNeedsPin(true);
        }
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

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (pinInput.length === 4) {
      await deriveKey(pinInput);
      setUnlocked(true);
      
      syncAll().then(() => loadData());
      setupRealtimeSync((collection) => {
        loadData();
      });
    }
  };

  return (
    <DataContext.Provider value={{ 
      transactions, accounts, categories, payees, budgets, exchangeRates, setExchangeRates, isLoading, loadData,
      addTransaction, updateTransaction, deleteTransaction,
      saveAccount: async (item) => {
        const isNew = !item.id;
        await updateDataItem(db.accountsStore, item, setAccounts);
        if (isNew) {
          const hasInvestments = categories.some(c => c.name.toLowerCase() === 'investments');
          if (!hasInvestments) {
            await updateDataItem(db.categoriesStore, { name: 'Investments', color: '#10b981', iconName: 'TrendingUp' }, setCategories);
          }
        }
      },
      deleteAccount: (id) => deleteDataItem(db.accountsStore, id, setAccounts),
      saveCategory: (item) => updateDataItem(db.categoriesStore, item, setCategories),
      deleteCategory: (id) => deleteDataItem(db.categoriesStore, id, setCategories),
      savePayee: (item) => updateDataItem(db.payeesStore, item, setPayees),
      deletePayee: (id) => deleteDataItem(db.payeesStore, id, setPayees),
      saveBudget: (item) => updateDataItem(db.budgetsStore, item, setBudgets),
      deleteBudget: (id) => deleteDataItem(db.budgetsStore, id, setBudgets),
    }}>
      {children}
      {needsPin && !unlocked && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form onSubmit={handlePinSubmit} className="glass-panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Enter E2EE PIN</h2>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '250px' }}>
              Your data is encrypted. Enter your 4-digit PIN to sync and unlock.
            </p>
            <input 
              type="password" 
              maxLength="4" 
              value={pinInput} 
              onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
              style={{ width: '100px', textAlign: 'center', letterSpacing: '8px', fontSize: '24px', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
              autoFocus
            />
            <button type="submit" disabled={pinInput.length !== 4} className="submit-btn bg-primary" style={{ width: '100%' }}>
              Unlock Vault
            </button>
          </form>
        </div>
      )}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
