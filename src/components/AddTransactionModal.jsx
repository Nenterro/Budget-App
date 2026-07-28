import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useData } from '../context/DataContext';
import { X, Calendar, DollarSign, Tag, User, AlignLeft, ArrowRight, ArrowRightLeft, Plus, Wallet, Split, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import UnifiedDropdown from './UnifiedDropdown';
import UnifiedCalendar from './UnifiedCalendar';
import ModalWrapper from './ModalWrapper';
import { formatAmountInput, formatCurrency, getCurrencySymbol } from '../utils/format';
import { generateId } from '../store/db';
import './AddTransactionModal.css';

const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
    position: 'relative'
  }),
  center: {
    x: 0,
    opacity: 1,
    position: 'relative'
  },
  exit: (direction) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0,
    position: 'absolute',
    top: 0, left: 0, right: 0
  })
};

function evalMath(input) {
  try {
    const clean = String(input).replace(/,/g, '');
    if (!/^[0-9+\-*/. ()]+$/.test(clean)) return null;
    // eslint-disable-next-line no-new-func
    const result = new Function(`return ${clean}`)();
    return isNaN(result) || !isFinite(result) ? null : result;
  } catch (e) {
    return null;
  }
}

function formatPreview(num) {
  if (num === null) return '';
  return formatCurrency(num);
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 767);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 767);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}

