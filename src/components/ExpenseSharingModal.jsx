import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Users, Plus, Trash2, Calendar, Check, AlertTriangle, User, Edit2 } from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedDropdown from './UnifiedDropdown';
import UnifiedCalendar from './UnifiedCalendar';
import { useData } from '../context/DataContext';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { formatAmountInput } from '../utils/format';
import { generateId } from '../store/db';
import { format, parseISO } from 'date-fns';
import './ExpenseSharingModal.css';

function evalMath(input) {
  try {
    const clean = String(input).replace(/,/g, '');
    if (!/^[0-9+\-*/. ()]+$/.test(clean)) return null;
    const result = new Function(`return ${clean}`)();
    return isNaN(result) || !isFinite(result) ? null : result;
  } catch (e) {
    return null;
  }
}

export default function ExpenseSharingModal({ isOpen, onClose }) {
  const { transactions, updateTransaction, addTransaction, deleteTransaction, categories, payees, accounts } = useData();
  
  const [activeTab, setActiveTab] = useState('unsettled'); // 'unsettled' | 'settled'
  const [expandedTxId, setExpandedTxId] = useState(null);
  const [addingRepaymentFor, setAddingRepaymentFor] = useState(null); // txId
  const [editingRepayment, setEditingRepayment] = useState(null); // { txId, repaymentId }
  const [writingOffFor, setWritingOffFor] = useState(null); // { txId, shareId }
  
  // Repayment form state
  const [repayPerson, setRepayPerson] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayAccount, setRepayAccount] = useState('');
  const [repayDate, setRepayDate] = useState(new Date().toISOString().substring(0, 10));
  const [showRepayCalendar, setShowRepayCalendar] = useState(false);
  
  // Edit Repayment form state
  const [editPerson, setEditPerson] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editAccount, setEditAccount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [showEditCalendar, setShowEditCalendar] = useState(false);

  // Write-off form state
  const [writeOffAmount, setWriteOffAmount] = useState('');
  const [writeOffCategory, setWriteOffCategory] = useState('');
  const [writeOffPayee, setWriteOffPayee] = useState('');

  // Get all expense sharing transactions
  const allSharedExpenses = useMemo(() => {
    return transactions
      .filter(tx => tx.isExpenseShare && tx.expenseShares && tx.expenseShares.length > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [transactions]);

  const unsettledExpenses = useMemo(() => {
    return allSharedExpenses.filter(tx => !tx.expenseShares.every(s => s.settled));
  }, [allSharedExpenses]);

  const settledExpenses = useMemo(() => {
    return allSharedExpenses.filter(tx => tx.expenseShares.every(s => s.settled));
  }, [allSharedExpenses]);

  const displayedExpenses = activeTab === 'unsettled' ? unsettledExpenses : settledExpenses;

  if (!isOpen) return null;

  const getRepayments = (tx) => tx.repayments || [];
  const getWriteOffs = (tx) => tx.writeOffs || [];

  const getPersonRepaid = (tx, personName) => {
    return getRepayments(tx)
      .filter(r => r.personName === personName)
      .reduce((acc, r) => acc + (r.amount || 0), 0);
  };

  const getPersonWrittenOff = (tx, personName) => {
    return getWriteOffs(tx)
      .filter(w => w.personName === personName)
      .reduce((acc, w) => acc + (w.amount || 0), 0);
  };

  const getPersonPending = (tx, personName) => {
    const share = tx.expenseShares.find(s => s.name === personName);
    if (!share) return 0;
    const totalCovered = getPersonRepaid(tx, personName) + getPersonWrittenOff(tx, personName);
    return Math.max(0, share.amount - totalCovered);
  };

  const getTotalPending = (tx) => {
    return tx.expenseShares.reduce((acc, share) => {
      if (share.settled) return acc;
      return acc + getPersonPending(tx, share.name);
    }, 0);
  };

  const handleAddRepayment = async (tx) => {
    const amount = evalMath(repayAmount);
    if (!repayPerson || !amount || amount <= 0) return;

    const accountToUse = repayAccount || tx.account || (accounts[0]?.name || '');
    const dateFormatted = repayDate.substring(0, 10);

    // Check if an existing repayment for SAME person, SAME account, SAME date exists -> AUTO MERGE!
    const existingIndex = (tx.repayments || []).findIndex(
      r => r.personName === repayPerson && 
           (r.account || tx.account) === accountToUse && 
           (r.date ? r.date.substring(0, 10) : '') === dateFormatted
    );

    let updatedRepayments = [];
    if (existingIndex !== -1) {
      const existing = tx.repayments[existingIndex];
      const mergedAmount = existing.amount + amount;
      const updatedRecord = {
        ...existing,
        amount: mergedAmount
      };
      
      updatedRepayments = [...tx.repayments];
      updatedRepayments[existingIndex] = updatedRecord;

      if (existing.linkedTxId) {
        const linkedTx = transactions.find(t => t.id === existing.linkedTxId);
        if (linkedTx) {
          await updateTransaction({
            ...linkedTx,
            amount: mergedAmount,
            updatedAt: new Date().toISOString(),
            pendingSync: true
          });
        }
      }
    } else {
      const linkedTxId = generateId();
      const newIncomeTx = {
        id: linkedTxId,
        type: 1, // Income
        amount: amount,
        category: 'Loan',
        payee: repayPerson,
        note: `Repayment for shared expense (${tx.payee || 'Expense Share'})`,
        date: new Date(repayDate).toISOString(),
        account: accountToUse,
        currency: accounts.find(a => a.name === accountToUse)?.currency || tx.currency,
        parentExpenseShareTxId: tx.id,
        isRepayment: true,
        updatedAt: new Date().toISOString(),
        pendingSync: true
      };

      await addTransaction(newIncomeTx);

      const newRepayment = {
        id: generateId(),
        personName: repayPerson,
        amount: amount,
        date: dateFormatted,
        account: accountToUse,
        linkedTxId: linkedTxId
      };

      updatedRepayments = [...(tx.repayments || []), newRepayment];
    }
    
    // Check settled status
    const updatedShares = tx.expenseShares.map(s => {
      const repaid = updatedRepayments
        .filter(r => r.personName === s.name)
        .reduce((acc, r) => acc + r.amount, 0);
      const writtenOff = getPersonWrittenOff(tx, s.name);
      return { ...s, settled: (repaid + writtenOff) >= s.amount };
    });

    await updateTransaction({
      ...tx,
      repayments: updatedRepayments,
      expenseShares: updatedShares,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    });

    // Reset form
    setRepayPerson('');
    setRepayAmount('');
    setRepayAccount('');
    setRepayDate(new Date().toISOString().substring(0, 10));
    setAddingRepaymentFor(null);
  };

  const handleStartEditRepayment = (tx, rep) => {
    setEditingRepayment({ txId: tx.id, repaymentId: rep.id });
    setEditPerson(rep.personName);
    setEditAmount(rep.amount.toString());
    setEditAccount(rep.account || tx.account || (accounts[0]?.name || ''));
    setEditDate(rep.date ? rep.date.substring(0, 10) : new Date().toISOString().substring(0, 10));
  };

  const handleSaveEditRepayment = async (tx, rep) => {
    const amount = evalMath(editAmount);
    if (!editPerson || !amount || amount <= 0) return;

    const accountToUse = editAccount || tx.account || (accounts[0]?.name || '');
    const dateFormatted = editDate.substring(0, 10);

    const updatedRepayments = (tx.repayments || []).map(r => {
      if (r.id === rep.id) {
        return {
          ...r,
          personName: editPerson,
          amount: amount,
          account: accountToUse,
          date: dateFormatted
        };
      }
      return r;
    });

    if (rep.linkedTxId) {
      const linkedTx = transactions.find(t => t.id === rep.linkedTxId);
      if (linkedTx) {
        await updateTransaction({
          ...linkedTx,
          amount: amount,
          payee: editPerson,
          account: accountToUse,
          date: new Date(editDate).toISOString(),
          currency: accounts.find(a => a.name === accountToUse)?.currency || tx.currency,
          updatedAt: new Date().toISOString(),
          pendingSync: true
        });
      }
    }

    const updatedShares = tx.expenseShares.map(s => {
      const repaid = updatedRepayments
        .filter(r => r.personName === s.name)
        .reduce((acc, r) => acc + r.amount, 0);
      const writtenOff = getPersonWrittenOff(tx, s.name);
      return { ...s, settled: (repaid + writtenOff) >= s.amount };
    });

    await updateTransaction({
      ...tx,
      repayments: updatedRepayments,
      expenseShares: updatedShares,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    });

    setEditingRepayment(null);
  };

  const handleDeleteRepayment = async (tx, repaymentRecord) => {
    if (repaymentRecord.linkedTxId) {
      await deleteTransaction(repaymentRecord.linkedTxId);
    }

    const updatedRepayments = (tx.repayments || []).filter(r => r.id !== repaymentRecord.id);
    
    const updatedShares = tx.expenseShares.map(s => {
      const repaid = updatedRepayments
        .filter(r => r.personName === s.name)
        .reduce((acc, r) => acc + r.amount, 0);
      const writtenOff = getPersonWrittenOff(tx, s.name);
      return { ...s, settled: (repaid + writtenOff) >= s.amount };
    });

    await updateTransaction({
      ...tx,
      repayments: updatedRepayments,
      expenseShares: updatedShares,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    });
  };

  const handleStartWriteOff = (tx, share) => {
    const pending = getPersonPending(tx, share.name);
    setWritingOffFor({ txId: tx.id, shareId: share.id });
    setWriteOffAmount(pending.toString());
    setWriteOffCategory(categories[0]?.name || 'Bad Debt');
    setWriteOffPayee(share.name);
  };

  const handleConfirmWriteOff = async (tx, shareId) => {
    const share = tx.expenseShares.find(s => s.id === shareId);
    if (!share) return;
    
    const amount = evalMath(writeOffAmount);
    if (!amount || amount <= 0) return;

    const writeOffTxId = generateId();
    const writeOffTx = {
      id: writeOffTxId,
      type: tx.type,
      amount: tx.type === 0 ? -amount : amount,
      category: writeOffCategory || 'Bad Debt',
      payee: writeOffPayee || share.name,
      note: `Written off from shared expense (${tx.payee || 'Shared Expense'})`,
      date: tx.date,
      account: tx.account,
      currency: tx.currency,
      parentExpenseShareTxId: tx.id,
      isWriteOff: true,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    };

    const newWriteOffRecord = {
      id: generateId(),
      shareId: shareId,
      personName: share.name,
      amount: amount,
      category: writeOffCategory || 'Bad Debt',
      payee: writeOffPayee || share.name,
      linkedTxId: writeOffTxId,
      date: tx.date
    };

    const updatedWriteOffs = [...(tx.writeOffs || []), newWriteOffRecord];

    // Reduce original transaction amount by write-off amount
    const signedChange = tx.amount < 0 ? amount : -amount;
    const newTxAmount = tx.amount + signedChange;

    // Reduce person's share amount on original transaction by write-off amount
    const updatedShares = tx.expenseShares.map(s => {
      if (s.id === shareId) {
        const newShareAmount = Math.max(0, s.amount - amount);
        const repaid = getPersonRepaid(tx, s.name);
        return {
          ...s,
          amount: newShareAmount,
          settled: newShareAmount === 0 || repaid >= newShareAmount
        };
      }
      const repaid = getPersonRepaid(tx, s.name);
      const writtenOff = updatedWriteOffs
        .filter(w => w.personName === s.name)
        .reduce((acc, w) => acc + w.amount, 0);
      return { ...s, settled: (repaid + writtenOff) >= s.amount };
    });

    await updateTransaction({
      ...tx,
      amount: newTxAmount,
      writeOffs: updatedWriteOffs,
      expenseShares: updatedShares,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    });

    await addTransaction(writeOffTx);

    setWritingOffFor(null);
    setWriteOffAmount('');
    setWriteOffCategory('');
    setWriteOffPayee('');
  };

  const handleDeleteWriteOff = async (tx, writeOffRecord) => {
    if (writeOffRecord.linkedTxId) {
      await deleteTransaction(writeOffRecord.linkedTxId);
    }

    const updatedWriteOffs = (tx.writeOffs || []).filter(w => w.id !== writeOffRecord.id);

    // Restore written-off amount back to original transaction amount
    const signedChange = tx.amount < 0 ? writeOffRecord.amount : -writeOffRecord.amount;
    const restoredTxAmount = tx.amount - signedChange;

    // Restore person's share amount on original transaction
    const updatedShares = tx.expenseShares.map(s => {
      if (s.id === writeOffRecord.shareId || s.name === writeOffRecord.personName) {
        const restoredShareAmount = s.amount + writeOffRecord.amount;
        const repaid = getPersonRepaid(tx, s.name);
        const remainingWriteOffs = updatedWriteOffs
          .filter(w => w.personName === s.name)
          .reduce((acc, w) => acc + w.amount, 0);
        return {
          ...s,
          amount: restoredShareAmount,
          settled: (repaid + remainingWriteOffs) >= restoredShareAmount
        };
      }
      const repaid = getPersonRepaid(tx, s.name);
      const writtenOff = updatedWriteOffs
        .filter(w => w.personName === s.name)
        .reduce((acc, w) => acc + w.amount, 0);
      return { ...s, settled: (repaid + writtenOff) >= s.amount };
    });

    await updateTransaction({
      ...tx,
      amount: restoredTxAmount,
      writeOffs: updatedWriteOffs,
      expenseShares: updatedShares,
      pendingSync: true,
      updatedAt: new Date().toISOString()
    });
  };

  const formatDateShort = (isoString) => {
    if (!isoString) return '';
    try {
      return format(parseISO(isoString), 'dd/MM/yy');
    } catch {
      return isoString.substring(0, 10);
    }
  };

  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content expense-sharing-modal glass-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Users size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />Shared Expenses</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={24} /></button>
        </div>

        {/* Tab Selector */}
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
              <Users size={48} style={{ opacity: 0.3 }} />
              <p>No {activeTab} shared expenses</p>
              <span>{activeTab === 'unsettled' ? 'All your shared expenses are fully paid back!' : 'Settled shared expenses will appear here.'}</span>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {displayedExpenses.map(tx => {
                const isExpanded = expandedTxId === tx.id;
                const totalPending = getTotalPending(tx);
                const totalOwed = tx.expenseShares.reduce((acc, s) => acc + s.amount, 0);
                const currency = getCurrencySymbol(accounts?.find(a => a.name === tx.account)?.currency || tx.currency);
                const allSettled = tx.expenseShares.every(s => s.settled);
                const txWriteOffs = getWriteOffs(tx);

                return (
                  <motion.div 
                    key={tx.id}
                    layout
                    className={`es-card glass-panel ${isExpanded ? 'expanded' : ''}`}
                  >
                    {/* Card Header */}
                    <div 
                      className="es-card-header"
                      onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                    >
                      <div className="es-card-left">
                        <div className="es-card-icon" style={{ background: allSettled ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)' }}>
                          {allSettled ? <Check size={18} style={{ color: '#10b981' }} /> : <Users size={18} style={{ color: '#f59e0b' }} />}
                        </div>
                        <div className="es-card-info">
                          <div className="es-card-payee">{tx.payee}</div>
                          <div className="es-card-meta">
                            <span className="es-card-category">{tx.category}</span>
                            <span className="es-dot">•</span>
                            <span className="es-card-date">{formatDateShort(tx.date)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="es-card-right">
                        <div className="es-card-amounts">
                          <span className="es-card-total">{currency}{formatCurrency(Math.abs(tx.amount))}</span>
                          {totalPending > 0 ? (
                            <span className="es-card-pending">{currency}{formatCurrency(totalPending)} pending</span>
                          ) : (
                            <span className="es-card-settled">All settled ✓</span>
                          )}
                        </div>
                        <motion.div
                          animate={{ rotate: isExpanded ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
                        </motion.div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="es-expanded"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        >
                          <div className="es-expanded-inner">
                            {/* People breakdown */}
                            <div className="es-section-title">People Breakdown</div>
                            <div className="es-people">
                              {/* Your share */}
                              <div className="es-person-row yours">
                                <div className="es-person-info">
                                  <User size={14} style={{ color: '#10b981' }} />
                                  <span className="es-person-name">You</span>
                                </div>
                                <span className="es-person-amount" style={{ color: '#10b981' }}>
                                  {currency}{formatCurrency(Math.abs(tx.amount) - totalOwed)}
                                </span>
                              </div>

                              {tx.expenseShares.map(share => {
                                const pending = getPersonPending(tx, share.name);
                                const repaid = getPersonRepaid(tx, share.name);
                                const writtenOff = getPersonWrittenOff(tx, share.name);
                                const isWritingOff = writingOffFor?.txId === tx.id && writingOffFor?.shareId === share.id;

                                return (
                                  <div key={share.id} className={`es-person-row ${share.settled ? 'settled' : ''}`}>
                                    <div className="es-person-info">
                                      <User size={14} style={{ color: share.settled ? '#10b981' : '#f59e0b' }} />
                                      <span className="es-person-name">{share.name}</span>
                                      {share.settled && <span className="es-badge settled-badge">{writtenOff > 0 && repaid === 0 ? 'Written Off' : 'Settled'}</span>}
                                    </div>
                                    <div className="es-person-amounts">
                                      <span className="es-person-owed">Owes: {currency}{formatCurrency(share.amount)}</span>
                                      {repaid > 0 && <span className="es-person-repaid">Paid: {currency}{formatCurrency(repaid)}</span>}
                                      {writtenOff > 0 && <span className="es-person-writtenoff">Written Off: {currency}{formatCurrency(writtenOff)}</span>}
                                      {pending > 0 && (
                                        <div className="es-person-actions">
                                          <span className="es-person-pending">Pending: {currency}{formatCurrency(pending)}</span>
                                          <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            className="es-writeoff-btn"
                                            onClick={() => handleStartWriteOff(tx, share)}
                                          >
                                            <AlertTriangle size={12} /> Write Off
                                          </motion.button>
                                        </div>
                                      )}
                                    </div>

                                    {/* Write-off form */}
                                    <AnimatePresence>
                                      {isWritingOff && (
                                        <motion.div
                                          className="es-writeoff-form"
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          transition={{ duration: 0.2 }}
                                        >
                                          <div className="es-writeoff-inner">
                                            <span className="es-writeoff-label">Write Off Expense</span>
                                            
                                            {/* Row 1: Amount */}
                                            <div className="es-form-row">
                                              <div style={{ flex: 1 }}>
                                                <label className="es-input-label">Amount</label>
                                                <div className="input-with-icon" style={{ height: '40px' }}>
                                                  <span className="input-icon" style={{ fontSize: '14px', fontWeight: 500 }}>{currency}</span>
                                                  <input 
                                                    type="text" 
                                                    placeholder="Amount to write off" 
                                                    value={writeOffAmount}
                                                    onChange={(e) => setWriteOffAmount(formatAmountInput(e.target.value))}
                                                    style={{ fontSize: '14px', height: '40px' }}
                                                  />
                                                </div>
                                              </div>
                                            </div>

                                            {/* Row 2: Category & Payee */}
                                            <div className="es-form-row">
                                              <div style={{ flex: 1 }}>
                                                <label className="es-input-label">Category</label>
                                                <UnifiedDropdown
                                                  value={writeOffCategory}
                                                  placeholder="Category"
                                                  options={categories.map(c => ({ value: c.name, label: c.name }))}
                                                  onChange={setWriteOffCategory}
                                                />
                                              </div>
                                              <div style={{ flex: 1 }}>
                                                <label className="es-input-label">Payee</label>
                                                <UnifiedDropdown
                                                  value={writeOffPayee}
                                                  placeholder="Payee"
                                                  options={payees.map(p => ({ value: p.name, label: p.name }))}
                                                  onChange={setWriteOffPayee}
                                                />
                                              </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                                              <button className="es-btn-cancel" onClick={() => setWritingOffFor(null)}>Cancel</button>
                                              <motion.button 
                                                whileTap={{ scale: 0.95 }}
                                                className="es-btn-confirm"
                                                onClick={() => handleConfirmWriteOff(tx, share.id)}
                                              >
                                                Confirm Write-Off
                                              </motion.button>
                                            </div>
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Repayment History */}
                            {getRepayments(tx).length > 0 && (
                              <>
                                <div className="es-section-title">Repayment History</div>
                                <div className="es-repayments">
                                  {getRepayments(tx).map(rep => {
                                    const isEditingThis = editingRepayment?.txId === tx.id && editingRepayment?.repaymentId === rep.id;

                                    if (isEditingThis) {
                                      return (
                                        <motion.div
                                          key={rep.id}
                                          className="es-add-repayment-form"
                                          initial={{ opacity: 0 }}
                                          animate={{ opacity: 1 }}
                                        >
                                          <div className="es-section-title" style={{ marginTop: 0 }}>Edit Repayment</div>
                                          
                                          {/* Row 1: Person & Amount */}
                                          <div className="es-form-row">
                                            <div style={{ flex: 1 }}>
                                              <label className="es-input-label">Person</label>
                                              <UnifiedDropdown
                                                value={editPerson}
                                                placeholder="Person"
                                                options={tx.expenseShares.map(s => ({ value: s.name, label: s.name }))}
                                                onChange={setEditPerson}
                                              />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                              <label className="es-input-label">Amount</label>
                                              <div className="input-with-icon" style={{ height: '40px' }}>
                                                <span className="input-icon" style={{ fontSize: '14px', fontWeight: 500 }}>{currency}</span>
                                                <input 
                                                  type="text" 
                                                  placeholder="Amount" 
                                                  value={editAmount}
                                                  onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                                                  style={{ fontSize: '14px', height: '40px' }}
                                                />
                                              </div>
                                            </div>
                                          </div>

                                          {/* Row 2: Account & Date */}
                                          <div className="es-form-row">
                                            <div style={{ flex: 1 }}>
                                              <label className="es-input-label">Account</label>
                                              <UnifiedDropdown
                                                value={editAccount}
                                                placeholder="Account"
                                                options={accounts.map(a => ({ value: a.name, label: a.name }))}
                                                onChange={setEditAccount}
                                              />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                              <label className="es-input-label">Date</label>
                                              <div 
                                                className="input-with-icon" 
                                                onClick={() => setShowEditCalendar(true)} 
                                                style={{ cursor: 'pointer', height: '40px' }}
                                              >
                                                <Calendar size={14} className="input-icon" />
                                                <input 
                                                  type="text" 
                                                  value={formatDateShort(editDate)} 
                                                  readOnly 
                                                  style={{ cursor: 'pointer', fontSize: '13px', height: '40px', paddingLeft: '28px' }} 
                                                />
                                              </div>
                                            </div>
                                          </div>

                                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                                            <button className="es-btn-cancel" onClick={() => setEditingRepayment(null)}>Cancel</button>
                                            <motion.button 
                                              whileTap={{ scale: 0.95 }}
                                              className="es-btn-confirm"
                                              onClick={() => handleSaveEditRepayment(tx, rep)}
                                            >
                                              Save Repayment
                                            </motion.button>
                                          </div>
                                        </motion.div>
                                      );
                                    }

                                    return (
                                      <div key={rep.id} className="es-repayment-row">
                                        <div className="es-repayment-info">
                                          <span className="es-repayment-name">{rep.personName}</span>
                                          <span className="es-repayment-date">{formatDateShort(rep.date)}</span>
                                          {rep.account && (
                                            <span className="es-repayment-account">({rep.account})</span>
                                          )}
                                        </div>
                                        <div className="es-repayment-right">
                                          <span className="es-repayment-amount">+{currency}{formatCurrency(rep.amount)}</span>
                                          <button 
                                            className="es-repayment-edit"
                                            onClick={() => handleStartEditRepayment(tx, rep)}
                                            title="Edit Repayment"
                                          >
                                            <Edit2 size={13} />
                                          </button>
                                          <button 
                                            className="es-repayment-delete"
                                            onClick={() => handleDeleteRepayment(tx, rep)}
                                            title="Delete Repayment"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}

                            {/* Write-Off History */}
                            {txWriteOffs.length > 0 && (
                              <>
                                <div className="es-section-title">Write-Off History</div>
                                <div className="es-repayments">
                                  {txWriteOffs.map(wo => (
                                    <div key={wo.id} className="es-repayment-row writeoff-history-row">
                                      <div className="es-repayment-info">
                                        <span className="es-repayment-name" style={{ color: '#ef4444' }}>{wo.personName}</span>
                                        <span className="es-repayment-date">({wo.category})</span>
                                      </div>
                                      <div className="es-repayment-right">
                                        <span className="es-repayment-amount" style={{ color: '#ef4444' }}>-{currency}{formatCurrency(wo.amount)}</span>
                                        <button 
                                          className="es-repayment-delete"
                                          onClick={() => handleDeleteWriteOff(tx, wo)}
                                          title="Delete Write-Off (Re-open Share)"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}

                            {/* Add Repayment */}
                            {!allSettled && (
                              <>
                                {addingRepaymentFor === tx.id ? (
                                  <motion.div
                                    className="es-add-repayment-form"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                  >
                                    <div className="es-section-title" style={{ marginTop: 0 }}>Add Repayment (Incoming Loan)</div>
                                    
                                    {/* Row 1: Person & Amount */}
                                    <div className="es-form-row">
                                      <div style={{ flex: 1 }}>
                                        <label className="es-input-label">Person</label>
                                        <UnifiedDropdown
                                          value={repayPerson}
                                          placeholder="Person"
                                          options={tx.expenseShares
                                            .filter(s => !s.settled)
                                            .map(s => ({ value: s.name, label: s.name }))}
                                          onChange={(val) => {
                                            setRepayPerson(val);
                                            const pending = getPersonPending(tx, val);
                                            setRepayAmount(pending.toString());
                                          }}
                                        />
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <label className="es-input-label">Amount</label>
                                        <div className="input-with-icon" style={{ height: '40px' }}>
                                          <span className="input-icon" style={{ fontSize: '14px', fontWeight: 500 }}>{currency}</span>
                                          <input 
                                            type="text" 
                                            placeholder="Amount" 
                                            value={repayAmount}
                                            onChange={(e) => setRepayAmount(formatAmountInput(e.target.value))}
                                            style={{ fontSize: '14px', height: '40px' }}
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Row 2: Account & Date */}
                                    <div className="es-form-row">
                                      <div style={{ flex: 1 }}>
                                        <label className="es-input-label">Account</label>
                                        <UnifiedDropdown
                                          value={repayAccount}
                                          placeholder="Account"
                                          options={accounts.map(a => ({ value: a.name, label: a.name }))}
                                          onChange={setRepayAccount}
                                        />
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <label className="es-input-label">Date</label>
                                        <div 
                                          className="input-with-icon" 
                                          onClick={() => setShowRepayCalendar(true)} 
                                          style={{ cursor: 'pointer', height: '40px' }}
                                        >
                                          <Calendar size={14} className="input-icon" />
                                          <input 
                                            type="text" 
                                            value={formatDateShort(repayDate)} 
                                            readOnly 
                                            style={{ cursor: 'pointer', fontSize: '13px', height: '40px', paddingLeft: '28px' }} 
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                                      <button className="es-btn-cancel" onClick={() => setAddingRepaymentFor(null)}>Cancel</button>
                                      <motion.button 
                                        whileTap={{ scale: 0.95 }}
                                        className="es-btn-confirm"
                                        onClick={() => handleAddRepayment(tx)}
                                      >
                                        Add Repayment
                                      </motion.button>
                                    </div>
                                  </motion.div>
                                ) : (
                                  <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    className="es-add-repayment-btn"
                                    onClick={() => {
                                      setAddingRepaymentFor(tx.id);
                                      setRepayAccount(tx.account || (accounts[0]?.name || ''));
                                      setRepayDate(tx.date ? tx.date.substring(0, 10) : new Date().toISOString().substring(0, 10));
                                      const unsettled = tx.expenseShares.filter(s => !s.settled);
                                      if (unsettled.length === 1) {
                                        setRepayPerson(unsettled[0].name);
                                        const pending = getPersonPending(tx, unsettled[0].name);
                                        setRepayAmount(pending > 0 ? pending.toString() : '');
                                      } else {
                                        setRepayPerson('');
                                        setRepayAmount('');
                                      }
                                    }}
                                  >
                                    <Plus size={16} /> Add Repayment
                                  </motion.button>
                                )}
                              </>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        <AnimatePresence>
          {showRepayCalendar && (
            <UnifiedCalendar 
              value={repayDate} 
              onChange={setRepayDate} 
              onClose={() => setShowRepayCalendar(false)} 
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showEditCalendar && (
            <UnifiedCalendar 
              value={editDate} 
              onChange={setEditDate} 
              onClose={() => setShowEditCalendar(false)} 
            />
          )}
        </AnimatePresence>
      </div>
    </ModalWrapper>
  );
}
