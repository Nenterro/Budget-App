import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, DollarSign, Tag, User, Wallet, CheckSquare, Square, RefreshCw } from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import './FilterModal.css';

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

const TAB_ORDER = ['Amount', 'Category', 'Payee', 'Account'];
const AMOUNT_HEIGHT = 260;
const LIST_HEIGHT = 400;
// Space taken by the header, tab strip and action row. The body is given a
// fixed pixel height so the slide animation has a stable box, so on a short
// screen it has to be measured against the viewport rather than hardcoded —
// otherwise "Apply Filters" ends up below the fold.
const CHROME_HEIGHT = 210;

function useBodyHeight(activeTab) {
  const preferred = activeTab === 'Amount' ? AMOUNT_HEIGHT : LIST_HEIGHT;
  const [available, setAvailable] = useState(() => window.innerHeight);

  useEffect(() => {
    const onResize = () => setAvailable(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return Math.max(180, Math.min(preferred, available - CHROME_HEIGHT));
}

// The amount fields show the user's own currency rather than a fixed $.
function AmountIcon({ symbol }) {
  if (!symbol) return <DollarSign size={18} className="input-icon" />;
  return (
    <span
      className="input-icon"
      style={{ fontSize: '16px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {symbol}
    </span>
  );
}

function FilterListTab({ title, allItems, excludedSet, setExcludedSet }) {
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    return allItems.filter(item => item.toLowerCase().includes(query.toLowerCase()));
  }, [allItems, query]);

  const handleToggleAll = () => {
    setExcludedSet(new Set());
  };

  const handleToggleNone = () => {
    setExcludedSet(new Set(allItems));
  };

  const toggleItem = (item) => {
    // This is now handled by the mousedown/mouseenter logic, but we keep it here just in case it's called directly
    setExcludedSet(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const dragState = useRef({ isDragging: false, toggledItems: new Set() });

  useEffect(() => {
    const handleMouseUp = () => {
      dragState.current = { isDragging: false, toggledItems: new Set() };
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const handleMouseDown = (item) => {
    dragState.current = { isDragging: true, toggledItems: new Set([item]) };

    setExcludedSet(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const handleMouseEnter = (item) => {
    if (!dragState.current.isDragging) return;
    if (dragState.current.toggledItems.has(item)) return; // Already inverted this item during this drag

    dragState.current.toggledItems.add(item);

    setExcludedSet(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const selectedCount = allItems.length - excludedSet.size;

  return (
    <div className="filter-tab-content filter-list-tab">
      <div className="filter-list-header">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder={`Search ${title}...`}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-list-actions">
        <span className="count-label">{title} ({selectedCount}/{allItems.length})</span>
        <div className="action-buttons">
          <button type="button" onClick={handleToggleAll}><CheckSquare size={16} /> All</button>
          <button type="button" onClick={handleToggleNone}><Square size={16} /> None</button>
        </div>
      </div>

      <div className="filter-list-body">
        {filteredItems.length === 0 ? (
          <div className="empty-state">No items found</div>
        ) : (
          filteredItems.map(item => {
            const isSelected = !excludedSet.has(item);
            return (
              <button
                key={item}
                className={`filter-item ${isSelected ? 'selected' : ''}`}
                onMouseDown={() => handleMouseDown(item)}
                onMouseEnter={() => handleMouseEnter(item)}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
              >
                <div className="checkbox">
                  {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                </div>
                <span>{item}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function FilterModal({
  transactions,
  initialState,
  onApply,
  onClose,
  title = 'Filter',
  // The full lists from the data stores. Deriving options from transactions
  // alone meant a category or account you had just created was missing from
  // the filter until something actually used it.
  categories = [],
  payees = [],
  accounts = [],
  currencySymbol = ''
}) {
  const [activeTab, setActiveTab] = useState('Amount');
  const [direction, setDirection] = useState(0);

  const handleTabChange = (tabId) => {
    const oldIndex = TAB_ORDER.indexOf(activeTab);
    const newIndex = TAB_ORDER.indexOf(tabId);
    setDirection(newIndex > oldIndex ? 1 : -1);
    setActiveTab(tabId);
  };

  const [excludedCategories, setExcludedCategories] = useState(new Set(initialState.excludedCategories));
  const [excludedPayees, setExcludedPayees] = useState(new Set(initialState.excludedPayees));
  const [excludedAccounts, setExcludedAccounts] = useState(new Set(initialState.excludedAccounts));
  const [minAmount, setMinAmount] = useState(initialState.minAmount || '');
  const [maxAmount, setMaxAmount] = useState(initialState.maxAmount || '');

  // Names in use plus names that exist but are not used yet, so nothing is
  // silently unfilterable. Values only present on transactions (imported data,
  // "Unspecified", "Transfer") still appear.
  const mergeNames = (defined, used) =>
    [...new Set([...defined.map(d => d.name).filter(Boolean), ...used.filter(Boolean)])]
      .sort((a, b) => a.localeCompare(b));

  const allCategories = useMemo(
    () => mergeNames(categories, transactions.map(t => t.category)),
    [categories, transactions]
  );
  const allPayees = useMemo(
    () => mergeNames(payees, transactions.map(t => t.payee)),
    [payees, transactions]
  );
  const allAccounts = useMemo(
    () => mergeNames(accounts, transactions.map(t => t.account)),
    [accounts, transactions]
  );

  const bodyHeight = useBodyHeight(activeTab);

  const handleResetAll = () => {
    setExcludedCategories(new Set());
    setExcludedPayees(new Set());
    setExcludedAccounts(new Set());
    setMinAmount('');
    setMaxAmount('');
  };

  const handleApply = () => {
    onApply({
      excludedCategories,
      excludedPayees,
      excludedAccounts,
      minAmount,
      maxAmount
    });
  };

  const tabs = [
    { id: 'Amount', icon: DollarSign },
    { id: 'Category', icon: Tag },
    { id: 'Payee', icon: User },
    { id: 'Account', icon: Wallet },
  ];

  return (
    <ModalWrapper onClose={onClose} zIndex={2000}>
      <div
        className="filter-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="filter-header">
          <h2>{title}</h2>
          <button className="reset-btn" onClick={handleResetAll}>
            <RefreshCw size={16} /> Reset All
          </button>
        </div>

        <div className="filter-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`filter-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.id}</span>
            </button>
          ))}
        </div>

        <div
          className="filter-body"
          style={{
            height: `${bodyHeight}px`,
            transition: 'height 0.25s ease-in-out',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            {activeTab === 'Amount' && (
              <motion.div
                key="amount"
                className="filter-tab-content amount-tab"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                style={{ width: '100%' }}
              >
                <p className="tab-description">
                  Filter by amount size. Expenses and income are both matched on
                  their magnitude, so 500 means &ldquo;500 either way&rdquo;.
                </p>
                <div className="amount-inputs">
                  <div className="form-group">
                    <label>Min Amount</label>
                    <div className="input-with-icon">
                      <AmountIcon symbol={currencySymbol} />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="0"
                        value={minAmount}
                        onChange={e => setMinAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Max Amount</label>
                    <div className="input-with-icon">
                      <AmountIcon symbol={currencySymbol} />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder="10000"
                        value={maxAmount}
                        onChange={e => setMaxAmount(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'Category' && (
              <motion.div
                key="category"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                style={{ width: '100%' }}
              >
                <FilterListTab
                  title="Categories"
                  allItems={allCategories}
                  excludedSet={excludedCategories}
                  setExcludedSet={setExcludedCategories}
                />
              </motion.div>
            )}

            {activeTab === 'Payee' && (
              <motion.div
                key="payee"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                style={{ width: '100%' }}
              >
                <FilterListTab
                  title="Payees"
                  allItems={allPayees}
                  excludedSet={excludedPayees}
                  setExcludedSet={setExcludedPayees}
                />
              </motion.div>
            )}

            {activeTab === 'Account' && (
              <motion.div
                key="account"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
                style={{ width: '100%' }}
              >
                <FilterListTab
                  title="Accounts"
                  allItems={allAccounts}
                  excludedSet={excludedAccounts}
                  setExcludedSet={setExcludedAccounts}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="filter-actions">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button className="apply-btn" onClick={handleApply}>Apply Filters</button>
        </div>
      </div>
    </ModalWrapper>
  );
}

