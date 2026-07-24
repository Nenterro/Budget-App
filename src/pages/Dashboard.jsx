import { useState, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { Filter, Settings, Plus, Edit2, Trash2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { usePageSettings, useAppearanceSettings } from '../context/SettingsContext';
import DashboardWidgetCard from '../components/Dashboard/DashboardWidgets';
import AddDashboardWidgetModal, { WIDGET_TYPES } from '../components/Dashboard/AddDashboardWidgetModal';
import { EditItemModal } from './ManageData';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { startOfMonth, subMonths, endOfMonth, subDays, startOfYear, isAfter, isBefore, parseISO } from 'date-fns';
import './Dashboard.css';
import '../pages/Transactions.css'; // For top header styles

const PERIODS = ['All Time', 'This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Custom Range'];

export default function Dashboard() {
  const { transactions, accounts, saveAccount, deleteAccount, categories, budgets } = useData();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  // Independent Page Filter state
  const { 
    selectedPeriod, setSelectedPeriod, 
    customRange, setCustomRange, 
    filterState, setFilterState,
    activeWidgets, setWidgets
  } = usePageSettings('dashboard');
  
  const [showCustomRangeModal, setShowCustomRangeModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);



  // Filter Logic
  const { fullyFiltered, advancedFiltered, currentRange } = useMemo(() => {
    let advancedResult = transactions;
    if (filterState.excludedCategories.size > 0) {
      advancedResult = advancedResult.filter(tx => !filterState.excludedCategories.has(tx.category));
    }
    if (filterState.excludedPayees.size > 0) {
      advancedResult = advancedResult.filter(tx => !filterState.excludedPayees.has(tx.payee));
    }
    if (filterState.excludedAccounts.size > 0) {
      advancedResult = advancedResult.filter(tx => !filterState.excludedAccounts.has(tx.account));
    }
    if (filterState.minAmount !== '' && filterState.minAmount !== null) {
      const min = parseFloat(filterState.minAmount);
      advancedResult = advancedResult.filter(tx => tx.amount >= min);
    }
    if (filterState.maxAmount !== '' && filterState.maxAmount !== null) {
      const max = parseFloat(filterState.maxAmount);
      advancedResult = advancedResult.filter(tx => tx.amount <= max);
    }

    let fullyResult = advancedResult;
    const now = new Date();
    let computedRange = { start: null, end: null };

    if (selectedPeriod !== 'All Time') {
      let start, end = now;
      if (selectedPeriod === 'This Month') start = startOfMonth(now);
      else if (selectedPeriod === 'Last Month') {
        start = startOfMonth(subMonths(now, 1));
        end = endOfMonth(subMonths(now, 1));
      }
      else if (selectedPeriod === 'Last 3 Months') start = subDays(now, 90);
      else if (selectedPeriod === 'This Year') start = startOfYear(now);
      else if (selectedPeriod === 'Custom Range' && customRange.start && customRange.end) {
        start = new Date(customRange.start);
        start.setHours(0, 0, 0, 0);
        end = new Date(customRange.end);
        end.setHours(23, 59, 59, 999);
      }
      computedRange = { start, end };

      fullyResult = advancedResult.filter(tx => {
        const d = parseISO(tx.date);
        return isAfter(d, start) && isBefore(d, end);
      });
    }
    return { fullyFiltered: fullyResult, advancedFiltered: advancedResult, currentRange: computedRange };
  }, [transactions, selectedPeriod, filterState, customRange]);

  const { baseCurrency, displayMode } = useAppearanceSettings();
  const { exchangeRates } = useData();

  // Balances calculation (Stock metric up to currentRange.end)
  const { totalBalance, accountBalances, splitBalances } = useMemo(() => {
    let total = 0;
    const split = {}; // for Native Split mode
    const accBalances = {};

    if (accounts) {
      accounts.forEach(acc => {
        const cur = acc.currency || 'USD';
        const initBal = Number(acc.initialBalance) || 0;
        accBalances[acc.name] = { ...acc, currentBalance: initBal };
        
        const rate = exchangeRates && exchangeRates[cur] ? exchangeRates[cur] : 1;
        const baseRate = exchangeRates && exchangeRates[baseCurrency] ? exchangeRates[baseCurrency] : 1;
        const converted = (initBal / rate) * baseRate;
        total += converted;
        
        if (!split[cur]) split[cur] = 0;
        split[cur] += initBal;
      });
    }

    const endT = currentRange.end ? currentRange.end.getTime() : null;

    transactions.forEach(tx => {
      const txTime = parseISO(tx.date).getTime();
      if (!endT || txTime <= endT) {
        const acc = accounts?.find(a => a.name === tx.account);
        const cur = acc ? (acc.currency || 'USD') : 'USD';
        
        if (tx.type !== 2) { // Income/Expense
          const rate = exchangeRates && exchangeRates[cur] ? exchangeRates[cur] : 1;
          const baseRate = exchangeRates && exchangeRates[baseCurrency] ? exchangeRates[baseCurrency] : 1;
          const converted = (tx.amount / rate) * baseRate;
          total += converted;
          
          if (!split[cur]) split[cur] = 0;
          split[cur] += tx.amount;
        } else if (tx.type === 2) { // Transfer
          const destAcc = accounts?.find(a => a.name === tx.transferTo);
          const destCur = destAcc ? (destAcc.currency || 'USD') : 'USD';
          const destAmt = tx.receivedAmount || Math.abs(tx.amount);
          
          const srcRate = exchangeRates && exchangeRates[cur] ? exchangeRates[cur] : 1;
          const destRate = exchangeRates && exchangeRates[destCur] ? exchangeRates[destCur] : 1;
          const baseRate = exchangeRates && exchangeRates[baseCurrency] ? exchangeRates[baseCurrency] : 1;
          
          total += (tx.amount / srcRate) * baseRate; // source amount (negative)
          total += (destAmt / destRate) * baseRate; // destination amount (positive)
          
          if (!split[cur]) split[cur] = 0;
          split[cur] += tx.amount;
          
          if (!split[destCur]) split[destCur] = 0;
          split[destCur] += destAmt;
          
          if (accBalances[tx.transferTo]) {
            accBalances[tx.transferTo].currentBalance += destAmt;
          }
        }
        
        if (accBalances[tx.account]) {
          accBalances[tx.account].currentBalance += tx.amount;
        }
      }
    });

    return { totalBalance: total, accountBalances: Object.values(accBalances), splitBalances: split };
  }, [transactions, accounts, currentRange, baseCurrency, exchangeRates]);



  const handleAddWidget = (widgetType) => {
    const newWidget = { id: Date.now().toString(), type: widgetType };
    setWidgets([...activeWidgets, newWidget]);
    setIsAddModalOpen(false);
  };

  const handleUpdateWidget = (updatedWidget) => {
    setWidgets(activeWidgets.map(w => w.id === updatedWidget.id ? updatedWidget : w));
  };

  const handleRemoveWidget = (id) => {
    setWidgets(activeWidgets.filter(w => w.id !== id));
  };

  const hasActiveFilters = filterState.excludedCategories.size > 0 || 
    filterState.excludedPayees.size > 0 || 
    filterState.excludedAccounts.size > 0 || 
    filterState.minAmount || 
    filterState.maxAmount;

  return (
    <div className="page-container tx-page">
      <div className="tx-header">
        <h1 className="page-title desktop-only" style={{ margin: 0 }}>Home Page</h1>
        <div className="tx-header-actions">
          <div className="tx-controls">
            <div style={{ flex: '1 1 auto', minWidth: '160px', maxWidth: '250px', marginRight: 'auto' }}>
              <UnifiedDropdown 
                value={selectedPeriod} 
                onChange={(val) => {
                  if (val === 'Custom Range') setShowCustomRangeModal(true);
                  else setSelectedPeriod(val);
                }}
                options={PERIODS.map(p => ({ label: p, value: p }))}
              />
            </div>
            <button 
              className={`icon-btn relative ${hasActiveFilters ? 'active-filter' : ''}`}
              title="Filter" 
              onClick={() => setShowFilterModal(true)}
            >
              <Filter size={20} />
              {hasActiveFilters && <span className="filter-badge"></span>}
            </button>
            <NavLink to="/settings" className="mobile-only icon-btn" title="Settings" style={{ textDecoration: 'none' }}>
              <Settings size={20} />
            </NavLink>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        {/* Top Balance Pill */}
        {displayMode === 'unified' ? (
          <div className="glass-panel total-balance-pill">
            <div className="balance-label">Total Balance</div>
            <div className="balance-amount">{getCurrencySymbol(baseCurrency)}{formatCurrency(totalBalance)}</div>
          </div>
        ) : (
          <div className="glass-panel total-balance-pill split-balance">
            <div className="balance-label">Total Balance (Split)</div>
            <div className="split-balances-container" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '4px' }}>
              {Object.entries(splitBalances).map(([cur, amt]) => (
                <div key={cur} className="split-balance-item" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{cur}</span>
                  <span className="balance-amount" style={{ fontSize: '24px' }}>{getCurrencySymbol(cur)}{formatCurrency(amt)}</span>
                </div>
              ))}
              {Object.keys(splitBalances).length === 0 && (
                <div className="balance-amount">{getCurrencySymbol(baseCurrency)}0</div>
              )}
            </div>
          </div>
        )}

        {/* Horizontal Account List */}
        <div className="accounts-scroller">
          {accountBalances.map(acc => (
            <div key={acc.id} className="glass-panel account-card widget-card-wrapper" style={{ padding: '20px', minHeight: '100px' }}>
              <div className="widget-header" style={{ marginBottom: '8px' }}>
                <div className="account-name">{acc.name}</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="widget-remove-btn" style={{ padding: '2px' }} onClick={() => setEditingAccount({ ...acc, isNew: false })} title="Edit Account">
                    <Edit2 size={14} />
                  </button>
                  <button className="widget-remove-btn" style={{ padding: '2px' }} onClick={() => deleteAccount(acc.id)} title="Delete Account">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="account-balance">{getCurrencySymbol(acc.currency)}{formatCurrency(acc.currentBalance)}</div>
            </div>
          ))}
          <div className="add-widget-card" style={{ flexShrink: 0, minWidth: '140px', minHeight: '100px', flexDirection: 'row', gap: '8px', padding: '0 20px' }} onClick={() => setEditingAccount({ isNew: true })}>
            <div className="add-icon-circle" style={{ width: '40px', height: '40px', color: 'var(--primary-color)' }}><Plus size={20} /></div>
            <span style={{ fontSize: '14px', fontWeight: 500, whiteSpace: 'nowrap' }}>Add Account</span>
          </div>
        </div>

        {/* Widgets Grid */}
        <div className="dashboard-widgets-grid">
          {activeWidgets.map(widget => (
            <DashboardWidgetCard 
              key={widget.id} 
              widget={widget} 
              onUpdate={handleUpdateWidget}
              onRemove={() => handleRemoveWidget(widget.id)}
              transactions={fullyFiltered}
              advancedFilteredTransactions={advancedFiltered}
              accounts={accounts}
              dateRange={currentRange}
            />
          ))}
          {activeWidgets.length < WIDGET_TYPES.length && (
            <div className="add-widget-card" onClick={() => setIsAddModalOpen(true)}>
              <div className="add-icon-circle" style={{ color: 'var(--primary-color)' }}><Plus size={32} /></div>
              <span>Add Widget</span>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showCustomRangeModal && (
          <UnifiedCalendar
            initialRange={customRange}
            onSave={(range) => { setCustomRange(range); setSelectedPeriod('Custom Range'); setShowCustomRangeModal(false); }}
            onClose={() => setShowCustomRangeModal(false)}
          />
        )}
        {showFilterModal && (
          <FilterModal
            transactions={transactions}
            initialState={filterState}
            onApply={(newState) => {
              setFilterState(newState);
              setShowFilterModal(false);
            }}
            onClose={() => setShowFilterModal(false)}
          />
        )}
        {isAddModalOpen && (
          <AddDashboardWidgetModal
            onClose={() => setIsAddModalOpen(false)}
            onAdd={handleAddWidget}
            activeWidgets={activeWidgets}
          />
        )}
        {editingAccount && (
          <EditItemModal 
            item={editingAccount} 
            type="Account"
            onSave={saveAccount}
            onClose={() => setEditingAccount(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
