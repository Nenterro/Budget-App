import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Check, Trash2, Inbox, ChevronRight, ChevronDown, ChevronUp, ArrowLeft,
  RefreshCw, User, Calendar, AlignLeft, Wallet, Tag, ArrowRight, ArrowRightLeft,
  ArrowDownLeft, ArrowUpRight, AlertTriangle, Unlink
} from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import UnifiedCalendar from './UnifiedCalendar';
import FieldPopover, { useIsMobile, TapField } from './FieldPopover';
import { useData } from '../context/DataContext';
import { dayToStoredDate } from '../utils/date';
import { useAutomationSettings } from '../context/SettingsContext';
import { deleteDraft } from '../store/inbox';
import {
  draftToSuggestion,
  learnFromApproval,
  confidenceLabel,
  looksLikeIdentifier,
  prettifyMerchant,
  findTransfers,
  pairToTransferSuggestion
} from '../utils/inboxDraft';
import { generateId } from '../store/db';
import { formatCurrency, getCurrencySymbol, formatAmountInput } from '../utils/format';
import { evalMath } from '../utils/math';
import './InboxReviewModal.css';

// The form's date display, matching the transaction form's dd/mm/yy.
const formatDayMonthYear = (value) => {
  if (!value) return '';
  const parts = String(value).split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
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

const itemTime = (draft) =>
  new Date(draft?.receivedAt || draft?.parsed?.occurredAt || 0).getTime();

/**
 * The review queue for transactions detected from SMS and notifications.
 *
 * A list you scan, then one entry at a time opened into a full form — the same
 * shape as the shared-expenses modal, because the job is the same: most rows
 * need no attention, and the one that does needs all of it.
 *
 * An entry is usually a single message, but a transfer between your own
 * accounts arrives as two: a debit from the sending app and a credit from the
 * receiving one. Approved separately those become an expense and an income,
 * which double-counts the movement and leaves both balances wrong, so matched
 * halves are shown and approved as one transfer.
 *
 * Nothing is added without a tap. Every approval teaches the rules.
 */
export default function InboxReviewModal({ isOpen, onClose, drafts, onRefresh }) {
  const {
    accounts, categories, payees, transactions,
    addTransaction, savePayee, saveCategory
  } = useData();
  const { automationRules, setAutomationRules } = useAutomationSettings();
  const isMobile = useIsMobile();

  const [selectedId, setSelectedId] = useState(null);
  const [edits, setEdits] = useState({});
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  // Pairs the user has said are not transfers after all. Kept for the life of
  // the modal rather than persisted: the two halves are about to be approved
  // separately and gone.
  const [rejectedPairs, setRejectedPairs] = useState(() => new Set());

  // One entry per thing to review: a matched transfer, or a lone message.
  const items = useMemo(() => {
    const transfers = findTransfers(drafts, { accounts, rules: automationRules })
      .filter(transfer => !rejectedPairs.has(transfer.id));

    // Either half may be absent: not every app reports both legs.
    const paired = new Set(
      transfers.flatMap(t => [t.debit?.id, t.credit?.id]).filter(Boolean)
    );

    return [
      ...transfers.map(pair => ({
        kind: 'transfer',
        id: pair.id,
        pair,
        time: Math.max(itemTime(pair.debit), itemTime(pair.credit))
      })),
      ...drafts
        .filter(draft => !paired.has(draft.id))
        .map(draft => ({ kind: 'single', id: draft.id, draft, time: itemTime(draft) }))
    ].sort((a, b) => b.time - a.time);
  }, [drafts, accounts, automationRules, rejectedPairs]);

  const suggestions = useMemo(() => {
    const map = {};
    for (const item of items) {
      map[item.id] = item.kind === 'transfer'
        ? pairToTransferSuggestion(item.pair, { accounts, rules: automationRules })
        : draftToSuggestion(item.draft, {
            accounts, categories, payees, transactions, rules: automationRules
          });
    }
    return map;
  }, [items, accounts, categories, payees, transactions, automationRules]);

  // Edits for entries that have left the queue are dead weight, and keeping
  // them would resurrect stale values if an id ever came back.
  useEffect(() => {
    const live = new Set(items.map(i => i.id));
    setEdits(current => {
      const next = {};
      let dropped = false;
      for (const [id, value] of Object.entries(current)) {
        if (live.has(id)) next[id] = value;
        else dropped = true;
      }
      return dropped ? next : current;
    });
    // An entry approved elsewhere (another device), or re-paired underneath
    // us, must not leave the detail view showing something that is gone.
    setSelectedId(current => (current && !live.has(current) ? null : current));
  }, [items]);

  const selected = useMemo(
    () => items.find(i => i.id === selectedId) || null, [items, selectedId]);

  const valueFor = useCallback((item, field) => {
    const edited = edits[item.id];
    if (edited && field in edited) return edited[field];
    return suggestions[item.id]?.[field] ?? '';
  }, [edits, suggestions]);

  const setField = useCallback((itemId, field, value) => {
    setEdits(current => ({
      ...current,
      [itemId]: { ...(current[itemId] || {}), [field]: value }
    }));
  }, []);

  // Picking a payee pulls its usual category across, unless the user has
  // already chosen one by hand.
  const setPayeeField = useCallback((item, value) => {
    setEdits(current => {
      const existing = current[item.id] || {};
      const next = { ...existing, payee: value };
      if (!('category' in existing)) {
        const learned = automationRules?.categoryByPayee?.[value];
        if (learned) next.category = learned;
      }
      return { ...current, [item.id]: next };
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

  const handleApprove = useCallback(async (item) => {
    // evalMath, not parseFloat: the field formats digit groups and accepts
    // arithmetic, and parseFloat("1,200") is 1.
    const amount = evalMath(valueFor(item, 'amount'));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid amount before adding this transaction.');
      return;
    }

    setBusy(true);
    try {
      if (item.kind === 'transfer') {
        const from = valueFor(item, 'from');
        const to = valueFor(item, 'to');
        if (!from || !to) {
          alert('Choose both accounts before adding this transfer.');
          return;
        }
        if (from === to) {
          alert('A transfer needs two different accounts.');
          return;
        }

        // The shape the rest of the app expects of a transfer: negative
        // amount on the source account, the destination in transferTo, and
        // the generated payee label the reference rewriting keys off.
        await addTransaction({
          id: generateId(),
          type: 2,
          amount: -Math.abs(amount),
          category: 'Transfer',
          payee: `Transfer to ${to}`,
          note: valueFor(item, 'note'),
          date: dayToStoredDate(valueFor(item, 'date')),
          account: from,
          transferTo: to,
          currency: valueFor(item, 'currency'),
          receivedAmount: null,
          isExpenseShare: false,
          expenseShares: null,
          splits: null,
          repayments: [],
          writeOffs: [],
          updatedAt: new Date().toISOString(),
          pendingSync: true
        });

        // Whichever halves arrived described the one movement, so they go.
        if (item.pair.debit) await deleteDraft(item.pair.debit.id);
        if (item.pair.credit) await deleteDraft(item.pair.credit.id);
      } else {
        const draft = item.draft;
        const account = valueFor(item, 'account');
        if (!account) {
          alert('Choose which account this transaction belongs to.');
          return;
        }

        const type = valueFor(item, 'type');
        const payee = (valueFor(item, 'payee') || '').trim() || 'Unspecified';
        const category = (valueFor(item, 'category') || '').trim() || 'Unspecified';

        // A payee or category named here becomes a real one, exactly as it
        // would if it had been typed into the Add Transaction form.
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
          note: valueFor(item, 'note'),
          date: dayToStoredDate(valueFor(item, 'date')),
          account,
          transferTo: null,
          currency: valueFor(item, 'currency'),
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

        // The draft has served its purpose, and it is the only plaintext copy
        // of this message on the server. It goes as soon as the transaction
        // exists.
        await deleteDraft(draft.id);
      }

      setSelectedId(null);
      await onRefresh();
    } catch (err) {
      console.error('Failed to add transaction from draft:', err);
      alert('Could not add this. It is still in the queue — try again.');
    } finally {
      setBusy(false);
    }
  }, [valueFor, payees, categories, savePayee, saveCategory, addTransaction,
      automationRules, setAutomationRules, onRefresh]);

  const handleDismiss = useCallback(async (item) => {
    setBusy(true);
    try {
      if (item.kind === 'transfer') {
        if (item.pair.debit) await deleteDraft(item.pair.debit.id);
        if (item.pair.credit) await deleteDraft(item.pair.credit.id);
      } else {
        await deleteDraft(item.draft.id);
      }
      setSelectedId(null);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  // The escape hatch for a wrong match: two unrelated transactions that
  // happened to be for the same amount at the same moment. Splitting them
  // back apart is better than dismissing, which would throw both away.
  const handleUnpair = useCallback((item) => {
    setRejectedPairs(current => new Set(current).add(item.id));
    setSelectedId(null);
  }, []);

  if (!isOpen) return null;

  const closeDetail = () => { setSelectedId(null); setActiveField(null); };

  return (
    <ModalWrapper onClose={selected ? closeDetail : onClose} zIndex={2400}>
      <div className="modal-content inbox-modal" onClick={e => e.stopPropagation()}>
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
                {items.length === 0 ? (
                  <div className="ib-empty">
                    <Inbox size={44} style={{ opacity: 0.3 }} />
                    <p>Nothing waiting</p>
                    <span>
                      Transactions detected from your bank SMS and notifications
                      appear here for you to confirm.
                    </span>
                  </div>
                ) : items.map(item => {
                  const isTransfer = item.kind === 'transfer';
                  const type = isTransfer ? 2 : valueFor(item, 'type');
                  const isIncome = type === 1;
                  const amount = Math.abs(evalMath(valueFor(item, 'amount')) || 0);
                  const symbol = getCurrencySymbol(valueFor(item, 'currency'));

                  const source = isTransfer ? (item.pair.debit || item.pair.credit) : item.draft;
                  const level = confidenceLabel(source.confidence || 0);

                  const title = isTransfer
                    ? 'Transfer'
                    : (valueFor(item, 'payee') || item.draft.parsed?.merchant || 'Unknown payee');

                  const meta = isTransfer
                    ? `${valueFor(item, 'from') || 'Unknown'} → ${valueFor(item, 'to') || 'Unknown'}`
                    : `${item.draft.parsed?.bank || item.draft.sender || 'Unknown sender'} • ${formatDayMonthYear(valueFor(item, 'date'))}`;

                  const sub = isTransfer
                    ? (item.pair.oneSided ? 'Needs the other account' : 'Two messages matched')
                    : (valueFor(item, 'account') || 'Needs account');

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="ib-card"
                      onClick={() => { setSelectedId(item.id); setShowRaw(false); }}
                    >
                      <div
                        className="ib-card-icon"
                        style={{
                          background: isTransfer ? 'rgba(168,85,247,0.15)'
                            : isIncome ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'
                        }}
                      >
                        {isTransfer
                          ? <ArrowRightLeft size={16} style={{ color: '#a855f7' }} />
                          : isIncome
                            ? <ArrowDownLeft size={16} style={{ color: '#10b981' }} />
                            : <ArrowUpRight size={16} style={{ color: '#ef4444' }} />}
                      </div>
                      <div className="ib-card-info">
                        <span className="ib-card-payee">{title}</span>
                        <span className="ib-card-meta">{meta}</span>
                      </div>
                      <div className="ib-card-amounts">
                        <span className={`ib-card-total ${isTransfer ? 'transfer' : isIncome ? 'income' : 'expense'}`}>
                          {isTransfer ? '' : isIncome ? '+' : '-'}
                          {symbol}{formatCurrency(amount)}
                        </span>
                        <span className={`ib-card-sub ${!isTransfer && !valueFor(item, 'account') ? 'needs-input' : ''}`}>
                          {sub}
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
                const item = selected;
                const isTransfer = item.kind === 'transfer';
                const draft = isTransfer ? (item.pair.debit || item.pair.credit) : item.draft;
                const type = isTransfer ? 2 : valueFor(item, 'type');
                const suggestion = suggestions[item.id] || {};
                const amountValue = String(valueFor(item, 'amount') ?? '');

                // The amount field accepts arithmetic the same way the
                // transaction form does.
                const evalResult = evalMath(amountValue);
                const showPreview = /[+\-*/]/.test(amountValue) && evalResult !== null;

                const CurrencyIcon = ({ size, className, style }) => (
                  <span
                    className={className}
                    style={{ ...style, fontSize: size, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {getCurrencySymbol(valueFor(item, 'currency'))}
                  </span>
                );

                return (
                  <>
                    <div className="ib-header">
                      <button
                        className="ib-icon-btn"
                        onClick={closeDetail}
                        type="button"
                        aria-label="Back to list"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <div className="ib-header-titles">
                        <h2>
                          {isTransfer
                            ? 'Transfer between your accounts'
                            : (draft.parsed?.merchant || 'Detected transaction')}
                        </h2>
                        <span>
                          {draft.parsed?.bank || draft.sender || 'Unknown sender'}
                          {draft.parsed?.last4 ? ` • card ...${draft.parsed.last4}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="ib-form">
                      {isTransfer ? (
                        <div className="ib-transfer-note">
                          <ArrowRightLeft size={14} />
                          <span>
                            {item.pair.oneSided
                              ? `Only one side of this was reported, and ${draft.parsed?.merchant || 'the counterparty'} is a name you marked as your own — so pick the account at the other end.`
                              : 'Two messages, same amount, moments apart — matched as one transfer so the movement is not counted twice.'}
                          </span>
                        </div>
                      ) : (
                        <div className="ib-type-selector" data-type={type}>
                          <button
                            type="button"
                            className={`ib-type-btn ${type === 0 ? 'expense-active' : ''}`}
                            onClick={() => setField(item.id, 'type', 0)}
                          >Expense</button>
                          <button
                            type="button"
                            className={`ib-type-btn ${type === 1 ? 'income-active' : ''}`}
                            onClick={() => setField(item.id, 'type', 1)}
                          >Income</button>
                        </div>
                      )}

                      {!isTransfer && !suggestion.directionKnown && (
                        <div className="ib-warning">
                          <AlertTriangle size={14} />
                          <span>
                            The message did not say whether this was money in or
                            out. Check the type above.
                          </span>
                        </div>
                      )}

                      <div className="ib-form-row">
                        <div className="ib-form-group ib-flex-2 ib-relative">
                          {amountValue && <label>Amount ({valueFor(item, 'currency')})</label>}
                          {isMobile ? (
                            <div onClick={() => setActiveField('amount')} style={{ cursor: 'pointer' }}>
                              <div className="input-with-icon" style={{ pointerEvents: 'none' }}>
                                <CurrencyIcon size={18} className="input-icon" />
                                <input type="text" placeholder="Amount" value={amountValue} readOnly />
                              </div>
                              {showPreview && <div className="ib-math-preview">= {formatCurrency(evalResult)}</div>}
                            </div>
                          ) : (
                            <>
                              <div className="input-with-icon">
                                <CurrencyIcon size={18} className="input-icon" />
                                <input
                                  type="text"
                                  placeholder="Amount"
                                  value={amountValue}
                                  onChange={e => setField(item.id, 'amount', formatAmountInput(e.target.value))}
                                />
                              </div>
                              {showPreview && <div className="ib-math-preview">= {formatCurrency(evalResult)}</div>}
                            </>
                          )}
                        </div>

                        <div className="ib-form-group ib-flex-1">
                          <label>Date</label>
                          <div
                            className="input-with-icon"
                            onClick={() => setIsCalendarOpen(true)}
                            style={{ cursor: 'pointer' }}
                          >
                            <Calendar size={18} className="input-icon" />
                            <input
                              type="text"
                              value={formatDayMonthYear(valueFor(item, 'date'))}
                              readOnly
                              style={{ cursor: 'pointer', paddingLeft: '34px' }}
                            />
                          </div>
                        </div>
                      </div>

                      {isTransfer ? (
                        <div className="ib-form-row ib-transfer-row">
                          <div className="ib-form-group ib-flex-1">
                            {isMobile ? (
                              <TapField
                                label="From"
                                value={valueFor(item, 'from')}
                                icon={Wallet}
                                compact
                                onOpen={() => setActiveField('account')}
                              />
                            ) : (
                              <>
                                {valueFor(item, 'from') && <label>From</label>}
                                <UnifiedDropdown
                                  value={valueFor(item, 'from')}
                                  options={withCurrentValue(accounts, valueFor(item, 'from'))}
                                  onChange={v => setField(item.id, 'from', v)}
                                  placeholder="From account"
                                />
                              </>
                            )}
                          </div>
                          <div className="ib-transfer-arrow">
                            <ArrowRight size={16} />
                          </div>
                          <div className="ib-form-group ib-flex-1">
                            {isMobile ? (
                              <TapField
                                label="To"
                                value={valueFor(item, 'to')}
                                icon={ArrowRightLeft}
                                compact
                                onOpen={() => setActiveField('transferTo')}
                              />
                            ) : (
                              <>
                                {valueFor(item, 'to') && <label>To</label>}
                                <UnifiedDropdown
                                  value={valueFor(item, 'to')}
                                  options={withCurrentValue(accounts, valueFor(item, 'to'))}
                                  onChange={v => setField(item.id, 'to', v)}
                                  placeholder="To account"
                                />
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {isMobile ? (
                            <TapField
                              label="Account"
                              value={valueFor(item, 'account')}
                              icon={Wallet}
                              onOpen={() => setActiveField('account')}
                            />
                          ) : (
                            <div className="ib-form-group">
                              {valueFor(item, 'account') && <label>Account</label>}
                              <UnifiedDropdown
                                value={valueFor(item, 'account')}
                                options={withCurrentValue(accounts, valueFor(item, 'account'))}
                                onChange={v => setField(item.id, 'account', v)}
                                placeholder="Choose account"
                              />
                            </div>
                          )}

                          <div className="ib-form-group">
                            {isMobile ? (
                              <TapField
                                label="Payee"
                                value={valueFor(item, 'payee')}
                                icon={User}
                                onOpen={() => setActiveField('payee')}
                              />
                            ) : (
                              <>
                                {valueFor(item, 'payee') && <label>Payee</label>}
                                <div
                                  className="input-with-icon"
                                  onClick={() => setActiveField('payee')}
                                >
                                  <User size={18} className="input-icon" />
                                  <input
                                    type="text"
                                    placeholder="Unspecified"
                                    value={valueFor(item, 'payee')}
                                    readOnly
                                    style={{ cursor: 'pointer' }}
                                  />
                                </div>
                              </>
                            )}
                            {(() => {
                              const merchant = draft.parsed?.merchant;
                              if (!merchant || !looksLikeIdentifier(merchant)) return null;
                              const chosen = (valueFor(item, 'payee') || '').trim();
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

                          {isMobile ? (
                            <TapField
                              label="Category"
                              value={valueFor(item, 'category')}
                              icon={Tag}
                              onOpen={() => setActiveField('category')}
                            />
                          ) : (
                            <div className="ib-form-group">
                              {valueFor(item, 'category') && <label>Category</label>}
                              <div
                                className="input-with-icon"
                                onClick={() => setActiveField('category')}
                              >
                                <Tag size={18} className="input-icon" />
                                <input
                                  type="text"
                                  placeholder="Uncategorised"
                                  value={valueFor(item, 'category')}
                                  readOnly
                                  style={{ cursor: 'pointer' }}
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {isMobile ? (
                        <TapField
                          label="Note"
                          value={valueFor(item, 'note')}
                          icon={AlignLeft}
                          onOpen={() => setActiveField('note')}
                        />
                      ) : (
                        <div className="ib-form-group">
                          {valueFor(item, 'note') && <label>Note</label>}
                          <div className="input-with-icon">
                            <AlignLeft size={18} className="input-icon" />
                            <input
                              type="text"
                              value={valueFor(item, 'note')}
                              onChange={e => setField(item.id, 'note', e.target.value)}
                              placeholder="Note"
                            />
                          </div>
                        </div>
                      )}

                      <AnimatePresence>
                        {isCalendarOpen && (
                          <UnifiedCalendar
                            value={valueFor(item, 'date')}
                            onChange={v => setField(item.id, 'date', v)}
                            onClose={() => setIsCalendarOpen(false)}
                            // Must clear this modal's own z-index, or the
                            // calendar opens behind it and cannot be used.
                            zIndex={2500}
                          />
                        )}
                      </AnimatePresence>

                      <button
                        type="button"
                        className="ib-raw-toggle"
                        onClick={() => setShowRaw(v => !v)}
                      >
                        <span>{isTransfer && item.pair.debit && item.pair.credit
                          ? 'Both original messages' : 'Original message'}</span>
                        {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {showRaw && (
                        isTransfer ? (
                          <>
                            {item.pair.debit && (
                              <div className="ib-raw">
                                <strong>Sent</strong> {item.pair.debit.rawText}
                              </div>
                            )}
                            {item.pair.credit && (
                              <div className="ib-raw">
                                <strong>Received</strong> {item.pair.credit.rawText}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="ib-raw">{draft.rawText}</div>
                        )
                      )}

                      {isTransfer && (
                        <button
                          type="button"
                          className="ib-unpair-btn"
                          onClick={() => handleUnpair(item)}
                          disabled={busy}
                        >
                          <Unlink size={14} /> Not a transfer — review separately
                        </button>
                      )}

                      <div className="ib-actions">
                        <button
                          type="button"
                          className="ib-cancel-btn"
                          onClick={() => handleDismiss(item)}
                          disabled={busy}
                        >
                          <Trash2 size={16} /> Dismiss
                        </button>
                        <button
                          type="button"
                          className="ib-submit-btn"
                          onClick={() => handleApprove(item)}
                          disabled={busy}
                        >
                          <Check size={16} />
                          {busy ? 'Adding...' : isTransfer ? 'Add transfer' : 'Add transaction'}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sits inside the panel, which is position:relative — the overlay is
            absolutely positioned and covers the modal rather than the page. */}
        {selected && activeField && (
          <FieldPopover
            field={activeField}
            items={
              activeField === 'category' ? categories
                : activeField === 'payee' ? payees
                : (activeField === 'account' || activeField === 'transferTo') ? accounts
                : []
            }
            initialValue={valueFor(selected, popoverFieldName(selected, activeField))}
            onSelect={(val) => {
              const target = popoverFieldName(selected, activeField);
              if (target === 'payee') setPayeeField(selected, val);
              else setField(selected.id, target, val);
              setActiveField(null);
            }}
            onSaveValue={(val) =>
              setField(selected.id, popoverFieldName(selected, activeField), val)}
            onAdd={async (val) => {
              // Creating from here works exactly as it does in the transaction
              // form: the payee or category becomes a real one immediately.
              if (activeField === 'category') {
                await saveCategory({ name: val, color: '#6366f1' });
                setField(selected.id, 'category', val);
              } else if (activeField === 'payee') {
                await savePayee({ name: val, color: '#10b981' });
                setPayeeField(selected, val);
              }
              setActiveField(null);
            }}
            onClose={() => setActiveField(null)}
          />
        )}
      </div>
    </ModalWrapper>
  );
}

// The popover is told which *kind* of field it is showing so it can offer the
// right list, but a transfer stores its two accounts as from/to rather than
// account/transferTo. This maps one to the other.
function popoverFieldName(item, field) {
  if (item?.kind !== 'transfer') return field;
  if (field === 'account') return 'from';
  if (field === 'transferTo') return 'to';
  return field;
}
