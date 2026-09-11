import { useState, useEffect, useMemo } from 'react';
import { Plus, Filter, Settings, Home } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import StatCard from '../components/Stats/StatCard';
import AddStatModal, { STAT_TYPES } from '../components/Stats/AddStatModal';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { useData } from '../context/DataContext';
import { getCurrencySymbol } from '../utils/format';
import { resolvePeriodRange, isWithinRange, PERIODS } from '../utils/periodRange';
import './Stats.css';
import '../pages/Transactions.css'; // Reuse top bar styles

import { usePageSettings, useAppearanceSettings } from '../context/SettingsContext';

export default function Stats() {
  const { transactions, accounts, categories, payees } = useData();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Independent Page Filter state
  const {
    selectedPeriod, setSelectedPeriod,
    customRange, setCustomPeriodRange,
    filterState, setFilterState,
    activeStats, setActiveStats
  } = usePageSettings('stats');

  const { baseCurrency } = useAppearanceSettings();
  // Shown on the filter modal's amount fields instead of a hardcoded $.
  const filterCurrencySymbol = getCurrencySymbol(baseCurrency);

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

  const handleAddStat = (statType) => {
    const newStat = { id: Date.now().toString(), type: statType };
    setActiveStats([...activeStats, newStat]);
    setIsAddModalOpen(false);
  };

  const handleUpdateStat = (updated) => {
    setActiveStats(activeStats.map(w => w.id === updated.id ? updated : w));
  };

  const handleRemoveStat = (id) => {
    setActiveStats(activeStats.filter(w => w.id !== id));
  };

  // A stat has no per-instance settings, so the same one twice is just a
  // duplicate tile. Types already on the board drop out of the picker, and once
  // there is nothing left to pick the Add card goes away with them.
  const usedStatTypes = useMemo(() => activeStats.map(s => s.type), [activeStats]);
  const allStatsAdded = STAT_TYPES.every(type => usedStatTypes.includes(type.id));

  const hasActiveFilters = filterState.excludedCategories.size > 0 ||
    filterState.excludedPayees.size > 0 ||
    filterState.excludedAccounts.size > 0 ||
    filterState.minAmount ||
    filterState.maxAmount;

  return (
    <div className="page-container tx-page">
      <div className="tx-header">
        <h1 className="page-title desktop-only" style={{ margin: 0 }}>Statistics</h1>

        <div className="tx-header-actions">
          <div className="tx-controls">
            <NavLink to="/" className="mobile-only icon-btn" title="Home" style={{ textDecoration: 'none' }}>
              <Home size={20} />
            </NavLink>
            <div style={{ flex: '1 1 auto', minWidth: '160px', maxWidth: '250px', marginRight: 'auto' }}>
              <UnifiedDropdown
                value={selectedPeriod}
                onChange={(val) => {
                  if (val === 'Custom Range') {
                    setShowCustomRangeModal(true);
                  } else {
                    setSelectedPeriod(val);
                  }
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
              {hasActiveFilters && (
                <span className="filter-badge"></span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="stats-dashboard">
        {activeStats.map((stat) => (
          <StatCard
            key={stat.id}
            stat={stat}
            onRemove={() => handleRemoveStat(stat.id)}
            transactions={fullyFiltered}
            advancedFilteredTransactions={advancedFiltered}
            accounts={accounts}
            dateRange={currentRange}
          />
        ))}

        {!allStatsAdded && (
          <div className="add-stat-card" onClick={() => setIsAddModalOpen(true)}>
            <div className="add-stat-icon">
              <Plus size={32} />
            </div>
            <h3>Add Stat</h3>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <AddStatModal
            onClose={() => setIsAddModalOpen(false)}
            onAdd={handleAddStat}
            usedTypes={usedStatTypes}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCustomRangeModal && (
          <UnifiedCalendar
            mode="range"
            value={customRange}
            onChange={(range) => setCustomPeriodRange(range)}
            onClose={() => setShowCustomRangeModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFilterModal && (
          <FilterModal
            title="Filter Stats"
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
      </AnimatePresence>
    </div>
  );
}
