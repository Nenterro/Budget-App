import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useData } from '../context/DataContext';
import { useAppearanceSettings } from '../context/SettingsContext';
import { formatCurrency, getCurrencySymbol, formatAmountInput } from '../utils/format';
import { calculateBudgets, calculateTotalBalance } from '../utils/budget';
import { ChevronLeft, ChevronRight, X, AlertCircle, Plus, Repeat, Target, Edit2, Trash2, Home } from 'lucide-react';
import { addMonths, subMonths, format, endOfMonth, parseISO, eachDayOfInterval, getDay } from 'date-fns';
import { generateId } from '../store/db';
import UnifiedDropdown from '../components/UnifiedDropdown';
import ManageGoalsModal from '../components/ManageGoalsModal';
import EditBudgetModal from '../components/EditBudgetModal';
import { NavLink } from 'react-router-dom';
import './Budgets.css';

export default function Budgets() {
  const { transactions, accounts, categories, budgets, saveBudget, saveCategory, exchangeRates } = useData();
  const { baseCurrency } = useAppearanceSettings();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [direction, setDirection] = useState(0);
  const monthStr = format(currentDate, 'yyyy-MM');
  const monthDisplay = format(currentDate, 'MMMM yyyy');
  
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isEditBudgetModalOpen, setIsEditBudgetModalOpen] = useState(false);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const { budgetData, totalCash, globalBudgetData } = useMemo(() => {
    // Total cash across all time
    const totalCash = calculateTotalBalance(transactions, accounts, exchangeRates, baseCurrency);
    
    // Budgets for the selected month
    const budgetData = calculateBudgets(transactions, accounts, categories, budgets || [], exchangeRates, baseCurrency, monthStr);
    
    // Global budgets for calculating global Ready to Assign
    const globalBudgetData = calculateBudgets(transactions, accounts, categories, budgets || [], exchangeRates, baseCurrency, '9999-12');

    return { budgetData, totalCash, globalBudgetData };
  }, [transactions, accounts, categories, budgets, exchangeRates, baseCurrency, monthStr]);

  const leftToBudget = useMemo(() => {
    let positiveAvailableSum = 0;
    globalBudgetData.categories.forEach(c => {
      if (c.available > 0) positiveAvailableSum += c.available;
    });

    return totalCash - positiveAvailableSum;
  }, [totalCash, globalBudgetData]);

  const handlePrevMonth = () => {
    setDirection(-1);
    setCurrentDate(subMonths(currentDate, 1));
  };
  const handleNextMonth = () => {
    setDirection(1);
    setCurrentDate(addMonths(currentDate, 1));
  };

  const openAssignModal = () => {
    const unassignedCats = categories.filter(c => {
      const existing = (budgets || []).find(b => b.category === c.name && b.month === monthStr);
      return !existing || existing.amount === 0;
    });
    setEditingCategory(unassignedCats.length > 0 ? unassignedCats[0].name : '');
    setEditAmount('');
    setIsAssignModalOpen(true);
  };

  const openEditBudgetModal = (catName, currentAmt) => {
    setEditingCategory(catName);
    setEditAmount(currentAmt.toString());
    setIsEditBudgetModalOpen(true);
  };

  const handleDeleteAssignment = async (catName) => {
    let existing = (budgets || []).find(b => b.category === catName && b.month === monthStr);
    if (existing) {
      await saveBudget({ ...existing, amount: 0 });
    }
  };

  const handleAssignAmountChange = (e) => {
    const val = formatAmountInput(e.target.value);
    if (!val) {
      setEditAmount('');
      return;
    }
    const rawVal = val.replace(/,/g, '');
    const parsed = parseFloat(rawVal);
    if (isNaN(parsed)) {
      setEditAmount(val);
      return;
    }
    setEditAmount(val);
  };

  const handleSaveBudget = async () => {
    if (!editingCategory) return;
    
    const baseAmt = parseFloat(String(editAmount).replace(/,/g, '')) || 0;
    
    let existing = (budgets || []).find(b => b.category === editingCategory && b.month === monthStr);
    const record = {
      id: existing ? existing.id : generateId(),
      category: editingCategory,
      month: monthStr,
      amount: baseAmt,
      rollover: existing ? existing.rollover : true
    };
    await saveBudget(record);
    
    setIsAssignModalOpen(false);
  };

  const handleToggleRollover = async (catName, currentRollover) => {
    let existing = (budgets || []).find(b => b.category === catName && b.month === monthStr);
    
    const record = {
      id: existing ? existing.id : generateId(),
      category: catName,
      month: monthStr,
      amount: existing ? existing.amount : 0,
      rollover: !currentRollover
    };
    
    await saveBudget(record);
  };

  return (
    <div className="page-container budgets-page">
      <div className="budgets-header">
        <h1 className="page-title desktop-only" style={{ margin: 0 }}>Budgets</h1>
        
        <div className="budgets-header-controls">
          <NavLink to="/" className="mobile-only" title="Home" style={{ 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px', 
              width: '44px',
              height: '44px',
              flexShrink: 0,
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              textDecoration: 'none'
            }}>
            <Home size={20} />
          </NavLink>
          <button 
            className="icon-btn"
            onClick={() => setIsGoalsModalOpen(true)}
            title="Manage Goals" 
            style={{ 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid var(--border-color)',
              borderRadius: '16px', 
              padding: '0', 
              width: '44px',
              height: '44px',
              flexShrink: 0,
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <Target size={20} />
          </button>

          <div className="month-selector" style={{ marginBottom: 0, flex: 1, minWidth: '180px', maxWidth: '250px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <button className="month-btn" onClick={handlePrevMonth}><ChevronLeft size={20} /></button>
            <div style={{ position: 'relative', width: '150px', height: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
              <AnimatePresence mode="popLayout" custom={direction}>
                <motion.h2 
                  key={monthStr}
                  custom={direction}
                  initial={{ x: direction * 50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: direction * -50, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  style={{ margin: 0, fontSize: '18px', whiteSpace: 'nowrap' }}
                >
                  {monthDisplay}
                </motion.h2>
              </AnimatePresence>
            </div>
            <button className="month-btn" onClick={handleNextMonth}><ChevronRight size={20} /></button>
          </div>
        </div>
      </div>

      <div key={monthStr} className="month-content">
        <div className="budget-summary">
          <div>
            <div className="summary-label">Total Cash</div>
            <div className="summary-value">{getCurrencySymbol(baseCurrency)}{formatCurrency(totalCash)}</div>
          </div>
          <div>
            <div className="summary-label">Budgeted</div>
            <div className="summary-value" style={{ color: 'var(--text-primary)' }}>
              {getCurrencySymbol(baseCurrency)}{formatCurrency(budgetData.totalBudgeted)}
            </div>
          </div>
          <div>
            <div className="summary-label">Ready to Assign</div>
            <div className="summary-value" style={{ color: leftToBudget >= 0 ? '#10b981' : '#ef4444' }}>
              {getCurrencySymbol(baseCurrency)}{formatCurrency(leftToBudget)}
            </div>
          </div>
        </div>

        <div className="category-list">
          <div className="cat-header">
            <div>Category</div>
            <div style={{ textAlign: 'center' }}>Assigned</div>
            <div style={{ textAlign: 'center' }}>Activity</div>
            <div style={{ textAlign: 'center' }}>Available</div>
            <div></div>
          </div>
          
          {budgetData.categories
            .filter(cat => cat.assigned !== 0 || cat.target > 0)
            .map((cat) => {
            const availClass = cat.available < 0 ? 'negative' : (cat.available > 0 ? 'positive' : 'neutral');
            
            const totalCatBudget = cat.available + Math.abs(cat.activity);
            const progressPercent = cat.available < 0 ? 100 : (totalCatBudget > 0 ? Math.min(100, (Math.abs(cat.activity) / totalCatBudget) * 100) : 0);
            const progressColor = cat.available < 0 ? 'var(--accent-color)' : '#10b981';

            return (
              <div key={cat.name} className="category-row">
                <div className="col-val" data-label="Category" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', paddingRight: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{cat.name}</span>
                    <button 
                      className={`rollover-toggle ${cat.rollover ? 'active' : ''}`}
                      onClick={() => handleToggleRollover(cat.name, cat.rollover)}
                      title={cat.rollover ? "Unspent funds will roll over to next month" : "Unspent funds will NOT roll over"}
                    >
                      <Repeat size={12} />
                      <span>{cat.rollover ? 'ON' : 'OFF'}</span>
                    </button>
                  </div>
                  
                  {cat.target > 0 && (
                    <div style={{ marginTop: '2px', width: '100%', maxWidth: '250px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        <span>Target: {getCurrencySymbol(baseCurrency)}{formatCurrency(cat.target, true)}</span>
                        <span>{Math.round((cat.assigned / cat.target) * 100)}%</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ 
                          height: '100%', 
                          width: `${Math.min(100, (cat.assigned / cat.target) * 100)}%`, 
                          background: cat.assigned >= cat.target ? '#10b981' : 'var(--accent-color)',
                          borderRadius: '3px'
                        }} />
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="budget-row-meta">
                  <div className="col-val" data-label="Assigned" style={{ display: 'flex', justifyContent: 'center' }}>
                    <span className="col-assigned" onClick={() => openEditBudgetModal(cat.name, cat.assigned)} style={{ fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}>
                      {cat.assigned < 0 ? '-' : ''}{getCurrencySymbol(baseCurrency)}{formatCurrency(Math.abs(cat.assigned))}
                    </span>
                  </div>
                  
                  <div className="col-val" data-label="Activity" style={{ display: 'flex', justifyContent: 'center' }}>
                    <span className="col-activity" style={{ fontVariantNumeric: 'tabular-nums', color: cat.activity < 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {cat.activity < 0 ? '-' : ''}{getCurrencySymbol(baseCurrency)}{formatCurrency(Math.abs(cat.activity))}
                    </span>
                  </div>
                </div>
                
                <div className="col-val" data-label="Available" style={{ display: 'flex', justifyContent: 'center' }}>
                  <span className={`col-available ${availClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {cat.available < 0 ? '-' : ''}{getCurrencySymbol(baseCurrency)}{formatCurrency(Math.abs(cat.available))}
                  </span>
                </div>
                
                <div className="col-val" data-label="Actions" style={{ display: 'flex', justifyContent: 'center' }}>
                  <div className="actions-wrapper" style={{ display: 'flex', gap: '8px' }}>
                    <button className="icon-btn" onClick={() => openEditBudgetModal(cat.name, cat.assigned)} title="Edit Budget" style={{ padding: '6px' }}>
                      <Edit2 size={16} color="var(--text-secondary)" />
                    </button>
                    <button className="icon-btn" onClick={() => handleDeleteAssignment(cat.name)} title="Remove Assignment" style={{ padding: '6px' }}>
                      <Trash2 size={16} color="#ef4444" />
                    </button>
                  </div>
                </div>
                <div style={{ width: '100%', gridColumn: '1 / -1', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '4px' }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${progressPercent}%`, 
                    background: progressColor,
                    borderRadius: '2px',
                    transition: 'width 0.3s ease-out'
                  }} />
                </div>
              </div>
            );
          })}
          
          <div 
            className="add-widget-card" 
            style={{ 
              minHeight: '80px', 
              flexDirection: 'row', 
              justifyContent: 'center',
              gap: '12px', 
              margin: '8px 0', 
              cursor: 'pointer' 
            }} 
            onClick={() => openAssignModal()}
          >
            <div className="add-icon-circle" style={{ width: '40px', height: '40px', color: 'var(--primary-color)' }}>
              <Plus size={24} />
            </div>
            <span style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>Assign New Budget</span>
          </div>
        </div>
      </div>

      {isAssignModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsAssignModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
            <div className="modal-header" style={{ padding: '24px 20px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '22px' }}>New Budget</h2>
              <button className="icon-btn" onClick={() => setIsAssignModalOpen(false)} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={20} /></button>
            </div>
            
            <div className="edit-budget-modal" style={{ padding: '0 20px 20px' }}>
              <div style={{
                background: leftToBudget >= 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${leftToBudget >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                borderRadius: '16px',
                padding: '24px 20px',
                textAlign: 'center',
                marginBottom: '28px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, color: leftToBudget >= 0 ? '#10b981' : '#ef4444' }}>
                  Ready to Assign
                </span>
                <span style={{ fontSize: '32px', fontWeight: 'bold', color: leftToBudget >= 0 ? '#10b981' : '#ef4444', letterSpacing: '-0.5px', lineHeight: 1 }}>
                  {getCurrencySymbol(baseCurrency)}{formatCurrency(leftToBudget)}
                </span>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px', fontWeight: 600 }}>Category</label>
                <UnifiedDropdown
                  options={categories
                    .filter(c => {
                      const budgetCat = budgetData.categories.find(bc => bc.name === c.name);
                      return !budgetCat || budgetCat.assigned === 0;
                    })
                    .map(c => ({ label: c.name, value: c.name }))}
                  value={editingCategory || ''}
                  onChange={(val) => setEditingCategory(val)}
                  placeholder="Select Category"
                />
              </div>

              <div style={{ marginBottom: '4px' }}>
                <label style={{ display: 'block', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px', fontWeight: 600 }}>Assigned Amount</label>
                <div className="input-with-icon" style={{ background: 'var(--surface-color)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="input-icon" style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    {getCurrencySymbol(baseCurrency)}
                  </span>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={editAmount} 
                    onChange={handleAssignAmountChange}
                    placeholder="0.00"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBudget()}
                    style={{ width: '100%', padding: '16px 16px 16px 40px', fontSize: '20px', fontWeight: '600', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              
              <button className="primary-btn" onClick={handleSaveBudget} style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '12px', marginTop: '16px' }} disabled={!editingCategory}>
                Save Assignment
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      <ManageGoalsModal isOpen={isGoalsModalOpen} onClose={() => setIsGoalsModalOpen(false)} budgetData={budgetData} />
      
      <EditBudgetModal 
        isOpen={isEditBudgetModalOpen} 
        onClose={() => setIsEditBudgetModalOpen(false)} 
        categoryName={editingCategory}
        currentAmount={editAmount}
        monthStr={monthStr}
        budgetData={budgetData}
        leftToBudget={leftToBudget}
      />
    </div>
  );
}
