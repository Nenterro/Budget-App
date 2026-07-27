import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { CURRENCIES, getCurrencyData } from '../utils/currencies';
import './CurrencySelector.css';

export default function CurrencySelector({ value, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  const selectedCurrency = getCurrencyData(value || 'PKR');
  const [maxHeight, setMaxHeight] = useState(250);
  const [dropDirection, setDropDirection] = useState('down');

  useEffect(() => {
    if (isOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 20;
      const spaceAbove = rect.top - 20;
      
      if (spaceBelow < 250 && spaceAbove > spaceBelow) {
        setDropDirection('up');
        setMaxHeight(Math.max(150, Math.min(250, spaceAbove)));
      } else {
        setDropDirection('down');
        setMaxHeight(Math.max(150, Math.min(250, spaceBelow)));
      }
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCurrencies = useMemo(() => {
    const s = search.toLowerCase();
    return CURRENCIES.filter(c => 
      c.code.toLowerCase().includes(s) || 
      c.name.toLowerCase().includes(s)
    );
  }, [search]);

  return (
    <div className={`currency-selector ${disabled ? 'disabled' : ''}`} ref={wrapperRef}>
      <div 
        className="currency-selected"
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <div className="currency-info">
          <span className="currency-code">{selectedCurrency.code}</span>
          <span className="currency-name">{selectedCurrency.name}</span>
          <span className="currency-symbol-badge">{selectedCurrency.symbol}</span>
        </div>
        <ChevronDown size={16} />
      </div>

      {isOpen && (
        <div 
          className="currency-dropdown glass-panel" 
          style={{ 
            bottom: dropDirection === 'up' ? 'calc(100% + 4px)' : 'auto', 
            top: dropDirection === 'down' ? 'calc(100% + 4px)' : 'auto' 
          }}
        >
          <div className="currency-search" style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <div 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                width: '100%', 
                backgroundColor: 'var(--bg-color)', 
                border: '1px solid var(--border-color)', 
                borderRadius: '8px',
                padding: '0 12px',
                boxSizing: 'border-box'
              }}
              className="search-input-container"
            >
              <Search size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <input 
                type="text" 
                placeholder="Search currency..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{ 
                  flex: 1, 
                  border: 'none', 
                  background: 'transparent', 
                  padding: '0 8px', 
                  height: '40px',
                  color: 'var(--text-primary)', 
                  outline: 'none',
                  fontSize: '14px',
                  boxShadow: 'none',
                  width: '100%',
                  lineHeight: 'normal',
                  margin: 0
                }}
              />
            </div>
          </div>
          <div className="currency-list" style={{ maxHeight: `${maxHeight}px` }}>
            {filteredCurrencies.map(c => (
              <div 
                key={c.code} 
                className={`currency-option ${c.code === value ? 'active' : ''}`}
                onClick={() => {
                  onChange(c.code);
                  setIsOpen(false);
                  setSearch('');
                }}
              >
                <div className="currency-info">
                  <span className="currency-code">{c.code}</span>
                  <span className="currency-name">{c.name}</span>
                  <span className="currency-symbol-badge">{c.symbol}</span>
                </div>
              </div>
            ))}
            {filteredCurrencies.length === 0 && (
              <div className="currency-no-results">No currencies found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
