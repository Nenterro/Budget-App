import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../context/DataContext';
import { useAppearanceSettings } from '../context/SettingsContext';
import { formatCurrency, getCurrencySymbol, formatAmountInput } from '../utils/format';
import { X, ArrowRightLeft } from 'lucide-react';
import UnifiedDropdown from './UnifiedDropdown';

export default function EditBudgetModal({ isOpen, onClose, categoryName, currentAmount, monthStr, budgetData, leftToBudget }) {
  const { budgets, saveBudget } = useData();
  const { baseCurrency } = useAppearanceSettings();
  
  const [moveAmount, setMoveAmount] = useState('');
  const [moveDirection, setMoveDirection] = useState('from'); // 'from' or 'to'
  const [targetCategory, setTargetCategory] = useState('READY_TO_ASSIGN');

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setMoveAmount('');
      setTargetCategory('READY_TO_ASSIGN');
      setMoveDirection('from');
    }
  }, [isOpen, categoryName]);

  if (!isOpen) return null;

  const handleMoveAmountChange = (e) => {
    const val = formatAmountInput(e.target.value);
    if (!val) {
      setMoveAmount('');
      return;
    }
    
    const rawVal = val.replace(/,/g, '');
    let parsed = parseFloat(rawVal);
    if (isNaN(parsed)) {
      setMoveAmount(val);
      return;
    }
    
    let maxAllowed = Infinity;
    if (moveDirection === 'from') {
      if (targetCategory !== 'READY_TO_ASSIGN') {
        const sourceCat = budgetData.categories.find(c => c.name === targetCategory);
        maxAllowed = sourceCat ? sourceCat.available : 0;
      }
    } else {
      const currentCatData = budgetData.categories.find(c => c.name === categoryName);
      maxAllowed = currentCatData ? currentCatData.available : 0;
    }

    if (maxAllowed < 0) maxAllowed = 0;

    if (maxAllowed !== Infinity && parsed > maxAllowed) {
      setMoveAmount(formatAmountInput(maxAllowed.toString()));
    } else {
      setMoveAmount(val);
    }
  };

  const handleMoveMoney = async () => {
    const amt = parseFloat(String(moveAmount).replace(/,/g, '')) || 0;
    if (amt <= 0 || !targetCategory) return;

    if (targetCategory === 'READY_TO_ASSIGN') {
      let existing = (budgets || []).find(b => b.category === categoryName && b.month === monthStr);
      let newAmount = existing ? existing.amount : 0;
      
      if (moveDirection === 'to') {
        newAmount = newAmount - amt;
      } else {
        newAmount = newAmount + amt;
      }
      
      const record = {
        id: existing ? existing.id : crypto.randomUUID(),
        category: categoryName,
        month: monthStr,
        amount: newAmount,
        rollover: existing ? existing.rollover : true
      };
      
      await saveBudget(record);
      onClose();
      return;
    }

    let sourceCat = moveDirection === 'to' ? categoryName : targetCategory;
    let destCat = moveDirection === 'to' ? targetCategory : categoryName;

    let existingSource = (budgets || []).find(b => b.category === sourceCat && b.month === monthStr);
    let existingDest = (budgets || []).find(b => b.category === destCat && b.month === monthStr);

    const sourceRecord = {
      id: existingSource ? existingSource.id : crypto.randomUUID(),
      category: sourceCat,
      month: monthStr,
      amount: (existingSource ? existingSource.amount : 0) - amt,
      rollover: existingSource ? existingSource.rollover : true
    };

    const destRecord = {
      id: existingDest ? existingDest.id : crypto.randomUUID(),
      category: destCat,
      month: monthStr,
      amount: (existingDest ? existingDest.amount : 0) + amt,
      rollover: existingDest ? existingDest.rollover : true
    };

    // Save both
    await saveBudget(sourceRecord);
    await saveBudget(destRecord);
    onClose();
  };

  const currentCategoryAmt = parseFloat(String(currentAmount).replace(/,/g, '')) || 0;
  const amt = parseFloat(String(moveAmount).replace(/,/g, '')) || 0;
  let projectedAmount = currentCategoryAmt;
  if (amt > 0 && targetCategory) {
    if (moveDirection === 'from') {
      projectedAmount = currentCategoryAmt + amt;
    } else {
      projectedAmount = currentCategoryAmt - amt;
    }
  }

  // Only show categories that have an assignment for the dropdown
  const otherAssignedCategories = budgetData.categories
    .filter(c => c.name !== categoryName && c.assigned > 0);

  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <div className="modal-header" style={{ padding: '24px 20px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Move Funds: {categoryName}</h2>
          <button className="icon-btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={20} /></button>
        </div>
        
        <div className="edit-budget-modal" style={{ padding: '0 20px 20px' }}>
          
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', justifyContent: 'center' }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px 24px', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '4px' }}>Projected Assignment</div>
                <div style={{ fontSize: '24px', fontWeight: '600', color: projectedAmount !== currentCategoryAmt ? 'var(--accent-color)' : 'var(--text-primary)' }}>
                  {getCurrencySymbol(baseCurrency)}{formatCurrency(projectedAmount)}
                </div>
              </div>
            </div>
            
            <div className="move-direction-selector" data-direction={moveDirection}>
              <button 
                type="button"
                onClick={() => { setMoveDirection('from'); setMoveAmount(''); }}
                className={`move-btn ${moveDirection === 'from' ? 'pull-active' : ''}`}
              >
                Pull Funds
              </button>
              <button 
                type="button"
                onClick={() => { setMoveDirection('to'); setMoveAmount(''); }}
                className={`move-btn ${moveDirection === 'to' ? 'send-active' : ''}`}
              >
                Send Funds
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <UnifiedDropdown
                options={[
                  { label: 'Ready to Assign', value: 'READY_TO_ASSIGN' },
                  ...otherAssignedCategories.map(c => ({ label: c.name, value: c.name }))
                ]}
                value={targetCategory}
                onChange={(val) => { setTargetCategory(val); setMoveAmount(''); }}
                placeholder={moveDirection === 'from' ? "Select Category to pull from" : "Select Category to send to"}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
              <div className="input-with-icon" style={{ flex: 1, background: 'var(--surface-color)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="input-icon" style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {getCurrencySymbol(baseCurrency)}
                </span>
                <input 
                  type="text" 
                  inputMode="decimal"
                  value={moveAmount} 
                  onChange={handleMoveAmountChange}
                  placeholder="0.00"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleMoveMoney()}
                  style={{ width: '100%', padding: '16px 16px 16px 40px', fontSize: '20px', fontWeight: '600', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            
            <button className="primary-btn" onClick={handleMoveMoney} style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '12px', background: 'var(--accent-color)' }} disabled={!targetCategory || !moveAmount}>
              Confirm Transfer
            </button>
          </div>
          
        </div>
      </div>
    </div>,
    document.body
  );
}
