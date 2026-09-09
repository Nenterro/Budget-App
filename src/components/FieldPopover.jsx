import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { formatAmountInput } from '../utils/format';
import './FieldPopover.css';

/**
 * The focused-field overlay used by the transaction form.
 *
 * Lifted out of AddTransactionModal so the review queue can use the same one
 * rather than an approximation of it. Two forms that create the same kind of
 * record should not have two different ways of picking a category, and a copy
 * would have drifted the moment either was touched.
 *
 * Tapping a field pops this over the panel: a search box that filters the
 * existing items, offers to create whatever was typed if nothing matches, and
 * for the amount field accepts arithmetic on the way through.
 */

/** Phone-width layouts swap dropdowns for tap-to-focus fields. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 767
  );
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 767);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}

/**
 * A read-only field that opens the popover when tapped.
 *
 * `.tap-field-group` carries the same floating-label treatment as the form's
 * own `.form-group`, defined alongside the popover so both modals get it from
 * whichever chunk loads first.
 */
export function TapField({ label, value, icon: Icon, onOpen, compact = false }) {
  const hasValue = value && String(value).trim().length > 0;
  return (
    <div className="tap-field-group" style={{ minWidth: 0, flex: 1 }}>
      {hasValue && <label>{label}</label>}
      <div
        className="input-with-icon"
        onClick={onOpen}
        style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px' }}
      >
        <Icon
          size={compact ? 16 : 18}
          className="input-icon"
          style={{ color: hasValue ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        />
        <div
          style={{
            paddingLeft: '40px', paddingRight: '12px', height: '46px',
            display: 'flex', alignItems: 'center',
            color: hasValue ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: compact ? '13px' : '15px',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'
          }}
        >
          {hasValue ? value : label}
        </div>
      </div>
    </div>
  );
}

export default function FieldPopover({
  field, onClose, items = [], onSelect, onAdd, initialValue, onSaveValue
}) {
  const isAutocomplete = field === 'category' || field === 'payee'
    || field === 'account' || field === 'transferTo';

  // Autocomplete starts empty to show all options. Text fields start with initialValue.
  const [query, setQuery] = useState(isAutocomplete ? '' : (initialValue || ''));

  const filtered = isAutocomplete
    ? items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
    : [];
  const exactMatch = isAutocomplete
    ? items.find(item => item.name.toLowerCase() === query.trim().toLowerCase())
    : null;

  const executeApply = () => {
    if (!isAutocomplete) {
      onSaveValue(query);
      onClose();
    } else if (exactMatch) {
      onSelect(exactMatch.name);
    } else if (query.trim()) {
      onSelect(query.trim());
    } else {
      onClose(); // Empty query cancels
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeApply();
    }
  };

  return (
    <div className="popped-overlay" onClick={executeApply}>
      <div className="popped-container glass-panel" onClick={e => e.stopPropagation()}>
        <div className="popped-header">
          {field === 'account' || field === 'transferTo' ? (
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', padding: '8px', flex: 1 }}>
              Select Account
            </div>
          ) : (
            <input
              className="popped-input"
              placeholder={
                field === 'amount' ? 'Enter amount (e.g. 50+20)...'
                  : field === 'note' ? 'Enter note...'
                  : `Search or add ${field}...`
              }
              value={query}
              onChange={e => setQuery(field === 'amount' ? formatAmountInput(e.target.value) : e.target.value)}
              onKeyDown={handleKeyDown}
              type="text"
              inputMode={field === 'amount' ? 'decimal' : 'text'}
              autoFocus
            />
          )}
        </div>

        {isAutocomplete && (
          <div className="popped-list">
            {query.trim() && !exactMatch && (
              <button className="popped-item add-new-row" onClick={() => onAdd(query.trim())} type="button">
                <div className="popped-icon-wrap add-icon"><Plus size={18} /></div>
                <span>Add "{query.trim()}"</span>
              </button>
            )}
            {filtered.map(item => (
              <button key={item.id || item.name} className="popped-item" onClick={() => onSelect(item.name)} type="button">
                <span>{item.name}</span>
              </button>
            ))}
            {filtered.length === 0 && !query.trim() && (
              <div className="popped-item" style={{ color: 'var(--text-secondary)' }}>No items found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
