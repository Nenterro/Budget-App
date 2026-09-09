import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Check, Trash2, Inbox, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import { useData } from '../context/DataContext';
import { useAutomationSettings } from '../context/SettingsContext';
import { fetchPendingDrafts, deleteDraft } from '../store/inbox';
import {
  draftToSuggestion,
  learnFromApproval,
  confidenceLabel
} from '../utils/inboxDraft';
import { generateId } from '../store/db';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import './InboxReviewModal.css';

/**
 * The review queue for transactions detected from SMS and notifications.
 *
 * Nothing here is added without a tap. The parser is good but not trustworthy
 * enough to write to a ledger unsupervised, and a wrong transaction is far
 * more expensive to find later than a missing one is to add now.
 *
 * Every approval teaches the rules: this card number is that account, this
 * merchant is that payee, that payee is that category. The second message
 * from a given merchant usually needs nothing but a tap on Add.
 */
export default function InboxReviewModal({ isOpen, onClose, drafts, onRefresh }) {
  const { accounts, categories, payees, addTransaction, savePayee, saveCategory } = useData();
  const { automationRules, setAutomationRules } = useAutomationSettings();

  // Per-draft edits, keyed by draft id. A draft the user has not touched is
  // not in here at all and falls back to its suggestion.
  const [edits, setEdits] = useState({});
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const suggestions = useMemo(() => {
    const map = {};
    for (const draft of drafts) {
      map[draft.id] = draftToSuggestion(draft, {
        accounts, categories, payees, rules: automationRules
      });
    }
    return map;
  }, [drafts, accounts, categories, payees, automationRules]);

  // Edits for drafts that have since left the queue are dead weight, and
  // holding them would resurrect stale values if the same id ever came back.
  useEffect(() => {
    const live = new Set(drafts.map(d => d.id));
    setEdits(current => {
      const next = {};
      let dropped = false;
      for (const [id, value] of Object.entries(current)) {
        if (live.has(id)) next[id] = value;
        else dropped = true;
      }
      return dropped ? next : current;
    });
  }, [drafts]);

  const valueFor = useCallback((draft, field) => {
    const edited = edits[draft.id];
    if (edited && field in edited) return edited[field];
    return suggestions[draft.id]?.[field] ?? '';
  }, [edits, suggestions]);

  const setField = useCallback((draftId, field, value) => {
    setEdits(current => ({
      ...current,
      [draftId]: { ...(current[draftId] || {}), [field]: value }
    }));
  }, []);

  // Picking a payee should pull its usual category across, but only when the
  // user has not already chosen one by hand.
  const setPayeeField = useCallback((draft, value) => {
    setEdits(current => {
      const existing = current[draft.id] || {};
      const next = { ...existing, payee: value };
      if (!('category' in existing)) {
        const learned = automationRules?.categoryByPayee?.[value];
        if (learned) next.category = learned;
      }
      return { ...current, [draft.id]: next };
    });
  }, [automationRules]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const handleApprove = useCallback(async (draft) => {
    const amount = parseFloat(valueFor(draft, 'amount'));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid amount before adding this transaction.');
      return;
    }
    const account = valueFor(draft, 'account');
    if (!account) {
      alert('Choose which account this transaction belongs to.');
      return;
    }

    setBusyId(draft.id);
    try {
      const type = valueFor(draft, 'type');
      const payee = (valueFor(draft, 'payee') || '').trim() || 'Unspecified';
      const category = (valueFor(draft, 'category') || '').trim() || 'Unspecified';

      // A payee or category typed here should become a real one, exactly as
      // it would if it had been typed into the Add Transaction form.
      if (payee !== 'Unspecified' && !payees.some(p => p.name.toLowerCase() === payee.toLowerCase())) {
        await savePayee({ name: payee, color: '#10b981' });
      }
      if (category !== 'Unspecified' && !categories.some(c => c.name.toLowerCase() === category.toLowerCase())) {
        await saveCategory({ name: category, color: '#6366f1' });
      }

      const signedAmount = type === 1 ? Math.abs(amount) : -Math.abs(amount);

      await addTransaction({
        id: generateId(),
        type,
        amount: signedAmount,
        category,
        payee,
        note: valueFor(draft, 'note'),
        date: new Date(valueFor(draft, 'date')).toISOString(),
        account,
        transferTo: null,
        currency: valueFor(draft, 'currency'),
        receivedAmount: null,
        isExpenseShare: false,
        expenseShares: null,
        splits: null,
        repayments: [],
        writeOffs: [],
        updatedAt: new Date().toISOString(),
        pendingSync: true
      });

      const learned = learnFromApproval(automationRules, draft, { account, payee, category });
      if (learned !== automationRules) await setAutomationRules(learned);

      // The draft has served its purpose, and it is the only plaintext copy of
      // this message on the server. It goes as soon as the transaction exists.
      await deleteDraft(draft.id);
      await onRefresh();
    } catch (err) {
      console.error('Failed to add transaction from draft:', err);
      alert('Could not add this transaction. It is still in the queue — try again.');
    } finally {
      setBusyId(null);
    }
  }, [valueFor, payees, categories, savePayee, saveCategory, addTransaction,
      automationRules, setAutomationRules, onRefresh]);

  const handleDismiss = useCallback(async (draft) => {
    setBusyId(draft.id);
    try {
      await deleteDraft(draft.id);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }, [onRefresh]);

  if (!isOpen) return null;

  const accountOptions = accounts.map(a => ({ value: a.name, label: a.name }));
  const categoryOptions = [
    { value: '', label: 'Uncategorised' },
    ...categories.map(c => ({ value: c.name, label: c.name }))
  ];
  const payeeOptions = payees.map(p => ({ value: p.name, label: p.name }));

  return (
    <ModalWrapper onClose={onClose} zIndex={2400}>
      <div className="inbox-modal glass-panel" onClick={e => e.stopPropagation()}>
        <div className="inbox-header">
          <div className="inbox-title">
            <Inbox size={20} />
            <h3>Detected Transactions</h3>
            {drafts.length > 0 && <span className="inbox-count">{drafts.length}</span>}
          </div>
          <div className="inbox-header-actions">
            <button
              className="inbox-icon-btn"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Check for new messages"
            >
              <RefreshCw size={18} className={isRefreshing ? 'spinning' : ''} />
            </button>
            <button className="inbox-icon-btn" onClick={onClose} title="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="inbox-body">
          {drafts.length === 0 ? (
            <div className="inbox-empty">
              <Inbox size={40} />
              <p>Nothing waiting</p>
              <span>
                Transactions detected from your bank SMS and notifications will
                appear here for you to confirm.
              </span>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {drafts.map(draft => {
                const suggestion = suggestions[draft.id] || {};
                const level = confidenceLabel(draft.confidence || 0);
                const isBusy = busyId === draft.id;
                const isOpenRow = !!expanded[draft.id];
                const type = valueFor(draft, 'type');

                return (
                  <motion.div
                    key={draft.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`inbox-card ${isBusy ? 'busy' : ''}`}
                  >
                    <div className="inbox-card-top">
                      <div className="inbox-meta">
                        <span className="inbox-bank">
                          {draft.parsed?.bank || draft.sender || 'Unknown sender'}
                        </span>
                        <span className={`inbox-confidence ${level}`}>{level} confidence</span>
                      </div>
                      <div className={`inbox-amount ${type === 1 ? 'income' : 'expense'}`}>
                        {type === 1 ? '+' : '-'}
                        {getCurrencySymbol(valueFor(draft, 'currency'))}
                        {formatCurrency(Math.abs(parseFloat(valueFor(draft, 'amount')) || 0))}
                      </div>
                    </div>

                    <button
                      className="inbox-raw-toggle"
                      onClick={() => setExpanded(c => ({ ...c, [draft.id]: !c[draft.id] }))}
                    >
                      <span className="inbox-raw-preview">{draft.rawText}</span>
                      {isOpenRow ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {isOpenRow && <div className="inbox-raw-full">{draft.rawText}</div>}

                    {!suggestion.directionKnown && (
                      <div className="inbox-warning">
                        Could not tell whether this was money in or out — check the
                        type below.
                      </div>
                    )}

                    <div className="inbox-type-toggle" data-type={type}>
                      <button
                        className={type === 0 ? 'active expense' : ''}
                        onClick={() => setField(draft.id, 'type', 0)}
                      >Expense</button>
                      <button
                        className={type === 1 ? 'active income' : ''}
                        onClick={() => setField(draft.id, 'type', 1)}
                      >Income</button>
                    </div>

                    <div className="inbox-fields">
                      <label className="inbox-field">
                        <span>Amount</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={valueFor(draft, 'amount')}
                          onChange={e => setField(draft.id, 'amount', e.target.value)}
                        />
                      </label>
                      <label className="inbox-field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={valueFor(draft, 'date')}
                          onChange={e => setField(draft.id, 'date', e.target.value)}
                        />
                      </label>
                      <div className="inbox-field">
                        <span>
                          Account
                          {draft.parsed?.last4 && (
                            <em className="inbox-hint"> card ...{draft.parsed.last4}</em>
                          )}
                        </span>
                        <UnifiedDropdown
                          value={valueFor(draft, 'account')}
                          options={accountOptions}
                          onChange={v => setField(draft.id, 'account', v)}
                          placeholder="Choose account"
                        />
                      </div>
                      <div className="inbox-field">
                        <span>Payee</span>
                        <input
                          type="text"
                          list={`inbox-payees-${draft.id}`}
                          value={valueFor(draft, 'payee')}
                          onChange={e => setPayeeField(draft, e.target.value)}
                          placeholder="Unspecified"
                        />
                        <datalist id={`inbox-payees-${draft.id}`}>
                          {payeeOptions.map(p => <option key={p.value} value={p.value} />)}
                        </datalist>
                      </div>
                      <div className="inbox-field inbox-field-wide">
                        <span>Category</span>
                        <UnifiedDropdown
                          value={valueFor(draft, 'category')}
                          options={categoryOptions}
                          onChange={v => setField(draft.id, 'category', v)}
                          placeholder="Uncategorised"
                        />
                      </div>
                    </div>

                    <div className="inbox-actions">
                      <button
                        className="inbox-btn dismiss"
                        onClick={() => handleDismiss(draft)}
                        disabled={isBusy}
                      >
                        <Trash2 size={16} /> Dismiss
                      </button>
                      <button
                        className="inbox-btn approve"
                        onClick={() => handleApprove(draft)}
                        disabled={isBusy}
                      >
                        <Check size={16} /> {isBusy ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}
