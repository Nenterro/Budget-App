import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../context/DataContext';
import { useAppearanceSettings } from '../context/SettingsContext';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { X, Plus, Trash2, Target, Check, Edit2 } from 'lucide-react';
import UnifiedDropdown from './UnifiedDropdown';
import { motion, AnimatePresence } from 'framer-motion';

export default function ManageGoalsModal({ isOpen, onClose, budgetData }) {
  const { categories, saveCategory } = useData();
  const { baseCurrency } = useAppearanceSettings();
  
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCat, setSelectedCat] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState('');

  if (!isOpen) return null;

  const categoriesWithGoals = categories.filter(c => {
    if (c.target > 0) return true;
    if (budgetData && budgetData.categories) {
      const budgetCat = budgetData.categories.find(bc => bc.id === c.id);
      if (budgetCat && budgetCat.assigned > 0) return true;
    }
    return false;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const availableCategories = categories.filter(c => !categoriesWithGoals.find(g => g.id === c.id));

  const handleAddGoal = async () => {
    if (!selectedCat || !targetAmount) return;
    const cat = categories.find(c => c.name === selectedCat);
    if (!cat) return;
    
    await saveCategory({
      ...cat,
      target: parseFloat(targetAmount)
    });
    
    setIsAdding(false);
    setSelectedCat('');
    setTargetAmount('');
  };

  const handleRemoveGoal = async (catId) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    await saveCategory({
      ...cat,
      target: 0
    });
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditAmount(cat.target.toString());
  };

  const saveEdit = async (catId) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    await saveCategory({
      ...cat,
      target: parseFloat(editAmount) || 0
    });
    setEditingId(null);
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <motion.div 
        className="modal-content glass-panel" 
        onClick={e => e.stopPropagation()} 
        style={{ maxWidth: '480px', width: '100%', padding: 0, overflow: 'hidden' }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
      >
        <div className="modal-header" style={{ padding: '24px 24px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', background: 'var(--accent-glow)', borderRadius: '12px', color: 'var(--accent-color)', flexShrink: 0 }}>
              <Target size={24} />
            </div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Manage Goals</h2>
          </div>
          <button className="icon-btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
          
          <AnimatePresence>
            {isAdding && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--text-secondary)' }}>Add New Goal</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <UnifiedDropdown
                      options={availableCategories.map(c => ({ label: c.name, value: c.name }))}
                      value={selectedCat}
                      onChange={setSelectedCat}
                      placeholder="Select Category"
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div className="input-with-symbol" style={{ flex: 1, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}>{getCurrencySymbol(baseCurrency)}</span>
                        <input 
                          type="number"
                          value={targetAmount}
                          onChange={(e) => setTargetAmount(e.target.value)}
                          placeholder="Monthly Target"
                          style={{
                            width: '100%',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '12px',
                            padding: '12px 16px 12px 42px',
                            color: 'var(--text-primary)',
                            fontSize: '16px',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <button 
                        onClick={handleAddGoal}
                        disabled={!selectedCat || !targetAmount}
                        style={{
                          background: 'var(--accent-gradient)',
                          border: 'none',
                          borderRadius: '12px',
                          color: '#fff',
                          padding: '0 20px',
                          fontWeight: 600,
                          cursor: (!selectedCat || !targetAmount) ? 'not-allowed' : 'pointer',
                          opacity: (!selectedCat || !targetAmount) ? 0.5 : 1
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Goals</span>
            {!isAdding && availableCategories.length > 0 && (
              <button 
                onClick={() => setIsAdding(true)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--accent-color)', 
                  fontSize: '14px', 
                  fontWeight: 600, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Plus size={16} /> Add Goal
              </button>
            )}
          </div>

          {categoriesWithGoals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
              <Target size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <p style={{ margin: 0 }}>No active goals found.</p>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px' }}>Add a target to a category to track your progress.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {categoriesWithGoals.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{cat.name}</div>
                    {editingId !== cat.id && (
                      <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {cat.target > 0 ? `${getCurrencySymbol(baseCurrency)}${formatCurrency(cat.target)} / mo` : 'No target set'}
                      </div>
                    )}
                  </div>
                  
                  {editingId === cat.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="input-with-symbol" style={{ position: 'relative', width: '120px' }}>
                        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: '14px' }}>{getCurrencySymbol(baseCurrency)}</span>
                        <input 
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          autoFocus
                          style={{
                            width: '100%',
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid var(--accent-color)',
                            borderRadius: '8px',
                            padding: '8px 8px 8px 32px',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <button onClick={() => saveEdit(cat.id)} style={{ background: '#10b981', border: 'none', borderRadius: '8px', padding: '8px', color: '#fff', cursor: 'pointer', display: 'flex' }}>
                        <Check size={16} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button onClick={() => startEdit(cat)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '8px', borderRadius: '8px', display: 'flex' }} title="Edit Goal">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => handleRemoveGoal(cat.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '8px', borderRadius: '8px', display: 'flex' }} title="Remove Goal">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
