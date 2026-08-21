import { useState } from 'react';
import { useData } from '../context/DataContext';
import { ArrowLeft, Plus, Edit2, Trash2, Tag, Wallet, User, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import ModalWrapper from '../components/ModalWrapper';
import EditItemModal from '../components/EditItemModal';
import { CATEGORY_ICONS } from '../components/IconPicker';
import './ManageData.css';

export default function ManageData() {
  const navigate = useNavigate();
  const { type: paramType } = useParams(); // 'categories', 'accounts', 'payees'
  const { accounts, categories, payees, saveAccount, deleteAccount, saveCategory, deleteCategory, savePayee, deletePayee, countReferences } = useData();
  const [editingItem, setEditingItem] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // { item, usageCount }

  const getActiveData = () => {
    switch(paramType) {
      case 'categories': return { items: categories, save: saveCategory, del: deleteCategory, icon: Tag, type: 'Category', title: 'Categories', refKind: 'category' };
      case 'accounts': return { items: accounts, save: saveAccount, del: deleteAccount, icon: Wallet, type: 'Account', title: 'Accounts', refKind: 'account' };
      case 'payees': return { items: payees, save: savePayee, del: deletePayee, icon: User, type: 'Payee', title: 'Payees', refKind: 'payee' };
      default: return { items: [], save: () => {}, del: () => {}, icon: Tag, type: '', title: '', refKind: null };
    }
  };

  const { items, save, del, icon: Icon, type, title, refKind } = getActiveData();

  // Deleting used to happen on a single tap with no warning, and transactions
  // referencing the name were left pointing at something that no longer exists.
  const requestDelete = async (item) => {
    const usageCount = refKind ? await countReferences(refKind, item.name) : 0;
    setPendingDelete({ item, usageCount });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await del(pendingDelete.item.id);
    setPendingDelete(null);
  };

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
                  <button className="action-btn delete" onClick={() => requestDelete(item)}><Trash2 size={18} /></button>
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
            existingItems={items}
            onSave={save}
            onClose={() => setEditingItem(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <ModalWrapper onClose={() => setPendingDelete(null)}>
            <div className="modal-content manage-modal glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
              <div className="modal-header">
                <h2>Delete {type}?</h2>
                <button className="close-btn" onClick={() => setPendingDelete(null)}><X size={24} /></button>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{pendingDelete.item.name}</strong>
                {pendingDelete.usageCount > 0
                  ? ` is used by ${pendingDelete.usageCount} transaction${pendingDelete.usageCount === 1 ? '' : 's'}. Those transactions keep the name as plain text but stop being linked to this ${type.toLowerCase()}. Renaming it instead keeps them connected.`
                  : ` is not used by any transaction. This cannot be undone.`}
              </p>
              <div className="modal-actions" style={{ marginTop: '20px' }}>
                <button type="button" className="cancel-btn" onClick={() => setPendingDelete(null)}>Cancel</button>
                <button
                  type="button"
                  className="submit-btn"
                  style={{ background: '#ef4444', color: '#fff', border: 'none' }}
                  onClick={confirmDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          </ModalWrapper>
        )}
      </AnimatePresence>
    </div>
  );
}


// Re-exported so existing imports of `{ EditItemModal }` from this page keep
// resolving.
export { EditItemModal };