export default function AddTransactionModal({ isOpen, onClose, initialData = null }) {
  const { addTransaction, updateTransaction, accounts, categories, payees, saveCategory, savePayee } = useData();
  const isMobile = useIsMobile();
  
  const [type, setType] = useState(initialData?.type ?? 0); // 0: expense, 1: income, 2: transfer
  const [direction, setDirection] = useState(0);

  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState([
    { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' },
    { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' }
  ]);
  const [activeSplitId, setActiveSplitId] = useState(null);

  const handleTypeChange = (newType) => {
    setDirection(newType > type ? 1 : -1);
    setType(newType);
  };
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0,10));
  
  const [selectedAccount, setSelectedAccount] = useState(accounts.length > 0 ? accounts[0].name : '');
  const [selectedTransferTo, setSelectedTransferTo] = useState(accounts.length > 1 ? accounts[1].name : (accounts.length > 0 ? accounts[0].name : ''));
  const [receivedAmount, setReceivedAmount] = useState('');

  const sourceAccount = accounts.find(a => a.name === selectedAccount) || accounts[0] || {};
  const destAccount = accounts.find(a => a.name === selectedTransferTo) || accounts[0] || {};
  const sourceCurrency = sourceAccount.currency || 'PKR';
  const destCurrency = destAccount.currency || 'PKR';

  const [activeField, setActiveField] = useState(null); // 'amount', 'category', 'payee', 'note', 'account', 'transferTo'
  const [isCrossCurrency, setIsCrossCurrency] = useState(false);
  
  const [activeSplitIndex, setActiveSplitIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const reset = () => {
    setType(0);
    setAmount('');
    setCategory('');
    setPayee('');
    setNote('');
    setDate(new Date().toISOString().substring(0,10));
    setSelectedAccount(accounts.length > 0 ? accounts[0].name : '');
    setSelectedTransferTo(accounts.length > 1 ? accounts[1].name : (accounts.length > 0 ? accounts[0].name : ''));
    setReceivedAmount('');
    setIsSplit(false);
    setSplits([
      { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' },
      { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' }
    ]);
  };

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        const isTransfer = initialData.type === 'transfer' || initialData.type === 2;
        const isIncome = initialData.type === 'income' || initialData.type === 1;
        const isExpense = initialData.type === 'expense' || initialData.type === 0;
        
        setType(isExpense ? 0 : isIncome ? 1 : 2);
        setAmount(initialData.amount ? Math.abs(initialData.amount).toString() : '0');
        setCategory(isTransfer ? '' : (initialData.category || ''));
        setPayee(isTransfer ? '' : (initialData.payee || ''));
        setNote(initialData.note || '');
        setDate(initialData.date ? String(initialData.date).substring(0,10) : new Date().toISOString().substring(0,10));
        setSelectedAccount(initialData.account || (accounts.length > 0 ? accounts[0].name : ''));
        if (isTransfer) {
           setSelectedTransferTo(initialData.transferTo || initialData.transferAccount || (accounts.length > 1 ? accounts[1].name : ''));
           setReceivedAmount(initialData.receivedAmount ? Math.abs(initialData.receivedAmount).toString() : '');
        } else {
           setReceivedAmount('');
        }
        
        const hasSplits = initialData.splits && initialData.splits.length > 0;
        setIsSplit(hasSplits);
        setActiveSplitIndex(0);
        if (hasSplits) {
          setSplits(initialData.splits.map(s => ({
            ...s,
            id: s.id || generateId(),
            amount: s.amount ? Math.abs(s.amount).toString() : '0'
          })));
        } else {
          setSplits([
            { id: generateId(), amount: '', category: '', payee: '', account: initialData.account || (accounts.length > 0 ? accounts[0].name : '') },
            { id: generateId(), amount: '', category: '', payee: '', account: initialData.account || (accounts.length > 0 ? accounts[0].name : '') }
          ]);
        }
      } else {
        reset();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData, accounts]);

  const evalResult = evalMath(amount);
  const showPreview = amount.match(/[+\-*/]/) && evalResult !== null;

  console.log("[DEBUG] AddTransactionModal Rendering. isOpen:", isOpen, "initialData:", initialData);

  if (!isOpen) {
    console.log("[DEBUG] AddTransactionModal is not open. Returning null.");
    return null;
  }

  console.log("[DEBUG] AddTransactionModal returning JSX! type:", type, "amount:", amount, "category:", category);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const finalAmount = evalMath(amount);
    if (finalAmount == null) {
      alert("Please enter a valid amount.");
      return;
    }
    
    let dbAmt = Math.abs(finalAmount);
    let finalCat = category || 'Unspecified';
    let finalPayee = payee || 'Unspecified';
    let transferAccount = null;

    if (type === 0) {
      dbAmt = -dbAmt;
    } else if (type === 1) {
      // Income is positive
    } else {
      dbAmt = -dbAmt;
      finalCat = "Transfer";
      finalPayee = "Transfer to " + selectedTransferTo;
      transferAccount = selectedTransferTo;
    }

    let finalSplits = [];
    if (isSplit && type !== 2) {
      let sumSplits = 0;
      for (const s of splits) {
        const val = evalMath(s.amount);
        if (val !== null) sumSplits += Math.abs(val);
      }
      if (Math.abs(sumSplits - Math.abs(dbAmt)) > 0.01) {
        alert("Split amounts must exactly equal the total amount.");
        return;
      }
      finalCat = 'Split';
      finalPayee = 'Split';
      finalSplits = splits.map(s => {
        const sAmt = Math.abs(evalMath(s.amount) || 0);
        return {
          ...s,
          amount: type === 0 ? -sAmt : sAmt,
          category: s.category || 'Unspecified',
          payee: s.payee || 'Unspecified',
          account: s.account || selectedAccount
        };
      });
    }

    const tx = {
      id: initialData ? initialData.id : generateId(),
      splits: finalSplits,
      type: type, // 0 = Expense, 1 = Income, 2 = Transfer
      amount: dbAmt,
      category: finalCat,
      payee: finalPayee,
      note: note,
      date: new Date(date).toISOString(),
      account: selectedAccount,
      transferTo: transferAccount,
      currency: sourceCurrency,
      receivedAmount: isCrossCurrency && receivedAmount ? Math.abs(evalMath(receivedAmount)) : null,
      updatedAt: new Date().toISOString(),
      pendingSync: true
    };

    if (initialData) {
      await updateTransaction(tx);
    } else {
      await addTransaction(tx);
    }
    reset();
    onClose();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleTouchStart = (e) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = (e) => {
    if (touchStart === null) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    
    if (diff > 50) {
      // Swiped left -> next
      setActiveSplitIndex(Math.min(splits.length - 1, activeSplitIndex + 1));
    } else if (diff < -50) {
      // Swiped right -> prev
      setActiveSplitIndex(Math.max(0, activeSplitIndex - 1));
    }
    setTouchStart(null);
  };

  const formatPreview = (val) => {
    if (val === Math.trunc(val)) return val.toString();
    return val.toFixed(2);
  };

  const formatDateShort = (isoString) => {
    if (!isoString) return '';
    const parts = isoString.split('-');
    if (parts.length !== 3) return isoString;
    const yy = parts[0].slice(2);
    const mm = parts[1];
    const dd = parts[2];
    return `${dd}/${mm}/${yy}`;
  };

  // Render Mobile Tap Target
  const CurrencyIcon = ({ size, className, style }) => (
    <span className={className} style={{ ...style, fontSize: size, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {getCurrencySymbol(sourceCurrency)}
    </span>
  );
  const DestCurrencyIcon = ({ size, className, style }) => (
    <span className={className} style={{ ...style, fontSize: size, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {getCurrencySymbol(destCurrency)}
    </span>
  );

  const renderTapField = (label, value, Icon, fieldName, compact = false) => {
    const hasValue = value && value.trim().length > 0;
    return (
      <div className="form-group" style={{ minWidth: 0, flex: 1 }}>
        {hasValue && <label>{label}</label>}
        <div 
          className="input-with-icon" 
          onClick={() => setActiveField(fieldName)}
          style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px' }}
        >
          <Icon size={compact ? 16 : 18} className="input-icon" style={{ color: hasValue ? 'var(--text-primary)' : 'var(--text-secondary)' }} />
          <div style={{ paddingLeft: '40px', paddingRight: '12px', height: '46px', display: 'flex', alignItems: 'center', color: hasValue ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: compact ? '13px' : '15px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {hasValue ? value : label}
          </div>
        </div>
      </div>
    );
  };

  return (
    <ModalWrapper onClose={handleClose}>
      <div className="modal-content tx-form-modal glass-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Transaction</h2>
          <button className="close-btn" onClick={handleClose} type="button"><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="tx-form">
          <div className="tx-type-selector" data-type={type}>
            <button type="button" className={`type-btn ${type === 0 ? 'expense-active' : ''}`} onClick={() => handleTypeChange(0)}>Expense</button>
            <button type="button" className={`type-btn ${type === 1 ? 'income-active' : ''}`} onClick={() => handleTypeChange(1)}>Income</button>
            <button type="button" className={`type-btn ${type === 2 ? 'transfer-active' : ''}`} onClick={() => handleTypeChange(2)}>Transfer</button>
          </div>

          <div className="form-row split-row">
            <div className="form-group flex-2 relative">
              {amount && <label>Amount ({sourceCurrency})</label>}
              {isMobile ? (
                <div onClick={() => setActiveField('amount')} style={{ cursor: 'pointer' }}>
                  <div className="input-with-icon" style={{ pointerEvents: 'none' }}>
                    <CurrencyIcon size={18} className="input-icon" />
                    <input type="text" placeholder="Amount" value={amount} readOnly />
                  </div>
                  {showPreview && <div className="math-preview">= {formatPreview(evalResult)}</div>}
                </div>
              ) : (
                <>
                  <div className="input-with-icon">
                    <CurrencyIcon size={18} className="input-icon" />
                    <input 
                      type="text" 
                      placeholder="Amount" 
                      value={amount}
                      onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                      required
                      autoFocus={!isMobile}
                    />
                  </div>
                  {showPreview && <div className="math-preview">= {formatPreview(evalResult)}</div>}
                </>
              )}
            </div>

            <div className="form-group flex-1">
              <label>Date</label>
              <div className="input-with-icon" onClick={() => setIsCalendarOpen(true)} style={{ cursor: 'pointer' }}>
                <Calendar size={18} className="input-icon" />
                <input type="text" value={formatDateShort(date)} readOnly style={{ cursor: 'pointer', paddingLeft: '34px' }} />
              </div>
            </div>
          </div>

          <AnimatePresence>
            {isCalendarOpen && (
              <UnifiedCalendar value={date} onChange={setDate} onClose={() => setIsCalendarOpen(false)} />
            )}
          </AnimatePresence>

          {type !== 2 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px', marginTop: '8px' }}>
              <button 
                type="button" 
                onClick={() => setIsSplit(!isSplit)}
                style={{ background: 'transparent', border: 'none', color: 'var(--accent-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
              >
                <Split size={16} />
                {isSplit ? 'Remove Split' : 'Split Transaction'}
              </button>
            </div>
          )}

          {/* Account Selection */}
          {(!isSplit || type === 2) && (
            isMobile ? (
            type === 2 ? (
              <div className="form-row split-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                <div className="form-group flex-1" style={{ minWidth: 0 }}>
                  {selectedAccount && <label>From Account</label>}
                  {renderTapField('From Account', selectedAccount, Wallet, 'account', true)}
                </div>
                <div style={{ paddingBottom: '16px', display: 'flex', alignItems: 'center' }}>
                  <ArrowRight size={16} style={{ color: 'var(--text-secondary)' }} />
                </div>
                <div className="form-group flex-1" style={{ minWidth: 0 }}>
                  {selectedTransferTo && <label>Transfer To</label>}
                  {renderTapField('Transfer To', selectedTransferTo, ArrowRightLeft, 'transferTo', true)}
                </div>
              </div>
            ) : (
              renderTapField('Account', selectedAccount, Wallet, 'account')
            )
          ) : (
            type === 2 ? (
              <div className="form-row split-row" style={{ alignItems: 'flex-end', gap: '12px' }}>
                <div className="form-group flex-1">
                  {selectedAccount && <label>From Account</label>}
                  <UnifiedDropdown 
                    value={selectedAccount}
                    options={accounts.map(a => ({ value: a.name, label: a.name }))}
                    onChange={setSelectedAccount}
                  />
                </div>
                <div style={{ paddingBottom: '14px', display: 'flex', alignItems: 'center' }}>
                  <ArrowRight size={20} style={{ color: 'var(--text-secondary)' }} />
                </div>
                <div className="form-group flex-1">
                  {selectedTransferTo && <label>Transfer To</label>}
                  <UnifiedDropdown 
                    value={selectedTransferTo}
                    options={accounts.map(a => ({ value: a.name, label: a.name }))}
                    onChange={setSelectedTransferTo}
                  />
                </div>
              </div>
            ) : (
              <div className="form-group">
                {selectedAccount && <label>Account</label>}
                <UnifiedDropdown 
                  value={selectedAccount}
                  options={accounts.map(a => ({ value: a.name, label: a.name }))}
                  onChange={setSelectedAccount}
                />
              </div>
            )
          )
          )}

          <motion.div 
            className="dynamic-fields-wrapper"
            animate={{ 
              height: (isSplit && type !== 2) ? 'auto' : (isMobile ? 
                      (type === 2 ? (isCrossCurrency ? 66 : 0) : 116) : 
                      (type === 2 ? (isCrossCurrency ? 42 : 0) : 98)),
              marginTop: (type === 2 && !isCrossCurrency) ? -16 : 0
            }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            style={{ 
              position: 'relative',
              overflow: (isSplit && type !== 2) ? 'visible' : 'hidden'
            }}
          >
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              {type === 2 ? (
                <motion.div
                  key="transfer"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                  className="dynamic-fields-content"
                  style={{ width: '100%' }}
                >
                  {isCrossCurrency && (
                    <div className="form-group" style={{ marginTop: isMobile ? '16px' : '0' }}>
                      {receivedAmount && <label>Received Amount ({destCurrency})</label>}
                      {isMobile ? (
                        renderTapField(`Received (${destCurrency})`, receivedAmount, DestCurrencyIcon, 'receivedAmount')
                      ) : (
                        <div className="input-with-icon">
                          <span className="input-icon" style={{ fontSize: '18px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>{getCurrencySymbol(destCurrency)}</span>
                          <input 
                            type="text" 
                            placeholder={`Received Amount (${destCurrency})`}
                            value={receivedAmount}
                            onChange={(e) => setReceivedAmount(formatAmountInput(e.target.value))}
                            required
                          />
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="regular"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                  className="dynamic-fields-content"
                  style={{ width: '100%' }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {isSplit ? (
                      <motion.div 
                        key="split-ui"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        style={{ display: 'flex', flexDirection: 'column', width: '100%' }}
                      >
                      <div 
                        className="splits-carousel-viewport"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                      >
                        <div 
                          className="splits-carousel-track"
                          style={{ transform: `translateX(-${activeSplitIndex * 100}%)` }}
                        >
                          {splits.map((s, index) => (
                            <div key={s.id} className="split-card">
                              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Split {index + 1} of {splits.length}</span>
                                  <button type="button" className="delete-split-btn" onClick={() => {
                                    if (splits.length > 2) {
                                      setSplits(splits.filter(sp => sp.id !== s.id));
                                      if (activeSplitIndex >= splits.length - 1) {
                                        setActiveSplitIndex(Math.max(0, splits.length - 2));
                                      }
                                    } else if (splits.length === 2) {
                                      setIsSplit(false);
                                      setActiveSplitIndex(0);
                                      setSplits([
                                        { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' },
                                        { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' }
                                      ]);
                                    }
                                  }} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', zIndex: 10, padding: '4px' }}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                                
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                  <div className="input-with-icon">
                                    <CurrencyIcon size={16} className="input-icon" />
                                    <input 
                                      type="text" 
                                      placeholder="Split Amount" 
                                      value={s.amount}
                                      onChange={(e) => {
                                        const val = formatAmountInput(e.target.value);
                                        setSplits(splits.map(sp => sp.id === s.id ? { ...sp, amount: val } : sp));
                                      }}
                                    />
                                  </div>
                                </div>
                                
                                {isMobile ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div onClick={() => { setActiveSplitId(s.id); setActiveField('account'); }}>
                                      {renderTapField("Account", s.account, Wallet, 'account', true)}
                                    </div>
                                    <div onClick={() => { setActiveSplitId(s.id); setActiveField('category'); }}>
                                      {renderTapField("Category", s.category, Tag, 'category', true)}
                                    </div>
                                    <div onClick={() => { setActiveSplitId(s.id); setActiveField('payee'); }}>
                                      {renderTapField("Payee", s.payee, User, 'payee', true)}
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: '1 1 30%' }}>
                                      <UnifiedDropdown value={s.account} placeholder="Account" options={accounts.map(a => ({ value: a.name, label: a.name }))} onChange={(val) => setSplits(splits.map(sp => sp.id === s.id ? { ...sp, account: val } : sp))} />
                                    </div>
                                    <div className="form-group" style={{ flex: '1 1 30%' }}>
                                      <UnifiedDropdown value={s.category} placeholder="Category" options={categories.map(c => ({ value: c.name, label: c.name }))} onChange={(val) => setSplits(splits.map(sp => sp.id === s.id ? { ...sp, category: val } : sp))} />
                                    </div>
                                    <div className="form-group" style={{ flex: '1 1 30%' }}>
                                      <UnifiedDropdown value={s.payee} placeholder="Payee" options={payees.map(p => ({ value: p.name, label: p.name }))} onChange={(val) => setSplits(splits.map(sp => sp.id === s.id ? { ...sp, payee: val } : sp))} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="splits-pagination">
                        <button 
                          type="button" 
                          onClick={() => setActiveSplitIndex(Math.max(0, activeSplitIndex - 1))}
                          disabled={activeSplitIndex === 0}
                          className="pagination-btn"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        
                        <div className="splits-dots">
                          {splits.map((_, i) => (
                            <div 
                              key={i} 
                              className={`split-dot ${i === activeSplitIndex ? 'active' : ''}`} 
                              onClick={() => setActiveSplitIndex(i)}
                            />
                          ))}
                        </div>

                        <button 
                          type="button" 
                          onClick={() => setActiveSplitIndex(Math.min(splits.length - 1, activeSplitIndex + 1))}
                          disabled={activeSplitIndex === splits.length - 1}
                          className="pagination-btn"
                        >
                          <ChevronRight size={20} />
                        </button>

                        <button 
                          type="button" 
                          onClick={() => {
                            setSplits([...splits, { id: generateId(), amount: '', category: '', payee: '', account: accounts.length > 0 ? accounts[0].name : '' }]);
                            setActiveSplitIndex(splits.length);
                          }}
                          className="add-split-btn-pagination"
                          style={{ marginLeft: 'auto' }}
                        >
                          <Plus size={16} /> Add Split
                        </button>
                      </div>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key="regular-ui"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
                      >
                        {isMobile ? (
                          <>
                            {renderTapField("Category", category, Tag, 'category')}
                            {renderTapField("Payee", payee, User, 'payee')}
                          </>
                        ) : (
                          <>
                            <div className="form-group">
                              {category && <label>Category</label>}
                              <div className="input-with-icon" onClick={() => setActiveField('category')}>
                                <Tag size={18} className="input-icon" />
                                <input type="text" placeholder="Category" value={category} readOnly style={{ cursor: 'pointer' }} />
                              </div>
                            </div>
                            <div className="form-group">
                              {payee && <label>Payee</label>}
                              <div className="input-with-icon" onClick={() => setActiveField('payee')}>
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

          <div className="form-group">
            {note && <label>Note (Optional)</label>}
            {isMobile ? (
              <div onClick={() => setActiveField('note')} style={{ cursor: 'pointer' }}>
                <div className="input-with-icon" style={{ pointerEvents: 'none' }}>
                  <AlignLeft size={18} className="input-icon" />
                  <input type="text" placeholder="Note (Optional)" value={note} readOnly />
                </div>
              </div>
            ) : (
              <div className="input-with-icon">
                <AlignLeft size={18} className="input-icon" />
                <input type="text" placeholder="Note (Optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
          </div>

          <div className="modal-actions" style={{ alignItems: 'center' }}>
            {isSplit && type !== 2 && (
              <div style={{ marginRight: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {(() => {
                   const total = evalMath(amount) || 0;
                   const splitTotal = splits.reduce((acc, s) => acc + (evalMath(s.amount) || 0), 0);
                   const rem = total - splitTotal;
                   if (Math.abs(rem) < 0.01) return <span style={{color: '#10b981', fontWeight: 600}}>Split balanced ✓</span>;
                   return <span style={{fontWeight: 600}}>Remaining: {formatCurrency(rem)}</span>;
                })()}
              </div>
            )}
            <button type="button" className="cancel-btn" onClick={handleClose}>Cancel</button>
            <button type="submit" className="submit-btn" style={{ background: 'var(--accent-color)', color: '#fff', border: 'none' }} disabled={isSplit && type !== 2 && Math.abs((evalMath(amount) || 0) - splits.reduce((acc, s) => acc + (evalMath(s.amount) || 0), 0)) > 0.01}>
              Save Transaction
            </button>
          </div>
        </form>

        {activeField && (
          <PoppedFieldOverlay 
            field={activeField}
            items={
              activeField === 'category' ? categories : 
              activeField === 'payee' ? payees : 
              (activeField === 'account' || activeField === 'transferTo') ? accounts : []
            }
            initialValue={
              activeSplitId ? (
                activeField === 'category' ? splits.find(s => s.id === activeSplitId)?.category :
                activeField === 'payee' ? splits.find(s => s.id === activeSplitId)?.payee : ''
              ) : (
                activeField === 'amount' ? amount :
                activeField === 'note' ? note :
                activeField === 'category' ? category :
                activeField === 'payee' ? payee :
                activeField === 'account' ? selectedAccount :
                activeField === 'transferTo' ? selectedTransferTo : ''
              )
            }
            onSelect={(val) => {
              if (activeSplitId) {
                setSplits(splits.map(sp => sp.id === activeSplitId ? { ...sp, [activeField]: val } : sp));
              } else {
                if (activeField === 'category') setCategory(val);
                if (activeField === 'payee') setPayee(val);
                if (activeField === 'account') setSelectedAccount(val);
                if (activeField === 'transferTo') setSelectedTransferTo(val);
              }
              setActiveField(null);
              setActiveSplitId(null);
            }}
            onSaveValue={(val) => {
              if (activeSplitId) {
                setSplits(splits.map(sp => sp.id === activeSplitId ? { ...sp, [activeField]: val } : sp));
              } else {
                if (activeField === 'amount') setAmount(val);
                if (activeField === 'note') setNote(val);
                if (activeField === 'category') setCategory(val);
                if (activeField === 'payee') setPayee(val);
                if (activeField === 'account') setSelectedAccount(val);
                if (activeField === 'transferTo') setSelectedTransferTo(val);
              }
            }}
            onAdd={async (val) => {
              if (activeField === 'category') {
                await saveCategory({ name: val, color: '#6366f1' });
                if (activeSplitId) setSplits(splits.map(sp => sp.id === activeSplitId ? { ...sp, category: val } : sp));
                else setCategory(val);
              } else if (activeField === 'payee') {
                await savePayee({ name: val, color: '#10b981' });
                if (activeSplitId) setSplits(splits.map(sp => sp.id === activeSplitId ? { ...sp, payee: val } : sp));
                else setPayee(val);
              }
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

function PoppedFieldOverlay({ field, onClose, items = [], onSelect, onAdd, initialValue, onSaveValue }) {
  const isAutocomplete = field === 'category' || field === 'payee' || field === 'account' || field === 'transferTo';
  
  // Autocomplete starts empty to show all options. Text fields start with initialValue.
  const [query, setQuery] = useState(isAutocomplete ? '' : (initialValue || ''));

  const filtered = isAutocomplete ? items.filter(item => item.name.toLowerCase().includes(query.toLowerCase())) : [];
  const exactMatch = isAutocomplete ? items.find(item => item.name.toLowerCase() === query.trim().toLowerCase()) : null;

  // Handle click outside
  const executeApply = () => {
    if (!isAutocomplete) {
      onSaveValue(query);
      onClose();
    } else {
      if (exactMatch) {
        onSelect(exactMatch.name);
      } else if (query.trim()) {
        onSelect(query.trim());
      } else {
        onClose(); // Empty query cancels
      }
    }
  };

  const handleBackdropClick = () => {
    executeApply();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeApply();
    }
  };

  return (
    <div className="popped-overlay" onClick={handleBackdropClick}>
      <div className="popped-container glass-panel" onClick={e => e.stopPropagation()}>
        <div className="popped-header">
          {field === 'account' || field === 'transferTo' ? (
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', padding: '8px', flex: 1 }}>
              Select Account
            </div>
          ) : (
            <input 
              className="popped-input"
              placeholder={
                field === 'amount' ? 'Enter amount (e.g. 50+20)...' : 
                field === 'note' ? 'Enter note...' : 
                `Search or add ${field}...`
              }
              value={query}
              onChange={e => setQuery(field === 'amount' ? formatAmountInput(e.target.value) : e.target.value)}
              onKeyDown={handleKeyDown}
              type="text"
              inputMode={field === 'amount' ? 'decimal' : 'text'}
              autoFocus
            />
          )}
        </div>
        
        {isAutocomplete && (
          <div className="popped-list">
            {query.trim() && !exactMatch && (
              <button className="popped-item add-new-row" onClick={() => onAdd(query.trim())}>
                <div className="popped-icon-wrap add-icon"><Plus size={18} /></div>
                <span>Add "{query.trim()}"</span>
              </button>
            )}
            {filtered.map(item => (
              <button key={item.id} className="popped-item" onClick={() => onSelect(item.name)} type="button">
                <span>{item.name}</span>
              </button>
            ))}
            {filtered.length === 0 && !query.trim() && (
              <div className="popped-item" style={{ color: 'var(--text-secondary)' }}>No items found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
