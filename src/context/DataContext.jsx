import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import * as db from '../store/db';
import { pb, syncAll, syncSettings, setupRealtimeSync, connectPocketBase, startAutoSync, onSyncStateChange } from '../store/sync';
import { isUnlocked, tryRestoreSession, deriveKey, verifyPinWithData, hasCachedPin } from '../utils/crypto';
import PinPad from '../components/PinPad';
import { useSecuritySettings, useSettingsMaintenance } from './SettingsContext';
import { useAuth } from './AuthContext';

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
  // False until init() has worked out whether this account already has
  // encrypted data. Until then we cannot tell "no PIN set up yet" apart from
  // "a PIN exists, we just have not read the settings yet".
  const [securityResolved, setSecurityResolved] = useState(false);
  // Mirrored from the sync engine rather than tracked separately here, so what
  // the UI shows is what the engine actually did — including realtime health
  // and push failures, which previously only reached the console.
  const [syncStatus, setSyncStatus] = useState({ mode: 'pending', realtime: 'off', lastSyncAt: null, lastError: null });

  useEffect(() => onSyncStateChange(setSyncStatus), []);
  const [pinInput, setPinInput] = useState('');
  // Held so a subscription started by a later unlock can be torn down. Without
  // it, unlocking added a second full set of collection subscriptions on top of
  // whatever init() had already opened.
  const realtimeUnsubRef = useRef(null);

  const { isE2eeEnabled, hasPromptedE2ee, setE2EE, dismissE2EEPrompt, reloadSettings } = useSecuritySettings();
  const { user } = useAuth();
  const { renameInFilters } = useSettingsMaintenance();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingPin, setOnboardingPin] = useState('');
  const [onboardingConfirmPin, setOnboardingConfirmPin] = useState('');
  const [isProcessingOnboarding, setIsProcessingOnboarding] = useState(false);

  // Offering "set up a PIN" before init() has resolved is what produced the
  // double prompt on a new device: local settings still held their defaults, so
  // this fired immediately, and moments later init() found remote encrypted
  // data and raised the unlock prompt on top of it.
  useEffect(() => {
    if (!securityResolved) return;
    if (pb.authStore.isValid && !isE2eeEnabled && !hasPromptedE2ee && !needsPin && !unlocked && onboardingStep === 0) {
      setOnboardingStep(1);
    }
  }, [securityResolved, isE2eeEnabled, hasPromptedE2ee, needsPin, unlocked, onboardingStep]);

  // If an unlock prompt appears, any setup flow already on screen is wrong.
  useEffect(() => {
    if (needsPin && onboardingStep > 0) setOnboardingStep(0);
  }, [needsPin, onboardingStep]);

  const handleSkipOnboarding = async () => {
    await dismissE2EEPrompt();
    setOnboardingStep(0);
  };

  const handleOnboardingPinComplete = async (enteredPin) => {
    if (onboardingStep === 2) {
      setOnboardingPin(enteredPin);
      setOnboardingStep(3);
    } else if (onboardingStep === 3) {
      if (enteredPin !== onboardingPin) {
        alert("PINs do not match. Please try again.");
        setOnboardingPin('');
        setOnboardingConfirmPin('');
        setOnboardingStep(2);
        return;
      }

      setIsProcessingOnboarding(true);
      try {
        await deriveKey(enteredPin);
        await setE2EE(true);
        setUnlocked(true);

        const stores = [db.transactionsStore, db.accountsStore, db.categoriesStore, db.payeesStore, db.settingsStore, db.budgetsStore];
        for (const store of stores) {
          const keys = await store.keys();
          for (const key of keys) {
            const item = await store.getItem(key);
            if (item) {
              item.pendingSync = true;
              await store.setItem(key, item);
            }
          }
        }

        await syncAll();
        await loadData();
        setOnboardingStep(0);
      } catch (err) {
        console.error(err);
        alert("Failed to setup encryption.");
      } finally {
        setIsProcessingOnboarding(false);
      }
    }
  };

  // ─── Main Initialization ───
  // The correct order is:
  // 1. Connect to PocketBase
  // 2. Pull remote settings FIRST (so we know E2EE state from cloud)
  // 3. Reload SettingsContext from the now-updated localforage
  // 4. Determine E2EE state
  // 5. If E2EE: try restore cached PIN → if no cached PIN, prompt user
  // 6. After unlock: full syncAll → loadData
  // 7. Setup realtime subscriptions
  //
  // Keyed on the signed-in user id, so signing in re-runs the whole thing.
  // It used to run once on mount only: DataProvider mounts above the router,
  // so on a fresh login it had already bailed out at the "no valid session"
  // check and nothing re-triggered it — the app sat empty until a manual
  // refresh remounted the provider.
  const authUserId = user?.id || null;

  useEffect(() => {
    let isMounted = true;

    const subscribe = () => { subscribeRealtimeRef.current(); };

    // Wrapper so every exit path — including the early returns for no server
    // and no session — marks the security state as resolved exactly once.
    async function init() {
      try {
        await initInner();
      } finally {
        if (isMounted) setSecurityResolved(true);
      }
    }

    async function initInner() {
      // Load whatever local data exists first (may be empty on fresh device)
      await loadData();
      setIsLoading(false);

      const activeUrl = await connectPocketBase();
      if (!activeUrl) return;
      // Guest sessions are local by design; anything else means the session did
      // not carry into this context and data will not leave the device. Either
      // way the sync engine reports it.
      if (!pb.authStore.isValid) {
        await syncAll();
        return;
      }

      // Step 1: Sync settings from PocketBase FIRST
      await syncSettings();

      // Step 2: Reload SettingsContext so it picks up the remote settings
      if (reloadSettings) {
        await reloadSettings();
      }

      // Step 3: Re-read E2EE state from the now-accurate local settings
      const settingsRecord = await db.settingsStore.getItem('appsettings1234');
      const e2eeEnabled = settingsRecord?.config?.security?.e2eeEnabled || false;

      // Also check if remote has encrypted payloads (in case settings config doesn't reflect it)
      let remoteHasEncrypted = false;
      if (!e2eeEnabled) {
        try {
          const usersId = pb.authStore.model?.id;
          const collections = ['transactions', 'accounts', 'categories', 'payees', 'budgets'];
          for (const coll of collections) {
            const items = await pb.collection(coll).getList(1, 1, {
              filter: usersId ? `users = "${usersId}" && encrypted_payload != ""` : `encrypted_payload != ""`
            });
            if (items.totalItems > 0) {
              remoteHasEncrypted = true;
              break;
            }
          }
        } catch (e) {
          // If the filter query fails (field may not exist), ignore
        }

        if (remoteHasEncrypted) {
          // Update local settings to reflect E2EE is actually enabled
          const updatedRecord = {
            ...(settingsRecord || { id: 'appsettings1234' }),
            config: {
              ...(settingsRecord?.config || {}),
              security: { ...(settingsRecord?.config?.security || {}), e2eeEnabled: true, hasPromptedE2ee: true }
            },
            pendingSync: true
          };
          await db.settingsStore.setItem('appsettings1234', updatedRecord);
          if (reloadSettings) await reloadSettings();
        }
      }

      const finalE2ee = e2eeEnabled || remoteHasEncrypted;

      if (finalE2ee) {
        // Try to restore from cached PIN (localStorage)
        const restored = await tryRestoreSession();
        if (restored && isMounted) {
          setUnlocked(true);
          // Full sync now that we can decrypt
          await syncAll();
          await loadData();
          subscribe();
        } else if (isMounted) {
          // No cached PIN — prompt user
          setNeedsPin(true);
        }
      } else {
        // No E2EE — just sync everything
        await syncAll();
        await loadData();
        subscribe();
      }
    }

    setSecurityResolved(false);
    // An unhandled rejection in here used to abandon the rest of startup
    // silently: no sync, no realtime, no explanation.
    init().catch(err => console.error('Startup sync failed:', err));

    return () => {
      isMounted = false;
      const previous = realtimeUnsubRef.current;
      realtimeUnsubRef.current = null;
      if (previous) previous();
    };
  }, [authUserId, loadData, reloadSettings]);

  // Keeps devices converging without depending on the realtime stream: on
  // return to the app, on focus, on regaining network, on a login, and on a
  // slow poll while the app is on screen. This is what makes a change made on
  // one device turn up on another that was simply sitting there.
  useEffect(() => {
    if (!authUserId) return undefined;
    return startAutoSync({ onSynced: () => loadData() });
  }, [authUserId, loadData]);

  // Local writes are already reflected in state optimistically, so a mutation
  // should not block the caller on a network round trip. Sync runs in the
  // background and reloads from the local store when it settles; updates from
  // other devices arrive through setupRealtimeSync regardless.
  // Tearing the old subscriptions down is asynchronous, so it has to finish
  // before new ones are opened — otherwise the teardown lands afterwards and
  // takes the fresh subscriptions with it.
  const subscribeRealtimeRef = useRef(null);

  const subscribeRealtime = useCallback(async () => {
    const previous = realtimeUnsubRef.current;
    realtimeUnsubRef.current = null;
    if (previous) await previous();
    realtimeUnsubRef.current = setupRealtimeSync((collection) => {
      loadData();
      if (collection === 'settings' && reloadSettings) reloadSettings();
    });
  }, [loadData, reloadSettings]);
  subscribeRealtimeRef.current = subscribeRealtime;

  const syncInBackground = useCallback(() => {
    if (!pb.authStore.isValid) return; // guest / signed out: nothing to push
    syncAll()
      .then(() => loadData())
      .then(() => setSyncStatus((prev) => ({ ...prev, mode: 'synced', lastSyncAt: Date.now(), error: null })))
      .catch((err) => {
        console.warn('Background sync failed:', err);
        setSyncStatus((prev) => ({ ...prev, error: err.message }));
      });
  }, [loadData]);


  const addTransaction = async (tx) => {
    if (Array.isArray(tx)) {
      const savedTxs = await Promise.all(tx.map(t => db.saveTransaction(t)));
      setTransactions(prev => {
        const copy = [...prev];
        savedTxs.forEach(st => {
          const idx = copy.findIndex(p => p.id === st.id);
          if (idx !== -1) copy[idx] = st;
          else copy.push(st);
        });
        return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
      });
    } else {
      const savedTx = await db.saveTransaction(tx);
      setTransactions(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(p => p.id === savedTx.id);
        if (idx !== -1) copy[idx] = savedTx;
        else copy.push(savedTx);
        return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
      });
    }
    syncInBackground();
  };

  const updateTransaction = async (tx) => {
    const savedTx = await db.saveTransaction(tx);
    setTransactions(prev => {
      let copy = [...prev];
      const idx = copy.findIndex(p => p.id === savedTx.id);
      if (idx !== -1) {
        copy[idx] = savedTx;
      } else {
        copy.push(savedTx);
      }

      // If this transaction is a repayment or write-off child, sync back with parent expense share tx
      if (savedTx.parentExpenseShareTxId) {
        const parentIdx = copy.findIndex(p => p.id === savedTx.parentExpenseShareTxId);
        if (parentIdx !== -1) {
          const parent = copy[parentIdx];
          const updatedRepayments = (parent.repayments || []).map(r => {
            if (r.linkedTxId === savedTx.id) {
              return {
                ...r,
                amount: Math.abs(savedTx.amount),
                personName: savedTx.payee,
                account: savedTx.account,
                date: savedTx.date ? savedTx.date.substring(0, 10) : r.date
              };
            }
            return r;
          });

          // Check if this child tx is a write-off and if its amount changed
          const oldWriteOffRecord = (parent.writeOffs || []).find(w => w.linkedTxId === savedTx.id);
          const oldWriteOffAmount = oldWriteOffRecord ? oldWriteOffRecord.amount : 0;
          const newWriteOffAmount = Math.abs(savedTx.amount);
          const writeOffDiff = newWriteOffAmount - oldWriteOffAmount;

          const updatedWriteOffs = (parent.writeOffs || []).map(w => {
            if (w.linkedTxId === savedTx.id) {
              return {
                ...w,
                amount: newWriteOffAmount,
                category: savedTx.category,
                payee: savedTx.payee
              };
            }
            return w;
          });

          let newParentAmount = parent.amount;
          if (savedTx.isWriteOff && writeOffDiff !== 0) {
            const signedDiff = parent.amount < 0 ? writeOffDiff : -writeOffDiff;
            newParentAmount = parent.amount + signedDiff;
          }

          const updatedShares = (parent.expenseShares || []).map(s => {
            let shareAmount = s.amount;
            if (savedTx.isWriteOff && oldWriteOffRecord && (s.id === oldWriteOffRecord.shareId || s.name === oldWriteOffRecord.personName)) {
              shareAmount = Math.max(0, s.amount - writeOffDiff);
            }
            const totalRepaid = updatedRepayments
              .filter(r => r.personName === s.name)
              .reduce((acc, r) => acc + r.amount, 0);
            // A write-off already came off `amount` above, so counting it again
            // here settled the whole remaining balance off a partial write-off.
            return {
              ...s,
              amount: shareAmount,
              settled: shareAmount === 0 || totalRepaid >= shareAmount
            };
          });

          const updatedParent = {
            ...parent,
            amount: newParentAmount,
            repayments: updatedRepayments,
            writeOffs: updatedWriteOffs,
            expenseShares: updatedShares,
            pendingSync: true,
            updatedAt: new Date().toISOString()
          };
          db.saveTransaction(updatedParent);
          copy[parentIdx] = updatedParent;
        }
      }

      return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    syncInBackground();
  };

  const deleteTransaction = async (id) => {
    await db.deleteTransaction(id);
    setTransactions(prev => {
      const txToDelete = prev.find(t => t.id === id);
      let updated = prev.filter(t => t.id !== id);

      if (txToDelete?.parentExpenseShareTxId) {
        const parentIdx = updated.findIndex(t => t.id === txToDelete.parentExpenseShareTxId);
        if (parentIdx !== -1) {
          const parent = updated[parentIdx];
          const updatedRepayments = (parent.repayments || []).filter(r => r.linkedTxId !== id);

          const targetWriteOff = (parent.writeOffs || []).find(w => w.linkedTxId === id);
          const updatedWriteOffs = (parent.writeOffs || []).filter(w => w.linkedTxId !== id);

          let newParentAmount = parent.amount;
          if (targetWriteOff) {
            // Restore written-off amount back to parent transaction amount
            const signedChange = parent.amount < 0 ? targetWriteOff.amount : -targetWriteOff.amount;
            newParentAmount = parent.amount - signedChange;
          }

          const updatedShares = (parent.expenseShares || []).map(s => {
            let shareAmount = s.amount;
            if (targetWriteOff && (s.id === targetWriteOff.shareId || s.name === targetWriteOff.personName)) {
              shareAmount = s.amount + targetWriteOff.amount;
            }

            const totalRepaid = updatedRepayments
              .filter(r => r.personName === s.name)
              .reduce((acc, r) => acc + r.amount, 0);
            // See updateTransaction: `amount` is already net of write-offs.
            return {
              ...s,
              amount: shareAmount,
              settled: shareAmount === 0 || totalRepaid >= shareAmount
            };
          });

          const updatedParent = {
            ...parent,
            amount: newParentAmount,
            repayments: updatedRepayments,
            writeOffs: updatedWriteOffs,
            expenseShares: updatedShares,
            pendingSync: true,
            updatedAt: new Date().toISOString()
          };
          db.saveTransaction(updatedParent);
          updated[parentIdx] = updatedParent;
        }
      }

      return updated.sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    syncInBackground();
  };

  // Transactions store category/payee/account by NAME. Renaming one therefore
  // has to rewrite every transaction that referenced the old name, or the whole
  // history silently detaches from the thing it belonged to.
  const updateDataItem = async (store, item, setType, refKind, currentList) => {
    const previous = item.id && currentList ? currentList.find(p => p.id === item.id) : null;
    const renamedFrom = previous && previous.name && previous.name !== item.name ? previous.name : null;

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

    if (renamedFrom && refKind) {
      const touched = await db.renameReferences(refKind, renamedFrom, saved.name);
      // Saved filter exclusions reference the name too.
      await renameInFilters(refKind, renamedFrom, saved.name);
      if (touched > 0) await loadData();
    }

    syncInBackground();
    return saved;
  };

  const deleteDataItem = async (store, id, setType) => {
    await db.deleteItem(store, id);
    setType(prev => prev.filter(p => p.id !== id));
    syncInBackground();
  };

  // Exposed so the UI can warn before a delete strands existing transactions.
  const countReferences = (kind, name) => db.countReferences(kind, name);

  const handlePinSubmit = async (enteredPin) => {
    if (enteredPin.length === 4) {
      const isValid = await verifyPinWithData(enteredPin);
      if (!isValid) {
        alert("Incorrect PIN. Access Denied.");
        setPinInput('');
        return;
      }

      setUnlocked(true);
      setNeedsPin(false);
      
      // Now that we can decrypt, do a full sync and reload settings
      await syncAll();
      if (reloadSettings) await reloadSettings();
      await loadData();
      await subscribeRealtime();
    }
  };

  const saveTransactionsBatch = async (txsToSave = [], idsToDelete = []) => {
    if (idsToDelete.length > 0) {
      await Promise.all(idsToDelete.map(id => db.deleteTransaction(id)));
    }
    let savedList = [];
    if (txsToSave.length > 0) {
      savedList = await Promise.all(txsToSave.map(t => db.saveTransaction(t)));
    }
    setTransactions(prev => {
      let copy = prev.filter(t => !idsToDelete.includes(t.id));
      savedList.forEach(st => {
        const idx = copy.findIndex(p => p.id === st.id);
        if (idx !== -1) copy[idx] = st;
        else copy.push(st);
      });
      return copy.sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    syncInBackground();
  };

  return (
    <DataContext.Provider value={{ 
      transactions, accounts, categories, payees, budgets, exchangeRates, setExchangeRates, isLoading, loadData,
      syncStatus,
      addTransaction, updateTransaction, deleteTransaction, saveTransactionsBatch,
      countReferences,
      saveAccount: async (item) => {
        const isNew = !item.id;
        await updateDataItem(db.accountsStore, item, setAccounts, 'account', accounts);
        if (isNew) {
          const hasInvestments = categories.some(c => c.name.toLowerCase() === 'investments');
          if (!hasInvestments) {
            await updateDataItem(db.categoriesStore, { name: 'Investments', color: '#10b981', iconName: 'TrendingUp' }, setCategories);
          }
        }
      },
      deleteAccount: (id) => deleteDataItem(db.accountsStore, id, setAccounts),
      saveCategory: (item) => updateDataItem(db.categoriesStore, item, setCategories, 'category', categories),
      deleteCategory: (id) => deleteDataItem(db.categoriesStore, id, setCategories),
      savePayee: (item) => updateDataItem(db.payeesStore, item, setPayees, 'payee', payees),
      deletePayee: (id) => deleteDataItem(db.payeesStore, id, setPayees),
      saveBudget: (item) => updateDataItem(db.budgetsStore, item, setBudgets),
      deleteBudget: (id) => deleteDataItem(db.budgetsStore, id, setBudgets),
    }}>
      {children}
      {/* First Time Onboarding Modal */}
      {onboardingStep > 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ padding: '32px', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '340px', width: '90%', textAlign: 'center', gap: '16px', position: 'relative' }}>
            {onboardingStep === 1 ? (
              <>
                <div style={{ padding: '16px', background: 'rgba(99,102,241,0.15)', borderRadius: '50%', color: 'var(--accent-color)' }}>
                  <Shield size={36} />
                </div>
                <h2 style={{ margin: 0, fontSize: '20px' }}>Protect Your Privacy</h2>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  End-to-End Encryption protects your financial data with a 4-digit PIN.
                </p>

                <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start', textAlign: 'left' }}>
                  <AlertTriangle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    <strong>Warning:</strong> Skipping encryption stores your data in plain text, allowing the server owner to view your records.
                  </span>
                </div>

                <button 
                  onClick={() => setOnboardingStep(2)} 
                  className="submit-btn bg-primary" 
                  style={{ width: '100%', marginTop: '8px' }}
                >
                  Set Up 4-Digit PIN
                </button>

                <button 
                  onClick={handleSkipOnboarding} 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Skip for Now
                </button>
              </>
            ) : (
              <>
                <PinPad 
                  value={onboardingStep === 2 ? onboardingPin : onboardingConfirmPin}
                  onChange={onboardingStep === 2 ? setOnboardingPin : setOnboardingConfirmPin}
                  onSubmit={handleOnboardingPinComplete}
                  title={onboardingStep === 2 ? 'Set Encryption PIN' : 'Confirm PIN'}
                  subtitle={onboardingStep === 2 ? 'Enter a 4-digit PIN to encrypt your data.' : 'Re-enter your 4-digit PIN to confirm.'}
                />
                {isProcessingOnboarding && (
                  <p style={{ marginTop: '12px', color: 'var(--accent-color)', fontSize: '14px' }}>
                    Encrypting & Syncing...
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {needsPin && !unlocked && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ padding: '32px', borderRadius: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <PinPad 
              value={pinInput}
              onChange={setPinInput}
              onSubmit={handlePinSubmit}
              title="Enter E2EE PIN"
              subtitle="Your data is encrypted. Enter your 4-digit PIN to sync and unlock."
            />
          </div>
        </div>
      )}
    </DataContext.Provider>
  );
}

export function useData() {
  return useContext(DataContext);
}
