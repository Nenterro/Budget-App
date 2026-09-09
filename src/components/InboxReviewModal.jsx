import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Check, Trash2, Inbox, ChevronRight, ChevronDown, ChevronUp, ArrowLeft,
  RefreshCw, User, Calendar, FileText, Banknote,
  ArrowDownLeft, ArrowUpRight, AlertTriangle
} from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import { useData } from '../context/DataContext';
import { useAutomationSettings } from '../context/SettingsContext';
import { deleteDraft } from '../store/inbox';
import {
  draftToSuggestion,
  learnFromApproval,
  confidenceLabel,
  looksLikeIdentifier,
  prettifyMerchant
} from '../utils/inboxDraft';
import { generateId } from '../store/db';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { format, parseISO } from 'date-fns';
import './InboxReviewModal.css';

const formatDateShort = (value) => {
  if (!value) return '';
  try {
    return format(parseISO(value), 'dd/MM/yy');
  } catch {
    return String(value).substring(0, 10);
  }
};

// A dropdown whose value is not among its options renders as its placeholder,
// which makes a prefilled field look empty. Same fix as the sharing modal.
const withCurrentValue = (items, current) => {
  const options = items.map(i => ({ value: i.name, label: i.name }));
  if (current && !options.some(o => o.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
};

/**
 * The review queue for transactions detected from SMS and notifications.
 *
 * A list you scan, then one draft at a time opened into a full form — the same
 * shape as the shared-expenses modal, because the job is the same: most rows
 * need no attention, and the one that does needs all of it.
 *
 * Nothing is added without a tap. Every approval teaches the rules: this card
 * is that account, this merchant is that payee, that payee is that category.
 */
export default function InboxReviewModal({ isOpen, onClose, drafts, onRefresh }) {
  const {
    accounts, categories, payees, transactions,
    addTransaction, savePayee, saveCategory
  } = useData();
  const { automationRules, setAutomationRules } = useAutomationSettings();

  const [selectedId, setSelectedId] = useState(null);
  const [edits, setEdits] = useState({});
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const suggestions = useMemo(() => {
    const map = {};
    for (const draft of drafts) {
      map[draft.id] = draftToSuggestion(draft, {
        accounts, categories, payees, transactions, rules: automationRules
      });
    }
    return map;
  }, [drafts, accounts, categories, payees, transactions, automationRules]);

  // Edits for drafts that have left the queue are dead weight, and keeping
  // them would resurrect stale values if an id ever came back.
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
    // The open draft being approved elsewhere (another device) must not leave
    // the detail view showing something that no longer exists.
    setSelectedId(current => (current && !live.has(current) ? null : current));
  }, [drafts]);

  const selected = useMemo(
    () => drafts.find(d => d.id === selectedId) || null, [drafts, selectedId]);

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

  // Picking a payee pulls its usual category across, unless the user has
  // already chosen one by hand.
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

    setBusy(true);
    try {
      const type = valueFor(draft, 'type');
      const payee = (valueFor(draft, 'payee') || '').trim() || 'Unspecified';
      const category = (valueFor(draft, 'category') || '').trim() || 'Unspecified';

      // A payee or category named here becomes a real one, exactly as it would
      // if it had been typed into the Add Transaction form.
      if (payee !== 'Unspecified' && !payees.some(p => p.name.toLowerCase() === payee.toLowerCase())) {
        await savePayee({ name: payee, color: '#10b981' });
      }
      if (category !== 'Unspecified' && !categories.some(c => c.name.toLowerCase() === category.toLowerCase())) {
        await saveCategory({ name: category, color: '#6366f1' });
      }

      await addTransaction({
        id: generateId(),
        type,
        amount: type === 1 ? Math.abs(amount) : -Math.abs(amount),
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
      setSelectedId(null);
      await onRefresh();
    } catch (err) {
      console.error('Failed to add transaction from draft:', err);
      alert('Could not add this transaction. It is still in the queue — try again.');
    } finally {
      setBusy(false);
    }
  }, [valueFor, payees, categories, savePayee, saveCategory, addTransaction,
      automationRules, setAutomationRules, onRefresh]);

  const handleDismiss = useCallback(async (draft) => {
    setBusy(true);
    try {
      await deleteDraft(draft.id);
      setSelectedId(null);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  const openDraft = useCallback((draft) => {
    setSelectedId(draft.id);
    setShowRaw(false);
  }, []);

  if (!isOpen) return null;

  const categoryOptions = [
    { value: '', label: 'Uncategorised' },
    ...categories.map(c => ({ value: c.name, label: c.name }))
  ];

  return (
    <ModalWrapper onClose={selected ? () => setSelectedId(null) : onClose} zIndex={2400}>
      <div className="inbox-modal glass-panel" onClick={e => e.stopPropagation()}>
        <AnimatePresence mode="wait">
          {!selected ? (
            <motion.div
              key="list"
              className="ib-view"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="ib-header">
                <h2><Inbox size={18} /> Detected transactions</h2>
                <div className="ib-header-actions">
                  <button
                    className="ib-icon-btn"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    type="button"
                    aria-label="Check for new messages"
                  >
                    <RefreshCw size={18} className={isRefreshing ? 'ib-spin' : ''} />
                  </button>
                  <button className="ib-icon-btn" onClick={onClose} type="button" aria-label="Close">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="ib-list">
                {drafts.length === 0 ? (
                  <div className="ib-empty">
                    <Inbox size={44} style={{ opacity: 0.3 }} />
                    <p>Nothing waiting</p>
                    <span>
                      Transactions detected from your bank SMS and notifications
                      appear here for you to confirm.
                    </span>
                  </div>
                ) : drafts.map(draft => {
                  const type = valueFor(draft, 'type');
                  const isIncome = type === 1;
                  const level = confidenceLabel(draft.confidence || 0);
                  const payee = valueFor(draft, 'payee');
                  const account = valueFor(draft, 'account');

                  return (
                    <button
                      key={draft.id}
                      type="button"
                      className="ib-card"
                      onClick={() => openDraft(draft)}
                    >
                      <div
                        className="ib-card-icon"
                        style={{ background: isIncome ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' }}
                      >
                        {isIncome
                          ? <ArrowDownLeft size={16} style={{ color: '#10b981' }} />
                          : <ArrowUpRight size={16} style={{ color: '#ef4444' }} />}
                      </div>
                      <div className="ib-card-info">
                        <span className="ib-card-payee">
                          {payee || draft.parsed?.merchant || 'Unknown payee'}
                        </span>
                        <span className="ib-card-meta">
                          {draft.parsed?.bank || draft.sender || 'Unknown sender'}
                          {' • '}
                          {formatDateShort(valueFor(draft, 'date'))}
                        </span>
                      </div>
                      <div className="ib-card-amounts">
                        <span className={`ib-card-total ${isIncome ? 'income' : 'expense'}`}>
                          {isIncome ? '+' : '-'}
                          {getCurrencySymbol(valueFor(draft, 'currency'))}
                          {formatCurrency(Math.abs(parseFloat(valueFor(draft, 'amount')) || 0))}
                        </span>
                        <span className={`ib-card-sub ${account ? '' : 'needs-input'}`}>
                          {account || 'Needs account'}
                          <i className={`ib-dot ${level}`} />
                        </span>
                      </div>
                      <ChevronRight size={16} className="ib-card-chevron" />
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="detail"
              className="ib-view"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {(() => {
                const draft = selected;
                const type = valueFor(draft, 'type');
                const suggestion = suggestions[draft.id] || {};
                const symbol = getCurrencySymbol(valueFor(draft, 'currency'));

                return (
                  <>
                    <div className="ib-header">
                      <button
                        className="ib-icon-btn"
                        onClick={() => setSelectedId(null)}
                        type="button"
                        aria-label="Back to list"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <div className="ib-header-titles">
                        <h2>{draft.parsed?.merchant || 'Detected transaction'}</h2>
                        <span>
                          {draft.parsed?.bank || draft.sender || 'Unknown sender'}
                          {draft.parsed?.last4 ? ` • card ...${draft.parsed.last4}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="ib-form">
                      <div className="ib-type-selector" data-type={type}>
                        <button
                          type="button"
                          className={`ib-type-btn ${type === 0 ? 'expense-active' : ''}`}
                          onClick={() => setField(draft.id, 'type', 0)}
                        >Expense</button>
                        <button
                          type="button"
                          className={`ib-type-btn ${type === 1 ? 'income-active' : ''}`}
                          onClick={() => setField(draft.id, 'type', 1)}
                        >Income</button>
                      </div>

                      {!suggestion.directionKnown && (
                        <div className="ib-warning">
                          <AlertTriangle size={14} />
                          <span>
                            The message did not say whether this was money in or
                            out. Check the type above.
                          </span>
                        </div>
                      )}

                      <div className="ib-form-group">
                        <label>Amount</label>
                        <div className="input-with-icon">
                          <Banknote size={18} className="input-icon" />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={valueFor(draft, 'amount')}
                            onChange={e => setField(draft.id, 'amount', e.target.value)}
                            placeholder={`${symbol} 0.00`}
                          />
                        </div>
                      </div>

                      <div className="ib-form-group">
                        <label>Date</label>
                        <div className="input-with-icon">
                          <Calendar size={18} className="input-icon" />
                          <input
                            type="date"
                            value={valueFor(draft, 'date')}
                            onChange={e => setField(draft.id, 'date', e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="ib-form-group">
                        <label>Account</label>
                        <UnifiedDropdown
                          value={valueFor(draft, 'account')}
                          options={withCurrentValue(accounts, valueFor(draft, 'account'))}
                          onChange={v => setField(draft.id, 'account', v)}
                          placeholder="Choose account"
                        />
                      </div>

                      <div className="ib-form-group">
                        <label>Payee</label>
                        <div className="input-with-icon">
                          <User size={18} className="input-icon" />
                          <input
                            type="text"
                            list={`ib-payees-${draft.id}`}
                            value={valueFor(draft, 'payee')}
                            onChange={e => setPayeeField(draft, e.target.value)}
                            placeholder="Unspecified"
                          />
                        </div>
                        <datalist id={`ib-payees-${draft.id}`}>
                          {payees.map(p => <option key={p.id || p.name} value={p.name} />)}
                        </datalist>
                        {(() => {
                          const merchant = draft.parsed?.merchant;
                          if (!merchant || !looksLikeIdentifier(merchant)) return null;
                          const chosen = (valueFor(draft, 'payee') || '').trim();
                          const named = chosen && chosen !== prettifyMerchant(merchant);
                          return (
                            <div className={`ib-hint ${named ? 'resolved' : ''}`}>
                              <code>{merchant}</code>
                              {named
                                ? <span>will be remembered as <strong>{chosen}</strong>.</span>
                                : <span>
                                    is an account identifier, not a name. Whoever
                                    you name here is remembered for every future
                                    transfer from it.
                                  </span>}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="ib-form-group">
                        <label>Category</label>
                        <UnifiedDropdown
                          value={valueFor(draft, 'category')}
                          options={categoryOptions}
                          onChange={v => setField(draft.id, 'category', v)}
                          placeholder="Uncategorised"
                        />
                      </div>

                      <div className="ib-form-group">
                        <label>Note</label>
                        <div className="input-with-icon">
                          <FileText size={18} className="input-icon" />
                          <input
                            type="text"
                            value={valueFor(draft, 'note')}
                            onChange={e => setField(draft.id, 'note', e.target.value)}
                            placeholder="Optional"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        className="ib-raw-toggle"
                        onClick={() => setShowRaw(v => !v)}
                      >
                        <span>Original message</span>
                        {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {showRaw && <div className="ib-raw">{draft.rawText}</div>}

                      <div className="ib-actions">
                        <button
                          type="button"
                          className="ib-cancel-btn"
                          onClick={() => handleDismiss(draft)}
                          disabled={busy}
                        >
                          <Trash2 size={16} /> Dismiss
                        </button>
                        <button
                          type="button"
                          className="ib-submit-btn"
                          onClick={() => handleApprove(draft)}
                          disabled={busy}
                        >
                          <Check size={16} /> {busy ? 'Adding...' : 'Add transaction'}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ModalWrapper>
  );
}
