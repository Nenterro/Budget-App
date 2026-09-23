import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Check, Trash2, Inbox, ChevronRight, ChevronDown, ChevronUp, ChevronLeft,
  ArrowLeft, RefreshCw, User, Users, Calendar, AlignLeft, Wallet, Tag,
  ArrowRight, ArrowRightLeft, ArrowDownLeft, ArrowUpRight, AlertTriangle,
  Unlink, Split, Plus, HandCoins
} from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import UnifiedCalendar from './UnifiedCalendar';
import FieldPopover, { useIsMobile, TapField } from './FieldPopover';
import { useData } from '../context/DataContext';
import { dayToStoredDate, dayStringOf } from '../utils/date';
import { useAutomationSettings } from '../context/SettingsContext';
import { deleteDraft } from '../store/inbox';
import { openLoans, applyRepayment, toBatch } from '../utils/expenseShares';
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

// Switching type slides the fields in from the side they came from, exactly as
// the transaction form's do.
const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
    position: 'relative'
  }),
  center: { x: 0, opacity: 1, position: 'relative' },
  exit: (direction) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0,
    position: 'absolute',
    top: 0, left: 0, right: 0
  })
};

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

const blankSplit = (account) => ({
  id: generateId(), amount: '', category: '', payee: '', account: account || ''
});

const blankShare = () => ({ id: generateId(), name: '', amount: '' });

// What a field is worth before either the parser or the user has said
// anything. `valueFor` walks edits -> parser suggestion -> here.
const FIELD_DEFAULTS = {
  type: 0,
  amount: '',
  date: '',
  account: '',
  transferTo: '',
  category: '',
  payee: '',
  note: '',
  currency: 'PKR',
  isSplit: false,
  splits: [],
  activeSplitIndex: 0,
  isExpenseShare: false,
  expenseShares: [],
  activePersonIndex: 0,
  isRepayment: false,
  loanId: ''
};

/**
 * The review queue for transactions detected from SMS and notifications.
 *
 * A list you scan, then one entry at a time opened into a full form — the same
 * shape as the shared-expenses modal, because the job is the same: most rows
 * need no attention, and the one that does needs all of it.
 *
 * That form is the transaction form: the same three type tabs, the same field
 * order, the same split and share carousels. Confirming a detected transaction
 * and typing one in by hand produce the same record, so they are the same
 * form — anything less and the quicker route is the one that can do less, and
 * a draft that needed splitting had to be dismissed and retyped.
 *
 * An entry is usually a single message, but a transfer between your own
 * accounts arrives as two: a debit from the sending app and a credit from the
 * receiving one. Approved separately those become an expense and an income,
 * which double-counts the movement and leaves both balances wrong, so matched
 * halves are shown and approved as one transfer.
 *
 * Money arriving on a loan is the third outcome, alongside adding and
 * dismissing. A credit that settles a shared expense is not new income — it
 * belongs to the expense it came back from, so approving it as a repayment
 * files it there rather than creating an unrelated income beside it.
 *
 * Nothing is added without a tap. Every approval teaches the rules.
 */
