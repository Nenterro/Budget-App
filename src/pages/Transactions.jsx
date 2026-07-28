import { useState, useMemo, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useData } from '../context/DataContext';
import { 
  Search, Filter, Users, Plus, Edit2, Trash2, Settings,
  ShoppingBag, Tv, Coffee, Car, Home, Receipt, ArrowRightLeft, Box 
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { 
  format, isToday, isYesterday, startOfMonth, subMonths, endOfMonth, 
  subDays, startOfYear, isAfter, isBefore, parseISO 
} from 'date-fns';
import { ErrorBoundary } from '../components/ErrorBoundary';
import './Transactions.css';

const PERIODS = ['All Time', 'This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Custom Range'];

const getCategoryDetails = (category, type) => {
  const cat = (category || '').toLowerCase();
  if (type === 'transfer' || type === 2) return { icon: ArrowRightLeft, color: '#a855f7' };
  if (cat.includes('food') || cat.includes('grocer') || cat.includes('coffee')) return { icon: Coffee, color: '#f59e0b' };
  if (cat.includes('shop') || cat.includes('cloth')) return { icon: ShoppingBag, color: '#ec4899' };
  if (cat.includes('transport') || cat.includes('gas') || cat.includes('car')) return { icon: Car, color: '#3b82f6' };
  if (cat.includes('home') || cat.includes('rent') || cat.includes('util')) return { icon: Home, color: '#8b5cf6' };
  if (cat.includes('entertain') || cat.includes('movie') || cat.includes('tv')) return { icon: Tv, color: '#14b8a6' };
  if (cat.includes('bill') || cat.includes('fee')) return { icon: Receipt, color: '#ef4444' };
  return { icon: Box, color: '#6366f1' };
};

import AddTransactionModal from '../components/AddTransactionModal';
import UnifiedDropdown from '../components/UnifiedDropdown';
import UnifiedCalendar from '../components/UnifiedCalendar';
import FilterModal from '../components/FilterModal';
import { usePageSettings } from '../context/SettingsContext';

export default function Transactions() {
  const { transactions, deleteTransaction, accounts } = useData();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Independent Page Filter state
  const { selectedPeriod, setSelectedPeriod, customRange, setCustomRange, filterState, setFilterState } = usePageSettings('transactions');
  
  const [showCustomRangeModal, setShowCustomRangeModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [openTxId, setOpenTxId] = useState(null);

  // Click away to close action menu
  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!e.target.closest('.tx-row')) {
        setOpenTxId(null);
      }
    };
    if (openTxId) {
      document.addEventListener('click', handleGlobalClick);
    }
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [openTxId]);

  // Filter Logic
  const filteredTransactions = useMemo(() => {
    let flattened = [];
    transactions.forEach(tx => {
      if (tx.splits && tx.splits.length > 0 && tx.type !== 2) {
        tx.splits.forEach(s => {
          flattened.push({
            ...tx,
            originalTx: tx,
            isSplitChild: true,
            id: `${tx.id}-${s.id}`,
            amount: s.amount,
            category: s.category || 'Unspecified',
            payee: s.payee || 'Unspecified',
            account: s.account || tx.account
          });
        });
      } else {
        flattened.push({ ...tx, originalTx: tx });
      }
    });
    
    let result = flattened;
    const now = new Date();

    // 1. Period Filter
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

      result = result.filter(tx => {
        const d = parseISO(tx.date);
        return isAfter(d, start) && isBefore(d, end);
      });
    }

    // 2. Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(tx => 
        (tx.payee && tx.payee.toLowerCase().includes(q)) ||
        (tx.category && tx.category.toLowerCase().includes(q)) ||
        (tx.account && tx.account.toLowerCase().includes(q)) ||
        (tx.note && tx.note.toLowerCase().includes(q))
      );
    }

    // 3. Advanced Filters (from FilterModal)
    if (filterState.excludedCategories.size > 0) {
      result = result.filter(tx => !filterState.excludedCategories.has(tx.category));
    }
    if (filterState.excludedPayees.size > 0) {
      result = result.filter(tx => !filterState.excludedPayees.has(tx.payee));
    }
    if (filterState.excludedAccounts.size > 0) {
      result = result.filter(tx => !filterState.excludedAccounts.has(tx.account));
    }
    if (filterState.minAmount !== '' && filterState.minAmount !== null) {
      const min = parseFloat(filterState.minAmount);
      result = result.filter(tx => tx.amount >= min);
    }
    if (filterState.maxAmount !== '' && filterState.maxAmount !== null) {
      const max = parseFloat(filterState.maxAmount);
      result = result.filter(tx => tx.amount <= max);
    }

    return result;
  }, [transactions, selectedPeriod, searchQuery, filterState, customRange]);

  // Grouping Logic
  const groupedTransactions = useMemo(() => {
    const groups = {};
    filteredTransactions.forEach(tx => {
      const d = parseISO(tx.date);
      const key = format(d, 'yyyy-MM-dd');
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    // Sort keys descending
    return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(key => ({
      dateString: key,
      transactions: groups[key]
    }));
  }, [filteredTransactions]);

  const formatDateHeader = (dateStr) => {
    const d = parseISO(dateStr);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, 'EEEE, MMM d, yyyy');
  };

  const hasActiveFilters = filterState.excludedCategories.size > 0 || 
    filterState.excludedPayees.size > 0 || 
    filterState.excludedAccounts.size > 0 || 
    filterState.minAmount || 
    filterState.maxAmount;

  return (
    <div className="page-container tx-page">
      {/* Header */}
      <div className="tx-header">
        <h1 className="page-title desktop-only" style={{ margin: 0 }}>Transactions</h1>
        
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
            <button className="icon-btn group-btn"><Users size={20} /></button>
          </div>

          <div className="tx-search-bar">
            <Search size={18} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search transactions..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="tx-list">
        {groupedTransactions.length === 0 ? (
          <div className="empty-state">
            <Search size={48} className="empty-icon" />
            <p>No transactions found</p>
          </div>
        ) : (
          groupedTransactions.map(group => (
            <div key={group.dateString} className="tx-group">
              <h3 className="tx-date-header">{formatDateHeader(group.dateString)}</h3>
              
              <div className="tx-group-items">
                {group.transactions.map(tx => {
                  const { icon: Icon, color } = getCategoryDetails(tx.category, tx.type);

                  return (
                    <div key={tx.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '12px' }}>
                      <div 
                        className="tx-row glass-panel"
                        style={{ marginBottom: 0 }}
                      >
                        <div className="tx-icon" style={{ backgroundColor: `${color}33`, color: color }}>
                          <Icon size={18} />
                        </div>
                        
                        <div className="tx-main">
                          <div className="tx-payee">
                            {tx.payee || 'Unspecified'}
                            {tx.isSplitChild && <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px', color: 'var(--text-secondary)' }}>SPLIT PART</span>}
                          </div>
                          <div className="tx-meta">
                            <span className="tx-category" style={{ color: color }}>{tx.category}</span>
                            <span className="tx-dot">•</span>
                            <span className="tx-account">{tx.account}</span>
                          </div>
                          {tx.note && <div className="tx-note">{tx.note}</div>}
                        </div>

                        <div className="tx-right">
                          <div className={`tx-amount ${tx.type === 0 || tx.type === 'expense' ? 'expense' : tx.type === 1 || tx.type === 'income' ? 'income' : 'transfer'}`}>
                            {getCurrencySymbol(accounts?.find(a => a.name === tx.account)?.currency || tx.currency)}{formatCurrency(Math.abs(tx.amount))}
                            {(tx.type === 2 || tx.type === 'transfer') && tx.receivedAmount && (
                              <span style={{ fontSize: '11px', opacity: 0.7, display: 'block', marginTop: '2px', color: 'var(--text-secondary)' }}>
                                → {getCurrencySymbol(accounts.find(a => a.name === tx.transferTo)?.currency)}{formatCurrency(tx.receivedAmount)}
                              </span>
                            )}
                          </div>
                          <div className="tx-actions">
                            <button 
                              className="action-btn edit" 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setEditingTx(tx.originalTx); 
                              }} 
                              title="Edit"
                            ><Edit2 size={16} /></button>
                            <button 
                              className="action-btn delete" 
                              onClick={(e) => { e.stopPropagation(); deleteTransaction(tx.originalTx.id); }} 
                              title="Delete"
                            ><Trash2 size={16} /></button>
                          </div>
                        </div>
                      </div>


                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

        <ErrorBoundary fallback={<div>Something went wrong loading the form.</div>}>
          <AnimatePresence>
            {!!editingTx && (
              <AddTransactionModal 
                isOpen={!!editingTx} 
                onClose={() => setEditingTx(null)} 
                initialData={editingTx} 
              />
            )}
          </AnimatePresence>
        </ErrorBoundary>
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
