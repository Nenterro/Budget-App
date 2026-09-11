import { useState, useEffect, useMemo } from 'react';
import { Plus, Filter, Settings, Home } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import ChartCard from '../components/Graphs/ChartCard';
import AddGraphModal, { GRAPH_TYPES } from '../components/Graphs/AddGraphModal';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { useData } from '../context/DataContext';
import { getCurrencySymbol } from '../utils/format';
import { usePageSettings, useAppearanceSettings } from '../context/SettingsContext';
import { resolvePeriodRange, isWithinRange, PERIODS } from '../utils/periodRange';
import './Graphs.css';
import '../pages/Transactions.css'; // Reuse top bar styles

export default function Graphs() {
  const { transactions, accounts, categories, payees } = useData();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Independent Page Filter state
  const {
    selectedPeriod, setSelectedPeriod,
    customRange, setCustomPeriodRange,
    filterState, setFilterState,
    activeGraphs, setActiveGraphs
  } = usePageSettings('graphs');

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

  const handleAddGraph = (type, symbol) => {
    const newGraph = { id: Date.now().toString(), type, symbol };
    setActiveGraphs([...activeGraphs, newGraph]);
    setIsAddModalOpen(false);
  };

  const handleUpdateGraph = (updated) => {
    setActiveGraphs(activeGraphs.map(w => w.id === updated.id ? updated : w));
  };

  const handleRemoveGraph = (id) => {
    setActiveGraphs(activeGraphs.filter(w => w.id !== id));
  };

  // A graph has no per-instance settings, so the same one twice draws the same
  // chart. Types already on the board drop out of the picker, and once there is
  // nothing left to pick the Add card goes away with them.
  const usedGraphTypes = useMemo(() => activeGraphs.map(g => g.type), [activeGraphs]);
  const allGraphsAdded = GRAPH_TYPES.every(type => usedGraphTypes.includes(type.id));

  const hasActiveFilters = filterState.excludedCategories.size > 0 ||
    filterState.excludedPayees.size > 0 ||
    filterState.excludedAccounts.size > 0 ||
    filterState.minAmount ||
    filterState.maxAmount;

  return (
    <div className="page-container tx-page">
      <div className="tx-header">
        <h1 className="page-title desktop-only" style={{ margin: 0 }}>Graphs</h1>

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

      <div className="graphs-dashboard">
        {activeGraphs.map((graph) => (
          <ChartCard
            key={graph.id}
            graph={graph}
            onRemove={() => handleRemoveGraph(graph.id)}
            transactions={fullyFiltered}
            advancedFilteredTransactions={advancedFiltered}
            accounts={accounts}
            dateRange={currentRange}
          />
        ))}

        {!allGraphsAdded && (
          <div className="add-graph-card" onClick={() => setIsAddModalOpen(true)}>
            <div className="add-graph-icon">
              <Plus size={32} />
            </div>
            <h3>Add Graph</h3>
            <span style={{ fontSize: '14px' }}>Choose a metric to visualize</span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <AddGraphModal
            onClose={() => setIsAddModalOpen(false)}
            onAdd={handleAddGraph}
            usedTypes={usedGraphTypes}
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
            title="Filter Graphs"
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