export default function InboxReviewModal({ isOpen, onClose, drafts, onRefresh }) {
  const {
    accounts, categories, payees, transactions,
    addTransaction, saveTransactionsBatch, savePayee, saveCategory
  } = useData();
  const { automationRules, setAutomationRules } = useAutomationSettings();
  const isMobile = useIsMobile();

  const [selectedId, setSelectedId] = useState(null);
  const [edits, setEdits] = useState({});
  const [showRaw, setShowRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [activeSplitId, setActiveSplitId] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [typeDirection, setTypeDirection] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
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

  // Every share with something still owed, across all shared expenses. Derived
  // once for the whole queue rather than per draft.
  const loans = useMemo(() => openLoans(transactions), [transactions]);
  const loanById = useCallback(
    (id) => loans.find(l => l.id === id) || null, [loans]);

  const suggestions = useMemo(() => {
    const map = {};
    for (const item of items) {
      if (item.kind === 'transfer') {
        const pair = pairToTransferSuggestion(item.pair, { accounts, rules: automationRules });
        // The pair helper names its two accounts from/to; the form — being the
        // transaction form — calls them account and transferTo. Normalising
        // here is what lets one set of fields serve all three types, and is
        // what makes the Transfer tab work for a single message too.
        map[item.id] = { ...pair, account: pair.from, transferTo: pair.to };
      } else {
        map[item.id] = draftToSuggestion(item.draft, {
          accounts, categories, payees, transactions, loans, rules: automationRules
        });
      }
    }
    return map;
  }, [items, accounts, categories, payees, transactions, loans, automationRules]);

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
    const suggested = suggestions[item.id];
    if (suggested && field in suggested) return suggested[field];
    return FIELD_DEFAULTS[field] ?? '';
  }, [edits, suggestions]);

  const setField = useCallback((itemId, field, value) => {
    setEdits(current => ({
      ...current,
      [itemId]: { ...(current[itemId] || {}), [field]: value }
    }));
  }, []);

  const setFields = useCallback((itemId, patch) => {
    setEdits(current => ({
      ...current,
      [itemId]: { ...(current[itemId] || {}), ...patch }
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

  // The drafts have served their purpose, and they are the only plaintext copy
  // of these messages on the server. They go as soon as the entry is resolved,
  // whichever way it was resolved.
  const dropDrafts = useCallback(async (item) => {
    if (item.kind === 'transfer') {
      if (item.pair.debit) await deleteDraft(item.pair.debit.id);
      if (item.pair.credit) await deleteDraft(item.pair.credit.id);
    } else {
      await deleteDraft(item.draft.id);
    }
  }, []);

  // What every approval does once its transaction exists, whether that was a
  // plain add or a repayment filed against a shared expense. `chosen` is null
  // when there is nothing worth learning from.
  const finishApproval = useCallback(async (item, chosen) => {
    if (item.kind === 'single' && chosen) {
      const learned = learnFromApproval(automationRules, item.draft, chosen);
      if (learned !== automationRules) await setAutomationRules(learned);
    }
    await dropDrafts(item);
    setSelectedId(null);
    await onRefresh();
  }, [automationRules, setAutomationRules, dropDrafts, onRefresh]);

  // Filing an incoming payment against a loan instead of adding it as income.
  //
  // The repayment's own income transaction is created by applyRepayment, which
  // also reduces what the person still owes — so the money lands once, on the
  // expense it came back from. Adding it here as well would count it twice.
  const handleRecordRepayment = useCallback(async (item) => {
    const amount = evalMath(valueFor(item, 'amount'));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid amount before recording this repayment.');
      return;
    }

    const account = valueFor(item, 'account');
    if (!account) {
      alert('Choose which account this repayment arrived in.');
      return;
    }

    const loan = loanById(valueFor(item, 'loanId'));
    if (!loan) {
      alert('Choose which loan this repays.');
      return;
    }

    // Re-read rather than trusting the row: a sync from another device may
    // have settled or removed the expense since the picker was built.
    const parent = transactions.find(t => t.id === loan.txId);
    if (!parent) {
      alert('That shared expense is no longer here. It is still in the queue.');
      return;
    }

    setBusy(true);
    try {
      const batch = toBatch(
        applyRepayment(parent, {
          personName: loan.personName,
          amount,
          account,
          date: valueFor(item, 'date'),
          currency: accounts.find(a => a.name === account)?.currency,
          note: valueFor(item, 'note')
        }),
        (id) => transactions.find(t => t.id === id)
      );
      if (!batch) {
        alert('Nothing is outstanding on that loan any more.');
        return;
      }
      await saveTransactionsBatch(batch.save, batch.remove);

      // The account mapping and the sender's name are worth keeping. The
      // category is not: "Loan" is a label applyRepayment wrote itself, and
      // the next payment from this sender need not be a repayment at all.
      await finishApproval(item, {
        account, payee: loan.personName, category: null
      });
    } catch (err) {
      console.error('Failed to record repayment from draft:', err);
      alert('Could not record this. It is still in the queue — try again.');
    } finally {
      setBusy(false);
    }
  }, [valueFor, loanById, transactions, accounts, saveTransactionsBatch, finishApproval]);

  const handleApprove = useCallback(async (item) => {
    // A repayment is not a transaction this form writes; it is an entry on an
    // existing shared expense, and everything below would double-count it.
    if (valueFor(item, 'type') === 1 && valueFor(item, 'isRepayment')) {
      return handleRecordRepayment(item);
    }

    // evalMath, not parseFloat: the field formats digit groups and accepts
    // arithmetic, and parseFloat("1,200") is 1.
    const amount = evalMath(valueFor(item, 'amount'));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid amount before adding this transaction.');
      return;
    }

    const type = valueFor(item, 'type');
    const account = valueFor(item, 'account');
    if (!account) {
      alert(type === 2
        ? 'Choose both accounts before adding this transfer.'
        : 'Choose which account this transaction belongs to.');
      return;
    }

    const isSplit = valueFor(item, 'isSplit') && type !== 2;
    const isExpenseShare = valueFor(item, 'isExpenseShare') && type !== 2;

    // Expense and transfer leave the source account; only income arrives.
    const dbAmt = type === 1 ? Math.abs(amount) : -Math.abs(amount);
    let finalCategory;
    let finalPayee;
    let transferTo = null;

    if (type === 2) {
      const to = valueFor(item, 'transferTo');
      if (!to) {
        alert('Choose both accounts before adding this transfer.');
        return;
      }
      if (to === account) {
        alert('A transfer needs two different accounts.');
        return;
      }
      // The shape the rest of the app expects of a transfer: negative amount
      // on the source account, the destination in transferTo, and the
      // generated payee label the reference rewriting keys off.
      finalCategory = 'Transfer';
      finalPayee = `Transfer to ${to}`;
      transferTo = to;
    } else {
      finalPayee = (valueFor(item, 'payee') || '').trim() || 'Unspecified';
      finalCategory = (valueFor(item, 'category') || '').trim() || 'Unspecified';
    }

    let finalSplits = [];
    if (isSplit) {
      const splits = valueFor(item, 'splits');
      const sum = splits.reduce((acc, s) => acc + Math.abs(evalMath(s.amount) || 0), 0);
      if (Math.abs(sum - Math.abs(dbAmt)) > 0.01) {
        alert('Split amounts must exactly equal the total amount.');
        return;
      }
      finalCategory = 'Split';
      finalPayee = 'Split';
      finalSplits = splits.map(s => {
        const sAmt = Math.abs(evalMath(s.amount) || 0);
        return {
          ...s,
          amount: type === 0 ? -sAmt : sAmt,
          category: s.category || 'Unspecified',
          payee: s.payee || 'Unspecified',
          account: s.account || account
        };
      });
    }

    let finalExpenseShares = [];
    if (isExpenseShare) {
      const shares = valueFor(item, 'expenseShares');
      const othersTotal = shares.reduce((acc, s) => acc + Math.abs(evalMath(s.amount) || 0), 0);
      if (othersTotal > Math.abs(dbAmt)) {
        alert("Others' shares cannot exceed the total amount.");
        return;
      }
      if (othersTotal <= 0) {
        alert("Please enter at least one person's share amount.");
        return;
      }
      finalExpenseShares = shares
        .filter(s => s.name.trim() && evalMath(s.amount))
        .map(s => ({
          id: s.id,
          name: s.name.trim(),
          amount: Math.abs(evalMath(s.amount) || 0),
          settled: false
        }));
    }

    setBusy(true);
    try {
      // A payee or category named here becomes a real one, exactly as it
      // would if it had been typed into the Add Transaction form. Split and
      // transfer labels are generated rather than chosen, so they are not.
      if (type !== 2 && !isSplit) {
        if (finalPayee !== 'Unspecified'
            && !payees.some(p => p.name.toLowerCase() === finalPayee.toLowerCase())) {
          await savePayee({ name: finalPayee, color: '#10b981' });
        }
        if (finalCategory !== 'Unspecified'
            && !categories.some(c => c.name.toLowerCase() === finalCategory.toLowerCase())) {
          await saveCategory({ name: finalCategory, color: '#6366f1' });
        }
      }

      const sourceAccount = accounts.find(a => a.name === account);

      await addTransaction({
        id: generateId(),
        type,
        amount: dbAmt,
        category: finalCategory,
        payee: finalPayee,
        note: valueFor(item, 'note'),
        date: dayToStoredDate(valueFor(item, 'date')),
        account,
        transferTo,
        currency: sourceAccount?.currency || valueFor(item, 'currency'),
        receivedAmount: null,
        isExpenseShare: isExpenseShare && finalExpenseShares.length > 0,
        expenseShares: finalExpenseShares.length > 0 ? finalExpenseShares : null,
        splits: finalSplits,
        repayments: [],
        writeOffs: [],
        updatedAt: new Date().toISOString(),
        pendingSync: true
      });

      // Only a real payee and category teach anything. "Split" and "Transfer
      // to X" are labels this form wrote itself, and learning them would point
      // the merchant at a name that means nothing next time.
      await finishApproval(item, type !== 2 && !isSplit
        ? { account, payee: finalPayee, category: finalCategory }
        : null);
    } catch (err) {
      console.error('Failed to add transaction from draft:', err);
      alert('Could not add this. It is still in the queue — try again.');
    } finally {
      setBusy(false);
    }
  }, [valueFor, accounts, payees, categories, savePayee, saveCategory, addTransaction,
      handleRecordRepayment, finishApproval]);

  const handleDismiss = useCallback(async (item) => {
    setBusy(true);
    try {
      await dropDrafts(item);
      setSelectedId(null);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [dropDrafts, onRefresh]);

  // The escape hatch for a wrong match: two unrelated transactions that
  // happened to be for the same amount at the same moment. Splitting them
  // back apart is better than dismissing, which would throw both away.
  const handleUnpair = useCallback((item) => {
    setRejectedPairs(current => new Set(current).add(item.id));
    setSelectedId(null);
  }, []);

  const handleTypeChange = useCallback((item, next) => {
    const current = valueFor(item, 'type');
    if (next === current) return;
    setTypeDirection(next > current ? 1 : -1);

    const patch = { type: next };
    // Only money arriving can repay a loan, so the tool goes with the tab.
    if (next !== 1) patch.isRepayment = false;
    if (next === 2) {
      // A transfer needs somewhere to land, and it cannot be where it started.
      const from = valueFor(item, 'account');
      const to = valueFor(item, 'transferTo');
      if (!to || to === from) {
        const other = accounts.find(a => a.name !== from);
        if (other) patch.transferTo = other.name;
      }
    }
    setFields(item.id, patch);
  }, [valueFor, setFields, accounts]);

  const toggleSplit = useCallback((item) => {
    if (valueFor(item, 'isSplit')) {
      setFields(item.id, { isSplit: false, splits: [], activeSplitIndex: 0 });
      return;
    }
    const account = valueFor(item, 'account');
    setFields(item.id, {
      isSplit: true,
      isExpenseShare: false,
      expenseShares: [],
      activePersonIndex: 0,
      activeSplitIndex: 0,
      isRepayment: false,
      splits: [blankSplit(account), blankSplit(account)]
    });
  }, [valueFor, setFields]);

  const toggleExpenseShare = useCallback((item) => {
    if (valueFor(item, 'isExpenseShare')) {
      setFields(item.id, { isExpenseShare: false, expenseShares: [], activePersonIndex: 0 });
      return;
    }
    setFields(item.id, {
      isExpenseShare: true,
      isSplit: false,
      splits: [],
      activeSplitIndex: 0,
      activePersonIndex: 0,
      isRepayment: false,
      expenseShares: [blankShare()]
    });
  }, [valueFor, setFields]);

  // The three tools are alternatives: a repayment has no category, payee,
  // split lines or people of its own — the expense it repays already has them.
  const toggleRepayment = useCallback((item) => {
    if (valueFor(item, 'isRepayment')) {
      setFields(item.id, { isRepayment: false });
      return;
    }
    // The parser's guess, if it still stands. Otherwise the most recent debt,
    // which is the one an unexplained payment is most often for.
    const suggested = valueFor(item, 'loanId');
    setFields(item.id, {
      isRepayment: true,
      isSplit: false,
      splits: [],
      activeSplitIndex: 0,
      isExpenseShare: false,
      expenseShares: [],
      activePersonIndex: 0,
      loanId: loanById(suggested) ? suggested : (loans[0]?.id || '')
    });
  }, [valueFor, setFields, loanById, loans]);

  const removeSplit = useCallback((item, splitId) => {
    const splits = valueFor(item, 'splits');
    if (splits.length > 2) {
      const next = splits.filter(s => s.id !== splitId);
      setFields(item.id, {
        splits: next,
        activeSplitIndex: Math.min(valueFor(item, 'activeSplitIndex'), next.length - 1)
      });
    } else {
      // Two is the fewest a split can have, so removing one ends the split.
      setFields(item.id, { isSplit: false, splits: [], activeSplitIndex: 0 });
    }
  }, [valueFor, setFields]);

  const removeShare = useCallback((item, shareId) => {
    const shares = valueFor(item, 'expenseShares');
    if (shares.length > 1) {
      const next = shares.filter(s => s.id !== shareId);
      setFields(item.id, {
        expenseShares: next,
        activePersonIndex: Math.min(valueFor(item, 'activePersonIndex'), next.length - 1)
      });
    } else {
      setFields(item.id, { isExpenseShare: false, expenseShares: [], activePersonIndex: 0 });
    }
  }, [valueFor, setFields]);

  const handleTouchStart = (e) => setTouchStart(e.targetTouches[0].clientX);

  const handleTouchEnd = (item) => (e) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;

    if (valueFor(item, 'isSplit')) {
      const splits = valueFor(item, 'splits');
      const index = valueFor(item, 'activeSplitIndex');
      if (diff > 50) setField(item.id, 'activeSplitIndex', Math.min(splits.length - 1, index + 1));
      else if (diff < -50) setField(item.id, 'activeSplitIndex', Math.max(0, index - 1));
    } else if (valueFor(item, 'isExpenseShare')) {
      const shares = valueFor(item, 'expenseShares');
      const index = valueFor(item, 'activePersonIndex');
      if (diff > 50) setField(item.id, 'activePersonIndex', Math.min(shares.length - 1, index + 1));
      else if (diff < -50) setField(item.id, 'activePersonIndex', Math.max(0, index - 1));
    }
    setTouchStart(null);
  };

  if (!isOpen) return null;

  const closeDetail = () => {
    setSelectedId(null);
    setActiveField(null);
    setActiveSplitId(null);
  };

  // The popover edits either a top-level field or one line of a split.
  const applyPopoverValue = (val) => {
    if (activeSplitId) {
      setField(selected.id, 'splits', valueFor(selected, 'splits')
        .map(s => (s.id === activeSplitId ? { ...s, [activeField]: val } : s)));
    } else if (activeField === 'payee') {
      setPayeeField(selected, val);
    } else {
      setField(selected.id, activeField, val);
    }
  };

  return (
    <ModalWrapper onClose={selected ? closeDetail : onClose} zIndex={2400}>
      <div
        className={`modal-content inbox-modal ${selected ? 'ib-detail-width' : ''}`}
        onClick={e => e.stopPropagation()}
      >
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
                  const isPair = item.kind === 'transfer';
                  const type = valueFor(item, 'type');
                  const isTransfer = type === 2;
                  const isIncome = type === 1;
                  const amount = Math.abs(evalMath(valueFor(item, 'amount')) || 0);
                  const symbol = getCurrencySymbol(valueFor(item, 'currency'));

                  const source = isPair ? (item.pair.debit || item.pair.credit) : item.draft;
                  const level = confidenceLabel(source.confidence || 0);

                  const title = isTransfer
                    ? 'Transfer'
                    : (valueFor(item, 'payee') || source.parsed?.merchant || 'Unknown payee');

                  const meta = isTransfer
                    ? `${valueFor(item, 'account') || 'Unknown'} → ${valueFor(item, 'transferTo') || 'Unknown'}`
                    : `${source.parsed?.bank || source.sender || 'Unknown sender'} • ${formatDayMonthYear(valueFor(item, 'date'))}`;

                  const sub = isPair
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
                        <span className={`ib-card-sub ${!isPair && !valueFor(item, 'account') ? 'needs-input' : ''}`}>
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
                const isPair = item.kind === 'transfer';
                const draft = isPair ? (item.pair.debit || item.pair.credit) : item.draft;
                const suggestion = suggestions[item.id] || {};

                const type = valueFor(item, 'type');
                const account = valueFor(item, 'account');
                const transferTo = valueFor(item, 'transferTo');
                const category = valueFor(item, 'category');
                const payee = valueFor(item, 'payee');
                const note = valueFor(item, 'note');
                const isSplit = valueFor(item, 'isSplit');
                const isExpenseShare = valueFor(item, 'isExpenseShare');
                const splits = valueFor(item, 'splits');
                const expenseShares = valueFor(item, 'expenseShares');
                const activeSplitIndex = valueFor(item, 'activeSplitIndex');
                const activePersonIndex = valueFor(item, 'activePersonIndex');
                const amountValue = String(valueFor(item, 'amount') ?? '');

                // The account's own currency wins over the one the message
                // named, as it does in the transaction form: a PKR card billed
                // for a USD purchase still posts to a PKR account.
                const sourceCurrency =
                  accounts.find(a => a.name === account)?.currency
                  || valueFor(item, 'currency') || 'PKR';

                // The amount field accepts arithmetic the same way the
                // transaction form does.
                const evalResult = evalMath(amountValue);
                const showPreview = /[+\-*/]/.test(amountValue) && evalResult !== null;

                const othersTotal = expenseShares.reduce(
                  (acc, s) => acc + Math.abs(evalMath(s.amount) || 0), 0);
                const splitTotal = splits.reduce(
                  (acc, s) => acc + (evalMath(s.amount) || 0), 0);

                // The loan this payment would be filed against, and what would
                // still be owed on it afterwards. Only money arriving can repay
                // one, so the tool follows the Income tab.
                const isRepayment = valueFor(item, 'isRepayment') && type === 1;
                const loan = isRepayment ? loanById(valueFor(item, 'loanId')) : null;
                const paidBack = Math.abs(evalResult || 0);
                const overRepaying = !!loan && paidBack > loan.pending + 0.005;
                const loanRemaining = loan ? Math.max(0, loan.pending - paidBack) : 0;

                // A shared expense's currency is its account's, as it is
                // everywhere else the two disagree.
                const loanSymbol = (l) => getCurrencySymbol(
                  accounts.find(a => a.name === l.account)?.currency || l.currency);

                const loanOptions = loans.map(l => ({
                  value: l.id,
                  label: `${l.personName} — ${l.expensePayee} · ${loanSymbol(l)}${formatCurrency(l.pending)}`
                }));

                const setSplitValue = (splitId, field, value) =>
                  setField(item.id, 'splits',
                    splits.map(s => (s.id === splitId ? { ...s, [field]: value } : s)));

                const setShareValue = (shareId, field, value) =>
                  setField(item.id, 'expenseShares',
                    expenseShares.map(s => (s.id === shareId ? { ...s, [field]: value } : s)));

                const CurrencyIcon = ({ size, className, style }) => (
                  <span
                    className={className}
                    style={{ ...style, fontSize: size, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {getCurrencySymbol(sourceCurrency)}
                  </span>
                );

                const openField = (field, splitId = null) => {
                  setActiveSplitId(splitId);
                  setActiveField(field);
                };

                const renderTapField = (label, value, Icon, field, compact = false) => (
                  <TapField
                    label={label}
                    value={value}
                    icon={Icon}
                    compact={compact}
                    onOpen={() => openField(field)}
                  />
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
                          {isPair
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
                      <div className="ib-type-selector" data-type={type}>
                        <button
                          type="button"
                          className={`ib-type-btn ${type === 0 ? 'expense-active' : ''}`}
                          onClick={() => handleTypeChange(item, 0)}
                        >Expense</button>
                        <button
                          type="button"
                          className={`ib-type-btn ${type === 1 ? 'income-active' : ''}`}
                          onClick={() => handleTypeChange(item, 1)}
                        >Income</button>
                        <button
                          type="button"
                          className={`ib-type-btn ${type === 2 ? 'transfer-active' : ''}`}
                          onClick={() => handleTypeChange(item, 2)}
                        >Transfer</button>
                      </div>

                      {isPair && type === 2 && (
                        <div className="ib-transfer-note">
                          <ArrowRightLeft size={14} />
                          <span>
                            {item.pair.oneSided
                              ? `Only one side of this was reported, and ${draft.parsed?.merchant || 'the counterparty'} is a name you marked as your own — so pick the account at the other end.`
                              : 'Two messages, same amount, moments apart — matched as one transfer so the movement is not counted twice.'}
                          </span>
                        </div>
                      )}

                      {!isPair && type !== 2 && !suggestion.directionKnown && (
                        <div className="ib-warning">
                          <AlertTriangle size={14} />
                          <span>
                            The message did not say whether this was money in or
                            out. Check the type above.
                          </span>
                        </div>
                      )}

                      {/* The math preview needs the left side under the amount
                          field to itself. Plain expense and income leave it
                          free — the Split/Share row keeps its controls hard
                          right — while transfer puts the From/To accounts
                          there and split or share puts the counter there.
                          Reserve the clearance in those three. */}
                      <div className={`ib-form-row ${showPreview && (type === 2 || isSplit || isExpenseShare) ? 'ib-reserves-math-preview' : ''}`}>
                        <div className="ib-form-group ib-flex-2 ib-relative">
                          {amountValue && <label>Amount ({sourceCurrency})</label>}
                          {isMobile ? (
                            <div onClick={() => openField('amount')} style={{ cursor: 'pointer' }}>
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

                      {type !== 2 && (
                        <div className={`ib-tools-row ${isSplit || isExpenseShare ? 'has-counter' : ''}`}>
                          <div className="ib-tools-left">
                            {isSplit && (
                              <>
                                <span className="ib-tools-counter">
                                  Split {activeSplitIndex + 1} of {splits.length}
                                </span>
                                <button
                                  type="button"
                                  className="ib-delete-split-btn"
                                  onClick={() => removeSplit(item, splits[activeSplitIndex]?.id)}
                                  aria-label="Remove this split"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                            {isExpenseShare && (
                              <>
                                <span className="ib-tools-counter">
                                  Person {activePersonIndex + 1} of {expenseShares.length}
                                </span>
                                <button
                                  type="button"
                                  className="ib-delete-split-btn"
                                  onClick={() => removeShare(item, expenseShares[activePersonIndex]?.id)}
                                  aria-label="Remove this person"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                          <div className="ib-tools-right">
                            {/* Offered only where it can mean something: money
                                arriving, with a debt still open somewhere. */}
                            {type === 1 && (isRepayment || loans.length > 0) && !isSplit && !isExpenseShare && (
                              <motion.button
                                type="button"
                                whileHover={!isMobile ? { scale: 1.05 } : {}}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => toggleRepayment(item)}
                                className={`ib-tool-btn ${isRepayment ? 'repay-on' : ''}`}
                              >
                                <HandCoins size={16} />
                                {isRepayment ? 'Not a Repayment' : 'Repayment'}
                              </motion.button>
                            )}
                            {!isExpenseShare && !isRepayment && (
                              <motion.button
                                type="button"
                                whileHover={!isMobile ? { scale: 1.05 } : {}}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => toggleSplit(item)}
                                className={`ib-tool-btn ${isSplit ? 'split-on' : ''}`}
                              >
                                <Split size={16} />
                                {isSplit ? 'Remove Split' : 'Split'}
                              </motion.button>
                            )}
                            {!isSplit && !isRepayment && (
                              <motion.button
                                type="button"
                                whileHover={!isMobile ? { scale: 1.05 } : {}}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => toggleExpenseShare(item)}
                                className={`ib-tool-btn ${isExpenseShare ? 'share-on' : ''}`}
                              >
                                <Users size={16} />
                                {isExpenseShare ? 'Remove Share' : 'Share'}
                              </motion.button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Account. A split carries one per line, so the single
                          picker steps aside for the carousel. */}
                      {(!isSplit || type === 2) && (
                        type === 2 ? (
                          <div className="ib-form-row ib-transfer-row">
                            <div className="ib-form-group ib-flex-1">
                              {isMobile ? (
                                renderTapField('From Account', account, Wallet, 'account', true)
                              ) : (
                                <>
                                  {account && <label>From Account</label>}
                                  <UnifiedDropdown
                                    value={account}
                                    options={withCurrentValue(accounts, account)}
                                    onChange={v => setField(item.id, 'account', v)}
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
                                renderTapField('Transfer To', transferTo, ArrowRightLeft, 'transferTo', true)
                              ) : (
                                <>
                                  {transferTo && <label>Transfer To</label>}
                                  <UnifiedDropdown
                                    value={transferTo}
                                    options={withCurrentValue(accounts, transferTo)}
                                    onChange={v => setField(item.id, 'transferTo', v)}
                                    placeholder="To account"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          isMobile ? (
                            renderTapField('Account', account, Wallet, 'account')
                          ) : (
                            <div className="ib-form-group">
                              {account && <label>Account</label>}
                              <UnifiedDropdown
                                value={account}
                                options={withCurrentValue(accounts, account)}
                                onChange={v => setField(item.id, 'account', v)}
                                placeholder="Choose account"
                              />
                            </div>
                          )
                        )
                      )}

                      <motion.div
                        className="ib-dynamic-wrapper"
                        animate={{
                          height: ((isSplit || isExpenseShare || isRepayment) && type !== 2)
                            ? 'auto'
                            : (type === 2 ? 0 : (isMobile ? 122 : 116)),
                          marginTop: type === 2 ? -16 : -10
                        }}
                        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                        style={{ position: 'relative', overflow: 'visible' }}
                      >
                        <AnimatePresence initial={false} custom={typeDirection} mode="popLayout">
                          {type === 2 ? (
                            // A transfer needs nothing here: its two accounts
                            // are above, and it has no category or payee of
                            // its own. The pane still exists so the tabs slide
                            // rather than cut.
                            <motion.div
                              key="transfer"
                              custom={typeDirection}
                              variants={slideVariants}
                              initial="enter"
                              animate="center"
                              exit="exit"
                              transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
                              className="ib-dynamic-content"
                              style={{ width: '100%' }}
                            />
                          ) : (
                            <motion.div
                              key="regular"
                              custom={typeDirection}
                              variants={slideVariants}
                              initial="enter"
                              animate="center"
                              exit="exit"
                              transition={{ type: 'tween', ease: 'easeInOut', duration: 0.25 }}
                              className="ib-dynamic-content"
                              style={{ width: '100%' }}
                            >
                              <AnimatePresence mode="popLayout" initial={false}>
                                {isSplit ? (
                                  <motion.div
                                    key="split-ui"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.25, ease: 'easeOut' }}
                                    style={{ display: 'flex', flexDirection: 'column', width: '100%' }}
                                  >
                                    <div
                                      className="ib-carousel-viewport"
                                      onTouchStart={handleTouchStart}
                                      onTouchEnd={handleTouchEnd(item)}
                                    >
                                      <div
                                        className="ib-carousel-track"
                                        style={{ transform: `translateX(-${activeSplitIndex * 100}%)` }}
                                      >
                                        {splits.map((s, index) => (
                                          <div key={s.id} className="ib-carousel-card">
                                            <div className={isMobile ? 'ib-carousel-body' : 'ib-carousel-body ib-carousel-panel'}>
                                              {!isMobile && (
                                                <div className="ib-carousel-panel-head">
                                                  <span className="ib-tools-counter">Split {index + 1} of {splits.length}</span>
                                                  <button
                                                    type="button"
                                                    className="ib-delete-split-btn"
                                                    onClick={() => removeSplit(item, s.id)}
                                                    aria-label="Remove this split"
                                                  >
                                                    <Trash2 size={16} />
                                                  </button>
                                                </div>
                                              )}

                                              <div className="ib-form-group" style={{ marginBottom: '12px' }}>
                                                <div className="input-with-icon">
                                                  <CurrencyIcon size={16} className="input-icon" />
                                                  <input
                                                    type="text"
                                                    placeholder="Split Amount"
                                                    value={s.amount}
                                                    onChange={e => setSplitValue(s.id, 'amount', formatAmountInput(e.target.value))}
                                                  />
                                                </div>
                                              </div>

                                              {isMobile ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                  <TapField label="Account" value={s.account} icon={Wallet} compact onOpen={() => openField('account', s.id)} />
                                                  <TapField label="Category" value={s.category} icon={Tag} compact onOpen={() => openField('category', s.id)} />
                                                  <TapField label="Payee" value={s.payee} icon={User} compact onOpen={() => openField('payee', s.id)} />
                                                </div>
                                              ) : (
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                  <div className="ib-form-group" style={{ flex: '1 1 30%' }}>
                                                    <UnifiedDropdown value={s.account} placeholder="Account" options={withCurrentValue(accounts, s.account)} onChange={v => setSplitValue(s.id, 'account', v)} />
                                                  </div>
                                                  <div className="ib-form-group" style={{ flex: '1 1 30%' }}>
                                                    <UnifiedDropdown value={s.category} placeholder="Category" options={withCurrentValue(categories, s.category)} onChange={v => setSplitValue(s.id, 'category', v)} />
                                                  </div>
                                                  <div className="ib-form-group" style={{ flex: '1 1 30%' }}>
                                                    <UnifiedDropdown value={s.payee} placeholder="Payee" options={withCurrentValue(payees, s.payee)} onChange={v => setSplitValue(s.id, 'payee', v)} />
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="ib-carousel-pagination">
                                      <button
                                        type="button"
                                        onClick={() => setField(item.id, 'activeSplitIndex', Math.max(0, activeSplitIndex - 1))}
                                        disabled={activeSplitIndex === 0}
                                        className="ib-pagination-btn"
                                        aria-label="Previous split"
                                      >
                                        <ChevronLeft size={20} />
                                      </button>

                                      <div className="ib-carousel-dots">
                                        {splits.map((s, i) => (
                                          <div
                                            key={s.id}
                                            className={`ib-carousel-dot ${i === activeSplitIndex ? 'active' : ''}`}
                                            onClick={() => setField(item.id, 'activeSplitIndex', i)}
                                          />
                                        ))}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setField(item.id, 'activeSplitIndex', Math.min(splits.length - 1, activeSplitIndex + 1))}
                                        disabled={activeSplitIndex === splits.length - 1}
                                        className="ib-pagination-btn"
                                        aria-label="Next split"
                                      >
                                        <ChevronRight size={20} />
                                      </button>

                                      <motion.button
                                        type="button"
                                        whileHover={!isMobile ? { scale: 1.05 } : {}}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => setFields(item.id, {
                                          splits: [...splits, blankSplit(account)],
                                          activeSplitIndex: splits.length
                                        })}
                                        className="ib-add-carousel-btn"
                                        style={{ marginLeft: 'auto' }}
                                      >
                                        <Plus size={16} /> Add Split
                                      </motion.button>
                                    </div>
                                  </motion.div>
                                ) : isExpenseShare ? (
                                  <motion.div
                                    key="expense-share-ui"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.25, ease: 'easeOut' }}
                                    style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}
                                  >
                                    {/* Category and payee describe the whole
                                        expense, so they stay put while the
                                        people scroll past. */}
                                    {isMobile ? (
                                      <>
                                        {renderTapField('Category', category, Tag, 'category')}
                                        {renderTapField('Payee', payee, User, 'payee')}
                                      </>
                                    ) : (
                                      <>
                                        <div className="ib-form-group">
                                          {category && <label>Category</label>}
                                          <div className="input-with-icon" onClick={() => openField('category')}>
                                            <Tag size={18} className="input-icon" />
                                            <input type="text" placeholder="Category" value={category} readOnly style={{ cursor: 'pointer' }} />
                                          </div>
                                        </div>
                                        <div className="ib-form-group">
                                          {payee && <label>Payee</label>}
                                          <div className="input-with-icon" onClick={() => openField('payee')}>
                                            <User size={18} className="input-icon" />
                                            <input type="text" placeholder="Payee" value={payee} readOnly style={{ cursor: 'pointer' }} />
                                          </div>
                                        </div>
                                      </>
                                    )}

                                    <div className="ib-your-share">
                                      <div className="ib-your-share-label">
                                        <User size={16} />
                                        <span>Your Share</span>
                                      </div>
                                      <span className="ib-your-share-value">
                                        {getCurrencySymbol(sourceCurrency)}
                                        {formatCurrency(Math.max(0, Math.abs(evalResult || 0) - othersTotal))}
                                      </span>
                                    </div>

                                    <div
                                      className="ib-carousel-viewport"
                                      onTouchStart={handleTouchStart}
                                      onTouchEnd={handleTouchEnd(item)}
                                    >
                                      <div
                                        className="ib-carousel-track"
                                        style={{ transform: `translateX(-${activePersonIndex * 100}%)` }}
                                      >
                                        {expenseShares.map((share, index) => (
                                          <div key={share.id} className="ib-carousel-card">
                                            <div className={isMobile ? 'ib-carousel-body' : 'ib-carousel-body ib-carousel-panel'}>
                                              {!isMobile && (
                                                <div className="ib-carousel-panel-head">
                                                  <span className="ib-tools-counter">Person {index + 1} of {expenseShares.length}</span>
                                                  <button
                                                    type="button"
                                                    className="ib-delete-split-btn"
                                                    onClick={() => removeShare(item, share.id)}
                                                    aria-label="Remove this person"
                                                  >
                                                    <Trash2 size={16} />
                                                  </button>
                                                </div>
                                              )}

                                              <div className="ib-form-group" style={{ marginBottom: '10px' }}>
                                                {share.name && <label>Person's Name</label>}
                                                <div className="input-with-icon">
                                                  <User size={16} className="input-icon" />
                                                  <input
                                                    type="text"
                                                    placeholder="Person's name"
                                                    value={share.name}
                                                    onChange={e => setShareValue(share.id, 'name', e.target.value)}
                                                  />
                                                </div>
                                              </div>

                                              <div className="ib-form-group">
                                                {share.amount && <label>Owed Amount</label>}
                                                <div className="input-with-icon">
                                                  <CurrencyIcon size={16} className="input-icon" />
                                                  <input
                                                    type="text"
                                                    placeholder="Owed Amount"
                                                    value={share.amount}
                                                    onChange={e => setShareValue(share.id, 'amount', formatAmountInput(e.target.value))}
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="ib-carousel-pagination">
                                      <button
                                        type="button"
                                        onClick={() => setField(item.id, 'activePersonIndex', Math.max(0, activePersonIndex - 1))}
                                        disabled={activePersonIndex === 0}
                                        className="ib-pagination-btn"
                                        aria-label="Previous person"
                                      >
                                        <ChevronLeft size={20} />
                                      </button>

                                      <div className="ib-carousel-dots">
                                        {expenseShares.map((s, i) => (
                                          <div
                                            key={s.id}
                                            className={`ib-carousel-dot ${i === activePersonIndex ? 'active' : ''}`}
                                            onClick={() => setField(item.id, 'activePersonIndex', i)}
                                          />
                                        ))}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setField(item.id, 'activePersonIndex', Math.min(expenseShares.length - 1, activePersonIndex + 1))}
                                        disabled={activePersonIndex === expenseShares.length - 1}
                                        className="ib-pagination-btn"
                                        aria-label="Next person"
                                      >
                                        <ChevronRight size={20} />
                                      </button>

                                      <motion.button
                                        type="button"
                                        whileHover={!isMobile ? { scale: 1.05 } : {}}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => setFields(item.id, {
                                          expenseShares: [...expenseShares, blankShare()],
                                          activePersonIndex: expenseShares.length
                                        })}
                                        className="ib-add-carousel-btn ib-share-accent"
                                        style={{ marginLeft: 'auto' }}
                                      >
                                        <Plus size={16} /> Add Person
                                      </motion.button>
                                    </div>
                                  </motion.div>
                                ) : isRepayment ? (
                                  <motion.div
                                    key="repayment-ui"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.25, ease: 'easeOut' }}
                                    style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}
                                  >
                                    {/* No category or payee: the repayment
                                        takes both from the expense it settles,
                                        exactly as one recorded by hand does. */}
                                    <div className="ib-form-group">
                                      {loan && <label>Repaying</label>}
                                      <UnifiedDropdown
                                        value={valueFor(item, 'loanId')}
                                        options={loanOptions}
                                        onChange={v => setField(item.id, 'loanId', v)}
                                        placeholder="Choose a loan"
                                      />
                                    </div>

                                    {loan ? (
                                      <div className="ib-loan-summary">
                                        <div className="ib-loan-row">
                                          <span className="ib-loan-person">
                                            <HandCoins size={15} />
                                            {loan.personName} owes
                                          </span>
                                          <span className="ib-loan-pending">
                                            {loanSymbol(loan)}{formatCurrency(loan.pending)}
                                          </span>
                                        </div>
                                        <div className="ib-loan-row ib-loan-sub">
                                          <span>{loan.expensePayee}</span>
                                          <span>{formatDayMonthYear(dayStringOf(loan.date))}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="ib-warning">
                                        <AlertTriangle size={14} />
                                        <span>
                                          Nothing is outstanding on that loan any
                                          more. Pick another, or turn Repayment
                                          off to add this as income.
                                        </span>
                                      </div>
                                    )}
                                  </motion.div>
                                ) : (
                                  <motion.div
                                    key="regular-ui"
                                    initial={{ opacity: 0, y: -20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 20 }}
                                    transition={{ duration: 0.25, ease: 'easeOut' }}
                                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                                  >
                                    {isMobile ? (
                                      <>
                                        {renderTapField('Category', category, Tag, 'category')}
                                        {renderTapField('Payee', payee, User, 'payee')}
                                      </>
                                    ) : (
                                      <>
                                        <div className="ib-form-group">
                                          {category && <label>Category</label>}
                                          <div className="input-with-icon" onClick={() => openField('category')}>
                                            <Tag size={18} className="input-icon" />
                                            <input type="text" placeholder="Category" value={category} readOnly style={{ cursor: 'pointer' }} />
                                          </div>
                                        </div>
                                        <div className="ib-form-group">
                                          {payee && <label>Payee</label>}
                                          <div className="input-with-icon" onClick={() => openField('payee')}>
                                            <User size={18} className="input-icon" />
                                            <input type="text" placeholder="Payee" value={payee} readOnly style={{ cursor: 'pointer' }} />
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>

                      {/* The merchant hint belongs to the payee, but the payee
                          field moves between three layouts. It sits under the
                          block instead, where it reads the same in all of
                          them. */}
                      {type !== 2 && !isSplit && !isRepayment && (() => {
                        const merchant = draft.parsed?.merchant;
                        if (!merchant || !looksLikeIdentifier(merchant)) return null;
                        const chosen = (payee || '').trim();
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

                      <div className="ib-form-group">
                        {note && <label>Note (Optional)</label>}
                        {isMobile ? (
                          <div onClick={() => openField('note')} style={{ cursor: 'pointer' }}>
                            <div className="input-with-icon" style={{ pointerEvents: 'none' }}>
                              <AlignLeft size={18} className="input-icon" />
                              <input type="text" placeholder="Note (Optional)" value={note} readOnly />
                            </div>
                          </div>
                        ) : (
                          <div className="input-with-icon">
                            <AlignLeft size={18} className="input-icon" />
                            <input
                              type="text"
                              placeholder="Note (Optional)"
                              value={note}
                              onChange={e => setField(item.id, 'note', e.target.value)}
                            />
                          </div>
                        )}
                      </div>

                      {((isSplit || isExpenseShare || isRepayment) && type !== 2) && (
                        <div className="ib-status-banner">
                          {isSplit && (() => {
                            const rem = (evalResult || 0) - splitTotal;
                            if (Math.abs(rem) < 0.01) return <span style={{ color: '#10b981', fontWeight: 600 }}>Split balanced ✓</span>;
                            return <span style={{ fontWeight: 600, color: rem < 0 ? '#ef4444' : 'var(--text-secondary)' }}>Remaining: {formatCurrency(rem)}</span>;
                          })()}
                          {isExpenseShare && (() => {
                            const total = Math.abs(evalResult || 0);
                            if (othersTotal > total) return <span style={{ color: '#ef4444', fontWeight: 600 }}>Others exceed total!</span>;
                            if (othersTotal <= 0) return <span style={{ fontWeight: 600 }}>Enter shares</span>;
                            return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Others owe: {getCurrencySymbol(sourceCurrency)}{formatCurrency(othersTotal)}</span>;
                          })()}
                          {isRepayment && (() => {
                            if (!loan) return <span style={{ fontWeight: 600 }}>Choose a loan</span>;
                            if (overRepaying) return <span style={{ color: '#ef4444', fontWeight: 600 }}>More than {loan.personName} owes!</span>;
                            if (paidBack <= 0) return <span style={{ fontWeight: 600 }}>Enter an amount</span>;
                            if (loanRemaining < 0.005) return <span style={{ color: '#10b981', fontWeight: 600 }}>Settles {loan.personName} in full ✓</span>;
                            return (
                              <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                                {loan.personName} will still owe {loanSymbol(loan)}{formatCurrency(loanRemaining)}
                              </span>
                            );
                          })()}
                        </div>
                      )}

                      <button
                        type="button"
                        className="ib-raw-toggle"
                        onClick={() => setShowRaw(v => !v)}
                      >
                        <span>{isPair && item.pair.debit && item.pair.credit
                          ? 'Both original messages' : 'Original message'}</span>
                        {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {showRaw && (
                        isPair ? (
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

                      {isPair && (
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
                          disabled={
                            busy
                            || (isSplit && type !== 2 && Math.abs((evalResult || 0) - splitTotal) > 0.01)
                            || (isExpenseShare && type !== 2 && othersTotal > Math.abs(evalResult || 0))
                            || (isRepayment && (!loan || overRepaying || paidBack <= 0))
                          }
                        >
                          <Check size={16} />
                          {busy
                            ? (isRepayment ? 'Recording...' : 'Adding...')
                            : isRepayment ? 'Record repayment'
                              : type === 2 ? 'Add transfer' : 'Add transaction'}
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
            initialValue={
              activeSplitId
                ? (valueFor(selected, 'splits')
                    .find(s => s.id === activeSplitId)?.[activeField] || '')
                : valueFor(selected, activeField)
            }
            onSelect={(val) => {
              applyPopoverValue(val);
              setActiveField(null);
              setActiveSplitId(null);
            }}
            onSaveValue={applyPopoverValue}
            onAdd={async (val) => {
              // Creating from here works exactly as it does in the transaction
              // form: the payee or category becomes a real one immediately.
              if (activeField === 'category') {
                await saveCategory({ name: val, color: '#6366f1' });
              } else if (activeField === 'payee') {
                await savePayee({ name: val, color: '#10b981' });
              }
              applyPopoverValue(val);
              setActiveField(null);
              setActiveSplitId(null);
            }}
            onClose={() => { setActiveField(null); setActiveSplitId(null); }}
          />
        )}
      </div>
    </ModalWrapper>
  );
}
