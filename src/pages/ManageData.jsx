import { useState } from 'react';
import { useData } from '../context/DataContext';
import { ArrowLeft, Plus, Edit2, Trash2, Tag, Wallet, User, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import ModalWrapper from '../components/ModalWrapper';
import UnifiedColorPicker from '../components/UnifiedColorPicker';
import UnifiedDropdown from '../components/UnifiedDropdown';
import IconPicker, { CATEGORY_ICONS } from '../components/IconPicker';
import { CURRENCIES } from '../utils/format';
import CurrencySelector from '../components/CurrencySelector';
import './ManageData.css';

export default function ManageData() {
  const navigate = useNavigate();
  const { type: paramType } = useParams(); // 'categories', 'accounts', 'payees'
  const { accounts, categories, payees, saveAccount, deleteAccount, saveCategory, deleteCategory, savePayee, deletePayee } = useData();
  const [editingItem, setEditingItem] = useState(null);

  const getActiveData = () => {
    switch(paramType) {
      case 'categories': return { items: categories, save: saveCategory, del: deleteCategory, icon: Tag, type: 'Category', title: 'Categories' };
      case 'accounts': return { items: accounts, save: saveAccount, del: deleteAccount, icon: Wallet, type: 'Account', title: 'Accounts' };
      case 'payees': return { items: payees, save: savePayee, del: deletePayee, icon: User, type: 'Payee', title: 'Payees' };
      default: return { items: [], save: () => {}, del: () => {}, icon: Tag, type: '', title: '' };
    }
  };

  const { items, save, del, icon: Icon, type, title } = getActiveData();

  return (
    <div className="page-container manage-data-page">
      <div className="manage-header">
        <button className="back-btn" onClick={() => navigate('/settings')}><ArrowLeft size={24} /></button>
        <h1>Manage {title}</h1>
      </div>

      <div className="manage-content">
        <button className="add-item-btn" onClick={() => setEditingItem({ isNew: true })}>
          <Plus size={20} /> Add New {type}
        </button>

        <div className="data-item-list">
          {items.map(item => {
            const ItemIcon = (paramType === 'categories' && item.iconName && CATEGORY_ICONS[item.iconName]) 
                             ? CATEGORY_ICONS[item.iconName] 
                             : Icon;
            
            return (
              <div key={item.id} className="data-item-card">
                <div className="item-info">
                  <div className="item-icon-wrap" style={{ backgroundColor: `${item.color || '#64B5F6'}26`, color: item.color || '#64B5F6' }}>
                    <ItemIcon size={20} />
                  </div>
                  <div className="item-details">
                    <span className="item-name">{item.name}</span>
                    {paramType === 'accounts' && <span className="item-currency">{item.currency}</span>}
                  </div>
                </div>
                <div className="item-actions">
                  <button className="action-btn edit" onClick={() => setEditingItem({ ...item, isNew: false })}><Edit2 size={18} /></button>
                  <button className="action-btn delete" onClick={() => del(item.id)}><Trash2 size={18} /></button>
                </div>
              </div>
            );
          })}
          {items.length === 0 && <p className="empty-state">No {type.toLowerCase()}s found.</p>}
        </div>
      </div>

      <AnimatePresence>
        {editingItem && (
          <EditItemModal 
            item={editingItem} 
            type={type}
            onSave={save}
            onClose={() => setEditingItem(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function EditItemModal({ item, type, onSave, onClose }) {
  const [name, setName] = useState(item.name || '');
  const [color, setColor] = useState(item.color || '#6366f1');
  const [currency, setCurrency] = useState(item.currency || 'PKR');
  const [iconName, setIconName] = useState(item.iconName || 'Tag');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    const payload = { ...item };
    delete payload.isNew;
    payload.name = name.trim();
    payload.color = color;
    if (type === 'Account') {
      payload.currency = currency;
    }
    if (type === 'Category') {
      payload.iconName = iconName;
    }
    
    onSave(payload);
    onClose();
  };

  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content manage-modal glass-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item.isNew ? 'Add' : 'Edit'} {type}</h2>
          <button className="close-btn" onClick={onClose}><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="manage-form">
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
            <div className="form-group" style={{ zIndex: 10 }}>
              <label>Currency</label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="submit-btn bg-primary">Save</button>
          </div>
        </form>
      </div>
    </ModalWrapper>
  );
}
