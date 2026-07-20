import { useState, useEffect, useMemo } from 'react';
import { Plus, Filter, Settings } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { NavLink } from 'react-router-dom';
import ChartCard from '../components/Graphs/ChartCard';
import AddGraphModal from '../components/Graphs/AddGraphModal';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { useData } from '../context/DataContext';
import { usePageSettings } from '../context/SettingsContext';
import { format, startOfMonth, subMonths, endOfMonth, subDays, startOfYear, isAfter, isBefore, parseISO } from 'date-fns';
import './Graphs.css';
import '../pages/Transactions.css'; // Reuse top bar styles

const PERIODS = ['All Time', 'This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Custom Range'];
export default function Graphs() {
  const { transactions, accounts } = useData();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Independent Page Filter state
  const { 
    selectedPeriod, setSelectedPeriod, 
    customRange, setCustomRange, 
    filterState, setFilterState,
    activeGraphs, setActiveGraphs
  } = usePageSettings('graphs');
  
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
            <NavLink to="/settings" className="mobile-only icon-btn" title="Settings" style={{ textDecoration: 'none' }}>
              <Settings size={20} />
            </NavLink>
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

        <div className="add-graph-card" onClick={() => setIsAddModalOpen(true)}>
          <div className="add-graph-icon">
            <Plus size={32} />
          </div>
          <h3>Add Graph</h3>
          <span style={{ fontSize: '14px' }}>Choose a metric to visualize</span>
        </div>
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <AddGraphModal 
            onClose={() => setIsAddModalOpen(false)} 
            onAdd={handleAddGraph} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCustomRangeModal && (
          <UnifiedCalendar 
            mode="range"
            value={customRange}
            onChange={(range) => {
              setCustomRange(range);
              setSelectedPeriod('Custom Range');
            }}
            onClose={() => setShowCustomRangeModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
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
      </AnimatePresence>
    </div>
  );
}
