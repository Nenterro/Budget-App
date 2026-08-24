import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ArrowLeft, Users, Plus, Trash2, Calendar, Check, AlertTriangle, User, Edit2 } from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import UnifiedCalendar from './UnifiedCalendar';
import { useData } from '../context/DataContext';
import { formatCurrency, getCurrencySymbol, formatAmountInput } from '../utils/format';
import { evalMath } from '../utils/math';
import {
  sharePending, personPending, personRepaid, personWrittenOff, totalPending,
  applyWriteOff, editWriteOff, removeWriteOff,
  applyRepayment, editRepayment, removeRepayment,
  maxWriteOff, maxRepayment
} from '../utils/expenseShares';
import { format, parseISO } from 'date-fns';
import './ExpenseSharingModal.css';

const today = () => new Date().toISOString().substring(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

const formatDateShort = (value) => {
  if (!value) return '';
  try {
    return format(parseISO(value), 'dd/MM/yy');
  } catch {
    return String(value).substring(0, 10);
  }
};

// A dropdown whose value is not among its options renders as its placeholder,
// which made prefilled forms ("Bad Debt", the person's own name) look empty.
const withCurrentValue = (items, current) => {
  const options = items.map(i => ({ value: i.name, label: i.name }));
  if (current && !options.some(o => o.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
};

const EMPTY_FORM = { person: '', amount: '', account: '', date: '', category: '', payee: '' };

export default function ExpenseSharingModal({ isOpen, onClose }) {
  const { transactions, saveTransactionsBatch, categories, payees, accounts } = useData();

  const [activeTab, setActiveTab] = useState('unsettled');
  const [selectedTxId, setSelectedTxId] = useState(null);

  // One drawer, one form. There used to be three near-identical drawers with
  // their own state, which is how they drifted apart — different validation,
  // different field sets, and no edit path for write-offs at all.
  const [drawer, setDrawer] = useState(null); // { kind, shareId?, recordId? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [showCalendar, setShowCalendar] = useState(false);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const closeDrawer = () => { setDrawer(null); setForm(EMPTY_FORM); setShowCalendar(false); };

  const allSharedExpenses = useMemo(() => (
    transactions
      .filter(tx => tx.isExpenseShare && tx.expenseShares && tx.expenseShares.length > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  ), [transactions]);

  const unsettledExpenses = useMemo(
    () => allSharedExpenses.filter(tx => totalPending(tx) > 0), [allSharedExpenses]);
  const settledExpenses = useMemo(
    () => allSharedExpenses.filter(tx => totalPending(tx) <= 0), [allSharedExpenses]);

  const displayedExpenses = activeTab === 'unsettled' ? unsettledExpenses : settledExpenses;
  const selectedTx = useMemo(
    () => transactions.find(t => t.id === selectedTxId), [transactions, selectedTxId]);

  if (!isOpen) return null;

  const currencyFor = (tx) =>
    getCurrencySymbol(accounts?.find(a => a.name === tx.account)?.currency || tx.currency);

  // ─── Opening the drawer ──────────────────────────────────────────────────

  const openRepayment = (tx) => {
    const firstOwing = tx.expenseShares.find(s => sharePending(tx, s) > 0);
    setDrawer({ kind: 'repay' });
    setForm({
      ...EMPTY_FORM,
      person: firstOwing ? firstOwing.name : '',
      amount: firstOwing ? String(round2(sharePending(tx, firstOwing))) : '',
      account: tx.account || accounts[0]?.name || '',
      date: today()
    });
  };

  const openEditRepayment = (tx, rep) => {
    setDrawer({ kind: 'repay-edit', recordId: rep.id });
    setForm({
      ...EMPTY_FORM,
      person: rep.personName,
      amount: formatAmountInput(String(rep.amount)),
      account: rep.account || tx.account || accounts[0]?.name || '',
      date: (rep.date || today()).substring(0, 10)
    });
  };

  const openWriteOff = (tx, share) => {
    setDrawer({ kind: 'writeoff', shareId: share.id });
    setForm({
      ...EMPTY_FORM,
      amount: String(round2(sharePending(tx, share))),
      category: 'Bad Debt',
      payee: share.name,
      date: (tx.date || today()).substring(0, 10)
    });
  };

  const openEditWriteOff = (tx, wo) => {
    setDrawer({ kind: 'writeoff-edit', recordId: wo.id, shareId: wo.shareId });
    setForm({
      ...EMPTY_FORM,
      amount: formatAmountInput(String(wo.amount)),
      category: wo.category || 'Bad Debt',
      payee: wo.payee || wo.personName,
      date: (wo.date || tx.date || today()).substring(0, 10)
    });
  };

  // ─── Committing ──────────────────────────────────────────────────────────

  const commit = async (result) => {
    if (!result) return;
    const toSave = [result.parentTx];
    const toDelete = result.deleteIds || [];

    if (result.childTx) {
      if (result.childTx.create) {
        toSave.push(result.childTx.create);
      } else if (result.childTx.mergeInto) {
        const linked = transactions.find(t => t.id === result.childTx.mergeInto);
        if (linked) {
          toSave.push({ ...linked, amount: result.childTx.amount, pendingSync: true, updatedAt: new Date().toISOString() });
        }
      } else {
        toSave.push(result.childTx);
      }
    }

    await saveTransactionsBatch(toSave, toDelete);
    closeDrawer();
  };

  const linkedTxFor = (record) =>
    record?.linkedTxId ? transactions.find(t => t.id === record.linkedTxId) : null;

  const handleConfirm = async (tx) => {
    const amount = evalMath(form.amount);
    if (!drawer) return;

    if (drawer.kind === 'repay') {
      await commit(applyRepayment(tx, {
        personName: form.person,
        amount,
        account: form.account,
        date: form.date,
        currency: accounts.find(a => a.name === form.account)?.currency
      }));
    } else if (drawer.kind === 'repay-edit') {
      const rep = (tx.repayments || []).find(r => r.id === drawer.recordId);
      await commit(editRepayment(tx, drawer.recordId, {
        personName: form.person,
        amount,
        account: form.account,
        date: form.date,
        currency: accounts.find(a => a.name === form.account)?.currency
      }, linkedTxFor(rep)));
    } else if (drawer.kind === 'writeoff') {
      await commit(applyWriteOff(tx, drawer.shareId, {
        amount,
        category: form.category,
        payee: form.payee,
        date: form.date
      }));
    } else if (drawer.kind === 'writeoff-edit') {
      const wo = (tx.writeOffs || []).find(w => w.id === drawer.recordId);
      await commit(editWriteOff(tx, drawer.recordId, {
        amount,
        category: form.category,
        payee: form.payee,
        date: form.date
      }, linkedTxFor(wo)));
    }
  };

  const handleDeleteRepayment = (tx, rep) => commit(removeRepayment(tx, rep.id));
  const handleDeleteWriteOff = (tx, wo) => commit(removeWriteOff(tx, wo.id));

  // ─── Drawer configuration ────────────────────────────────────────────────
  //
  // Everything the single drawer needs to render and validate itself, derived
  // from which kind is open. Keeping it in one place is what stops the four
  // flows drifting apart again.
  const drawerConfig = (tx) => {
    if (!drawer || !tx) return null;
    const amount = evalMath(form.amount);
    const isRepay = drawer.kind === 'repay' || drawer.kind === 'repay-edit';

    let ceiling;
    let subject;
    if (isRepay) {
      const record = drawer.kind === 'repay-edit'
        ? (tx.repayments || []).find(r => r.id === drawer.recordId)
        : null;
      // Only this record's own amount frees up headroom, and only while it is
      // still assigned to the same person.
      const existing = record && record.personName === form.person ? record : null;
      ceiling = form.person ? maxRepayment(tx, form.person, existing) : 0;
      subject = form.person;
    } else {
      const existing = drawer.kind === 'writeoff-edit'
        ? (tx.writeOffs || []).find(w => w.id === drawer.recordId)
        : null;
      const share = (tx.expenseShares || []).find(s => s.id === (existing?.shareId || drawer.shareId))
        || (tx.expenseShares || []).find(s => s.name === existing?.personName);
      ceiling = share ? maxWriteOff(tx, share, existing) : 0;
      subject = share?.name;
    }

    let error = null;
    if (isRepay && !form.person) error = 'Choose who paid you back.';
    else if (amount === null || amount <= 0) error = 'Enter an amount greater than zero.';
    else if (amount > ceiling + 0.005) {
      error = isRepay
        ? `That is more than ${subject} still owes (${currencyFor(tx)}${formatCurrency(ceiling)}).`
        : `Only ${currencyFor(tx)}${formatCurrency(ceiling)} is outstanding for ${subject}.`;
    }

    const titles = {
      repay: 'Record repayment',
      'repay-edit': 'Edit repayment',
      writeoff: `Write off ${subject || ''}'s share`.trim(),
      'writeoff-edit': `Edit write-off${subject ? ` for ${subject}` : ''}`
    };

    const confirmLabels = {
      repay: 'Record repayment',
      'repay-edit': 'Save changes',
      writeoff: 'Write it off',
      'writeoff-edit': 'Save changes'
    };

    return { isRepay, ceiling, error, title: titles[drawer.kind], confirmLabel: confirmLabels[drawer.kind] };
  };

  const config = drawerConfig(selectedTx);

  return (
    <ModalWrapper onClose={drawer ? closeDrawer : onClose}>
      <div className="expense-sharing-modal glass-panel" onClick={e => e.stopPropagation()}>
        <AnimatePresence mode="wait">
          {!selectedTxId || !selectedTx ? (
            <motion.div
              key="main-list"
              className="es-view-container"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="es-header">
                <h2><Users size={18} /> Shared expenses</h2>
                <button className="es-icon-btn" onClick={onClose} type="button" aria-label="Close">
                  <X size={20} />
                </button>
              </div>

              <div className="es-tabs">
                <button
                  type="button"
                  className={`es-tab ${activeTab === 'unsettled' ? 'active' : ''}`}
                  onClick={() => setActiveTab('unsettled')}
                >
                  Unsettled <span className="es-tab-count">{unsettledExpenses.length}</span>
                </button>
                <button
                  type="button"
                  className={`es-tab ${activeTab === 'settled' ? 'active' : ''}`}
                  onClick={() => setActiveTab('settled')}
                >
                  Settled <span className="es-tab-count">{settledExpenses.length}</span>
                </button>
              </div>

              <div className="es-list">
                {displayedExpenses.length === 0 ? (
                  <div className="es-empty">
                    <Users size={44} style={{ opacity: 0.3 }} />
                    <p>Nothing {activeTab} yet</p>
                    <span>
                      {activeTab === 'unsettled'
                        ? 'Every shared expense has been paid back or written off.'
                        : 'Shared expenses become settled once nothing is outstanding.'}
                    </span>
                  </div>
                ) : displayedExpenses.map(tx => {
                  const pending = totalPending(tx);
                  const currency = currencyFor(tx);
                  return (
                    <button
                      key={tx.id}
                      type="button"
                      className="es-card"
                      onClick={() => { setSelectedTxId(tx.id); closeDrawer(); }}
                    >
                      <div className="es-card-icon" style={{ background: pending > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)' }}>
                        {pending > 0
                          ? <Users size={16} style={{ color: '#f59e0b' }} />
                          : <Check size={16} style={{ color: '#10b981' }} />}
                      </div>
                      <div className="es-card-info">
                        <span className="es-card-payee">{tx.payee}</span>
                        <span className="es-card-meta">{tx.category} • {formatDateShort(tx.date)}</span>
                      </div>
                      <div className="es-card-amounts">
                        <span className="es-card-total">{currency}{formatCurrency(Math.abs(tx.amount))}</span>
                        <span className={pending > 0 ? 'es-card-pending' : 'es-card-settled'}>
                          {pending > 0 ? `${currency}${formatCurrency(pending)} owed` : 'Settled'}
                        </span>
                      </div>
                      <ChevronRight size={16} className="es-card-chevron" />
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="detail-view"
              className="es-view-container"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {(() => {
                const tx = selectedTx;
                const currency = currencyFor(tx);
                const pending = totalPending(tx);
                const totalOwed = tx.expenseShares.reduce((acc, s) => acc + s.amount, 0);
                const writeOffs = tx.writeOffs || [];
                const repayments = tx.repayments || [];

                return (
                  <>
                    {/* Back is the only navigation here — the close button that
                        used to sit beside it did the same job as tapping the
                        backdrop and just competed with the back arrow. */}
                    <div className="es-header">
                      <button className="es-icon-btn" onClick={() => setSelectedTxId(null)} type="button" aria-label="Back to list">
                        <ArrowLeft size={20} />
                      </button>
                      <div className="es-header-titles">
                        <h2>{tx.payee}</h2>
                        <span>{tx.category} • {formatDateShort(tx.date)}</span>
                      </div>
                    </div>

                    <div className="es-detail-body">
                      <div className="es-overview-card">
                        <div className="es-overview-item">
                          <span className="es-overview-label">Total</span>
                          <span className="es-overview-value">{currency}{formatCurrency(Math.abs(tx.amount))}</span>
                        </div>
                        <div className="es-overview-item">
                          <span className="es-overview-label">Your share</span>
                          <span className="es-overview-value" style={{ color: '#10b981' }}>
                            {currency}{formatCurrency(Math.abs(tx.amount) - totalOwed)}
                          </span>
                        </div>
                        <div className="es-overview-item">
                          <span className="es-overview-label">Outstanding</span>
                          <span className="es-overview-value" style={{ color: pending > 0 ? '#f59e0b' : '#10b981' }}>
                            {pending > 0 ? `${currency}${formatCurrency(pending)}` : 'None'}
                          </span>
                        </div>
                      </div>

                      <div className="es-section-title">Who owes what</div>
                      <div className="es-people">
                        <div className="es-person-row yours">
                          <div className="es-person-info">
                            <User size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                            <span className="es-person-name">You</span>
                          </div>
                          <span className="es-person-owed" style={{ color: '#10b981' }}>
                            {currency}{formatCurrency(Math.abs(tx.amount) - totalOwed)}
                          </span>
                        </div>

                        {tx.expenseShares.map(share => {
                          const owed = sharePending(tx, share);
                          const repaid = personRepaid(tx, share.name);
                          const written = personWrittenOff(tx, share.name);
                          const settled = owed <= 0;

                          return (
                            <div key={share.id} className={`es-person-row ${settled ? 'settled' : ''}`}>
                              <div className="es-person-info">
                                <User size={14} style={{ color: settled ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                                <span className="es-person-name">{share.name}</span>
                                {settled && (
                                  <span className="es-badge settled-badge">
                                    {written > 0 && repaid === 0 ? 'Written off' : 'Settled'}
                                  </span>
                                )}
                              </div>
                              <div className="es-person-amounts">
                                {owed > 0 ? (
                                  <>
                                    <span className="es-person-pending">{currency}{formatCurrency(owed)}</span>
                                    <button
                                      type="button"
                                      className="es-writeoff-btn"
                                      onClick={() => openWriteOff(tx, share)}
                                    >
                                      <AlertTriangle size={12} /> Write off
                                    </button>
                                  </>
                                ) : (
                                  <span className="es-person-owed">
                                    {written > 0
                                      ? `${currency}${formatCurrency(written)} written off`
                                      : `${currency}${formatCurrency(repaid)} paid`}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {repayments.length > 0 && (
                        <>
                          <div className="es-section-title">Repayments</div>
                          <div className="es-records">
                            {repayments.map(rep => (
                              <div key={rep.id} className="es-record-row">
                                <div className="es-record-info">
                                  <span className="es-record-name">{rep.personName}</span>
                                  <span className="es-record-meta">
                                    {formatDateShort(rep.date)}{rep.account ? ` • ${rep.account}` : ''}
                                  </span>
                                </div>
                                <span className="es-record-amount positive">
                                  +{currency}{formatCurrency(rep.amount)}
                                </span>
                                <div className="es-record-actions">
                                  <button type="button" className="es-icon-btn small" onClick={() => openEditRepayment(tx, rep)} aria-label={`Edit repayment from ${rep.personName}`}>
                                    <Edit2 size={14} />
                                  </button>
                                  <button type="button" className="es-icon-btn small danger" onClick={() => handleDeleteRepayment(tx, rep)} aria-label={`Delete repayment from ${rep.personName}`}>
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {writeOffs.length > 0 && (
                        <>
                          <div className="es-section-title">Write-offs</div>
                          <div className="es-records">
                            {writeOffs.map(wo => (
                              <div key={wo.id} className="es-record-row writeoff">
                                <div className="es-record-info">
                                  <span className="es-record-name">{wo.personName}</span>
                                  <span className="es-record-meta">
                                    {formatDateShort(wo.date || tx.date)}{wo.category ? ` • ${wo.category}` : ''}
                                  </span>
                                </div>
                                <span className="es-record-amount negative">
                                  −{currency}{formatCurrency(wo.amount)}
                                </span>
                                {/* Write-offs could only be deleted and
                                    re-created before, which meant redoing the
                                    category and payee every time. */}
                                <div className="es-record-actions">
                                  <button type="button" className="es-icon-btn small" onClick={() => openEditWriteOff(tx, wo)} aria-label={`Edit write-off for ${wo.personName}`}>
                                    <Edit2 size={14} />
                                  </button>
                                  <button type="button" className="es-icon-btn small danger" onClick={() => handleDeleteWriteOff(tx, wo)} aria-label={`Delete write-off for ${wo.personName}`}>
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {pending > 0 && (
                      <div className="es-detail-bottom-bar">
                        <button type="button" className="es-primary-btn" onClick={() => openRepayment(tx)}>
                          <Plus size={17} /> Record repayment
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rendered at modal level, outside the scrolling body, so the sheet is
            always anchored to the modal rather than to whatever row opened it. */}
        <AnimatePresence>
          {drawer && selectedTx && config && (
            <motion.div
              className="es-drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDrawer}
            >
              <motion.div
                className="es-drawer"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                onClick={e => e.stopPropagation()}
              >
                <div className="es-drawer-grip" />
                <h4 className="es-drawer-title">{config.title}</h4>

                <div className="es-form-grid">
                  {config.isRepay && (
                    <div className="es-field">
                      <label className="es-input-label">Person</label>
                      <UnifiedDropdown
                        value={form.person}
                        placeholder="Who paid you back"
                        options={withCurrentValue(
                          selectedTx.expenseShares.filter(
                            s => sharePending(selectedTx, s) > 0 || s.name === form.person
                          ),
                          form.person
                        )}
                        onChange={(value) => {
                          setField('person', value);
                          const owed = personPending(selectedTx, value);
                          if (drawer.kind === 'repay') setField('amount', String(round2(owed)));
                        }}
                      />
                    </div>
                  )}

                  <div className="es-field">
                    <label className="es-input-label">
                      Amount
                      {config.ceiling > 0 && (
                        <span className="es-input-hint">
                          max {currencyFor(selectedTx)}{formatCurrency(config.ceiling)}
                        </span>
                      )}
                    </label>
                    <div className="input-with-icon es-input">
                      <span className="input-icon es-currency">{currencyFor(selectedTx)}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={form.amount}
                        onChange={(e) => setField('amount', formatAmountInput(e.target.value))}
                      />
                    </div>
                  </div>

                  {!config.isRepay && (
                    <>
                      <div className="es-field">
                        <label className="es-input-label">Category</label>
                        <UnifiedDropdown
                          value={form.category}
                          placeholder="Category"
                          options={withCurrentValue(categories, form.category)}
                          onChange={(value) => setField('category', value)}
                        />
                      </div>
                      <div className="es-field">
                        <label className="es-input-label">Payee</label>
                        <UnifiedDropdown
                          value={form.payee}
                          placeholder="Payee"
                          options={withCurrentValue(payees, form.payee)}
                          onChange={(value) => setField('payee', value)}
                        />
                      </div>
                    </>
                  )}

                  {config.isRepay && (
                    <div className="es-field">
                      <label className="es-input-label">Account</label>
                      <UnifiedDropdown
                        value={form.account}
                        placeholder="Account"
                        options={accounts.map(a => ({ value: a.name, label: a.name }))}
                        onChange={(value) => setField('account', value)}
                      />
                    </div>
                  )}

                  <div className="es-field">
                    <label className="es-input-label">Date</label>
                    <div className="input-with-icon es-input" onClick={() => setShowCalendar(true)} style={{ cursor: 'pointer' }}>
                      <Calendar size={15} className="input-icon" />
                      <input type="text" value={formatDateShort(form.date)} readOnly style={{ cursor: 'pointer' }} />
                    </div>
                  </div>
                </div>

                {/* The confirm button used to sit there looking enabled and
                    silently do nothing when the form was invalid. */}
                {config.error && <div className="es-drawer-error">{config.error}</div>}

                <div className="es-drawer-actions">
                  <button type="button" className="es-btn-cancel" onClick={closeDrawer}>Cancel</button>
                  <button
                    type="button"
                    className="es-btn-confirm"
                    disabled={!!config.error}
                    onClick={() => handleConfirm(selectedTx)}
                  >
                    {config.confirmLabel}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCalendar && (
            <UnifiedCalendar
              value={form.date}
              onChange={(value) => setField('date', value)}
              onClose={() => setShowCalendar(false)}
              zIndex={2500}
            />
          )}
        </AnimatePresence>
      </div>
    </ModalWrapper>
  );
}
