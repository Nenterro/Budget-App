import { useState } from 'react';
import { X } from 'lucide-react';
import ModalWrapper from './ModalWrapper';
import UnifiedColorPicker from './UnifiedColorPicker';
import IconPicker from './IconPicker';
import CurrencySelector from './CurrencySelector';
import { ACCOUNT_KINDS } from '../utils/accounts';
import '../pages/ManageData.css';

// Lives here rather than inside pages/ManageData so the Dashboard (which also
// edits accounts) can use it without dragging the whole settings page — and its
// lazily loaded route chunk — into the startup bundle.
export default function EditItemModal({ item, type, existingItems = [], onSave, onClose }) {
  const [name, setName] = useState(item.name || '');
  const [color, setColor] = useState(item.color || '#6366f1');
  const [currency, setCurrency] = useState(item.currency || 'PKR');
  const [iconName, setIconName] = useState(item.iconName || 'Tag');
  const [kind, setKind] = useState(item.kind || ACCOUNT_KINDS.standard);
  const [creditLimit, setCreditLimit] = useState(item.creditLimit ? String(item.creditLimit) : '');

  const trimmed = name.trim();
  const isRename = !item.isNew && item.name && trimmed && trimmed !== item.name;
  // Two entries sharing a name are indistinguishable to every transaction that
  // references them, so they are worth refusing outright.
  const isDuplicate = trimmed.length > 0 && existingItems.some(
    other => other.id !== item.id && (other.name || '').toLowerCase() === trimmed.toLowerCase()
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!trimmed || isDuplicate) return;

    const payload = { ...item };
    delete payload.isNew;
    payload.name = trimmed;
    payload.color = color;
    if (type === 'Account') {
      payload.currency = currency;
      payload.kind = kind;
      // The Dashboard opens this with the computed balance spread onto the
      // account; that is derived, and must not be saved back as if it were data.
      delete payload.currentBalance;
      const limit = Number(String(creditLimit).replace(/,/g, ''));
      if (kind === ACCOUNT_KINDS.credit && limit > 0) payload.creditLimit = limit;
      else delete payload.creditLimit;
    }
    if (type === 'Category') {
      payload.iconName = iconName;
    }

    onSave(payload);
    onClose();
  };

  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content manage-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item.isNew ? 'Add' : 'Edit'} {type}</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={20} /></button>
        </div>

        <form id="edit-item-form" onSubmit={handleSubmit} className="manage-form">
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`e.g. ${type === 'Account' ? 'Meezan Bank' : 'Groceries'}`}
              required
              autoFocus
            />
            {isDuplicate && (
              <small style={{ color: '#ef4444', marginTop: '6px', display: 'block' }}>
                Another {type.toLowerCase()} already uses this name.
              </small>
            )}
            {isRename && !isDuplicate && (
              <small style={{ color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>
                Existing transactions using "{item.name}" will be updated to "{trimmed}".
              </small>
            )}
          </div>

          <div className="form-group">
            <label>Color</label>
            <UnifiedColorPicker color={color} onChange={setColor} />
          </div>

          {type === 'Category' && (
            <div className="form-group">
              <label>Icon</label>
              <IconPicker iconName={iconName} onChange={setIconName} />
            </div>
          )}

          {type === 'Account' && (
            <div className="form-group">
              <label>Type</label>
              <div className="segmented">
                <button type="button" className={`segment ${kind !== ACCOUNT_KINDS.credit ? 'active' : ''}`} onClick={() => setKind(ACCOUNT_KINDS.standard)}>
                  Bank / Cash
                </button>
                <button type="button" className={`segment ${kind === ACCOUNT_KINDS.credit ? 'active' : ''}`} onClick={() => setKind(ACCOUNT_KINDS.credit)}>
                  Credit Card
                </button>
              </div>
              {kind === ACCOUNT_KINDS.credit && (
                <small style={{ color: 'var(--text-secondary)', marginTop: '6px', display: 'block' }}>
                  Shows what you owe instead of a negative balance. Pay the bill with a transfer into this account.
                </small>
              )}
            </div>
          )}

          {type === 'Account' && kind === ACCOUNT_KINDS.credit && (
            <div className="form-group">
              <label>Credit Limit (optional)</label>
              <input
                type="text"
                inputMode="decimal"
                value={creditLimit}
                onChange={e => setCreditLimit(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="e.g. 200,000"
              />
            </div>
          )}

          {type === 'Account' && (
            <div className="form-group" style={{ zIndex: 10 }}>
              <label>Currency</label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>
          )}

        </form>

        <div className="modal-footer">
          <button type="button" className="cancel-btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="edit-item-form" className="submit-btn" disabled={!trimmed || isDuplicate}>Save</button>
        </div>
      </div>
    </ModalWrapper>
  );
}
