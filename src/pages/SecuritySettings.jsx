import React, { useState } from 'react';
import { ArrowLeft, Lock, Unlock, Key, AlertTriangle, Edit2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSecuritySettings } from '../context/SettingsContext';
import { useData } from '../context/DataContext';
import { deriveKey, lockSession, isUnlocked } from '../utils/crypto';
import * as db from '../store/db';
import { syncAll, pb } from '../store/sync';
import PinPad from '../components/PinPad';
import './ManageData.css';

export default function SecuritySettings() {
  const navigate = useNavigate();
  const { isE2eeEnabled, setE2EE } = useSecuritySettings();
  const { loadData } = useData();
  
  const [modalMode, setModalMode] = useState(null); // 'enable', 'disable', 'change_pin'
  const [pinStep, setPinStep] = useState(1);
  const [pinInput, setPinInput] = useState('');
  const [pinInputConfirm, setPinInputConfirm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const markAllPending = async () => {
    const stores = [db.transactionsStore, db.accountsStore, db.categoriesStore, db.payeesStore, db.settingsStore, db.budgetsStore];
    for (const store of stores) {
      const keys = await store.keys();
      for (const key of keys) {
        const item = await store.getItem(key);
        if (item) {
          item.pendingSync = true;
          await store.setItem(key, item);
        }
      }
    }
  };

  const openModal = (mode) => {
    setModalMode(mode);
    setPinStep(1);
    setPinInput('');
    setPinInputConfirm('');
  };

  const handlePinComplete = async (enteredPin) => {
    if (modalMode === 'enable' || modalMode === 'change_pin') {
      if (pinStep === 1) {
        setPinInput(enteredPin);
        setPinStep(2);
      } else if (pinStep === 2) {
        if (enteredPin !== pinInput) {
          alert("PINs do not match. Please try again.");
          setPinInput('');
          setPinInputConfirm('');
          setPinStep(1);
          return;
        }

        setIsProcessing(true);
        try {
          await deriveKey(enteredPin);
          if (modalMode === 'enable') {
            await setE2EE(true);
          }
          await markAllPending();
          await syncAll();
          await loadData();
          setModalMode(null);
          alert(modalMode === 'enable' ? "End-to-End Encryption Enabled!" : "PIN Changed Successfully!");
        } catch (err) {
          console.error(err);
          alert("Operation failed.");
        } finally {
          setIsProcessing(false);
        }
      }
    } else if (modalMode === 'disable') {
      setIsProcessing(true);
      try {
        if (!isUnlocked()) {
          await deriveKey(enteredPin);
        }
        await setE2EE(false);
        lockSession();
        await markAllPending();
        await syncAll();
        await loadData();
        setModalMode(null);
        alert("End-to-End Encryption Disabled!");
      } catch (err) {
        console.error(err);
        alert("Failed to disable E2EE.");
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div className="page-container manage-data-page">
      <div className="manage-header">
        <button className="back-btn" onClick={() => navigate('/settings')} aria-label="Go back">
          <ArrowLeft size={24} />
        </button>
        <h1>Security & Encryption</h1>
      </div>

      <div className="manage-content">
        {pb.authStore.isValid ? (
          <button className="add-item-btn" onClick={() => openModal(isE2eeEnabled ? 'disable' : 'enable')} style={{ color: isE2eeEnabled ? '#ef4444' : 'var(--accent-color)' }}>
            {isE2eeEnabled ? <Unlock size={20} /> : <Lock size={20} />} {isE2eeEnabled ? 'Disable Encryption' : 'Enable Encryption'}
          </button>
        ) : (
          <div className="empty-state" style={{ marginTop: '0', background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '16px' }}>
            Login Required to Toggle Encryption
          </div>
        )}

        <div className="data-item-list">
          <div className="data-item-card" style={{ cursor: 'default' }}>
            <div className="item-info">
              <div className="item-icon-wrap" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: isE2eeEnabled ? '#10b981' : 'var(--text-secondary)' }}>
                {isE2eeEnabled ? <Lock size={20} /> : <Unlock size={20} />}
              </div>
              <div className="item-details">
                <span className="item-name">End-to-End Encryption</span>
                <span className="item-currency">{isE2eeEnabled ? 'Your data is securely encrypted before leaving your device.' : 'Your data is currently synced to the server in plain text.'}</span>
              </div>
            </div>
          </div>

          {isE2eeEnabled && pb.authStore.isValid && (
            <div className="data-item-card" onClick={() => openModal('change_pin')} style={{ cursor: 'pointer' }}>
              <div className="item-info">
                <div className="item-icon-wrap" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'white' }}>
                  <Key size={20} />
                </div>
                <div className="item-details">
                  <span className="item-name">Change PIN</span>
                  <span className="item-currency">Update your encryption PIN.</span>
                </div>
              </div>
              <div className="item-actions">
                <button className="action-btn edit"><Edit2 size={18} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '90%', maxWidth: '340px', borderRadius: '24px', position: 'relative' }}>
            <button 
              type="button" 
              onClick={() => setModalMode(null)} 
              disabled={isProcessing} 
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
            
            <PinPad 
              value={pinStep === 1 ? pinInput : pinInputConfirm}
              onChange={pinStep === 1 ? setPinInput : setPinInputConfirm}
              onSubmit={handlePinComplete}
              title={
                modalMode === 'enable' ? (pinStep === 1 ? 'Set Encryption PIN' : 'Confirm PIN') :
                modalMode === 'change_pin' ? (pinStep === 1 ? 'Enter New PIN' : 'Confirm New PIN') :
                'Disable Encryption'
              }
              subtitle={
                modalMode === 'disable' ? 'Enter your 4-digit PIN to disable encryption.' :
                pinStep === 1 ? 'Enter a 4-digit PIN to encrypt your data.' : 'Re-enter your 4-digit PIN to confirm.'
              }
            />

            {isProcessing && (
              <p style={{ marginTop: '16px', color: 'var(--accent-color)', fontSize: '14px' }}>
                Processing & Syncing...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

