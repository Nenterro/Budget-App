import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useData } from '../context/DataContext';
import { Filter, Settings, Plus, Edit2, Trash2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { usePageSettings, useAppearanceSettings } from '../context/SettingsContext';
// The widget cards pull in recharts (~400 kB). Loading them on demand lets the
// balance header and the rest of the page paint without waiting on it.
const DashboardWidgetCard = lazy(() => import('../components/Dashboard/DashboardWidgets'));
import AddDashboardWidgetModal, { WIDGET_TYPES } from '../components/Dashboard/AddDashboardWidgetModal';
import EditItemModal from '../components/EditItemModal';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { resolvePeriodRange, isWithinRange, PERIODS } from '../utils/periodRange';
import { computeBalances } from '../utils/balances';
import './Dashboard.css';
import '../pages/Transactions.css'; // For top header styles


export default function Dashboard() {
  const { transactions, accounts, saveAccount, deleteAccount, categories, payees, budgets } = useData();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  // Independent Page Filter state
  const {
    selectedPeriod, setSelectedPeriod,
    customRange, setCustomPeriodRange,
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
    // Magnitude, not signed value: expenses are stored negative, so a signed
    // comparison against "min 100" silently excluded every expense there is.
    if (filterState.minAmount !== '' && filterState.minAmount !== null) {
      const min = Math.abs(parseFloat(filterState.minAmount));
      if (!isNaN(min)) advancedResult = advancedResult.filter(tx => Math.abs(tx.amount) >= min);
    }
    if (filterState.maxAmount !== '' && filterState.maxAmount !== null) {
      const max = Math.abs(parseFloat(filterState.maxAmount));
      if (!isNaN(max)) advancedResult = advancedResult.filter(tx => Math.abs(tx.amount) <= max);
    }

    let fullyResult = advancedResult;
    // Whole-day, inclusive, and identical on every page — see
    // src/utils/periodRange.js for why the end of a period is not `new Date()`.
    const computedRange = resolvePeriodRange(selectedPeriod, customRange);
    if (computedRange.start) {
      fullyResult = advancedResult.filter(tx => isWithinRange(tx.date, computedRange));
    }
    return { fullyFiltered: fullyResult, advancedFiltered: advancedResult, currentRange: computedRange };
  }, [transactions, selectedPeriod, filterState, customRange]);

  const { baseCurrency, displayMode } = useAppearanceSettings();
  const { exchangeRates } = useData();
  // Shown on the filter modal's amount fields instead of a hardcoded $.
  const filterCurrencySymbol = getCurrencySymbol(baseCurrency);

  // No date range here, deliberately — see src/utils/balances.js. The period
  // picker and the filters above drive the widgets below, not the balances.
  const { totalBalance, accountBalances, splitBalances } = useMemo(
    () => computeBalances({ transactions, accounts, baseCurrency, exchangeRates }),
    [transactions, accounts, baseCurrency, exchangeRates]
  );



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
          <Suspense fallback={null}>
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
          </Suspense>
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
            mode="range"
            value={customRange}
            onChange={(range) => setCustomPeriodRange(range)}
            onClose={() => setShowCustomRangeModal(false)}
          />
        )}
        {showFilterModal && (
          <FilterModal
            title="Filter Home"
            transactions={transactions}
            categories={categories}
            payees={payees}
            accounts={accounts}
            currencySymbol={filterCurrencySymbol}
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
