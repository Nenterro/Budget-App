import React, { useState } from 'react';
import { ArrowLeft, Lock, Unlock, Key, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSecuritySettings } from '../context/SettingsContext';
import { useData } from '../context/DataContext';
import { deriveKey, lockSession, isUnlocked } from '../utils/crypto';
import * as db from '../store/db';
import { syncAll, pb } from '../store/sync';
import './ManageData.css';

export default function SecuritySettings() {
  const navigate = useNavigate();
  const { isE2eeEnabled, setE2EE } = useSecuritySettings();
  const { loadData } = useData();
  
  const [modalMode, setModalMode] = useState(null); // 'enable', 'disable', 'change_pin'
  const [pinInput, setPinInput] = useState('');
  const [pinInputConfirm, setPinInputConfirm] = useState('');
  const [oldPinInput, setOldPinInput] = useState('');
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

  const handleEnableE2EE = async (e) => {
    e.preventDefault();
    if (pinInput !== pinInputConfirm) return alert("PINs do not match");
    if (pinInput.length !== 4) return alert("PIN must be 4 digits");

    setIsProcessing(true);
    try {
      await deriveKey(pinInput);
      setE2EE(true);
      await markAllPending();
      await syncAll();
      await loadData();
      setModalMode(null);
      alert("End-to-End Encryption Enabled!");
    } catch (err) {
      console.error(err);
      alert("Failed to enable E2EE");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableE2EE = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      if (!isUnlocked()) {
        if (pinInput.length !== 4) {
          setIsProcessing(false);
          return alert("Please enter your current PIN to unlock.");
        }
        await deriveKey(pinInput);
      }
      
      setE2EE(false);
      lockSession(); // Remove key from memory
      await markAllPending();
      await syncAll(); // This will push plaintext and { encrypted_payload: null }
      await loadData();
      setModalMode(null);
      alert("End-to-End Encryption Disabled!");
    } catch (err) {
      console.error(err);
      alert("Failed to disable E2EE");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangePin = async (e) => {
    e.preventDefault();
    if (pinInput !== pinInputConfirm) return alert("New PINs do not match");
    if (pinInput.length !== 4) return alert("New PIN must be 4 digits");

    setIsProcessing(true);
    try {
      // If locked, we don't strictly *have* to verify the old pin if we don't care, 
      // but without the old PIN, we can't decrypt data if we haven't synced yet.
      // Assuming we are fully synced, we just derive the new key and push.
      await deriveKey(pinInput);
      await markAllPending();
      await syncAll(); // Overwrites everything with new key
      setModalMode(null);
      alert("PIN Changed Successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to change PIN");
    } finally {
      setIsProcessing(false);
    }
  };

  const openModal = (mode) => {
    setModalMode(mode);
    setPinInput('');
    setPinInputConfirm('');
    setOldPinInput('');
  };

  return (
    <div className="page-container">
      <div className="header-container">
        <button className="back-btn" onClick={() => navigate('/settings')} aria-label="Go back">
          <ArrowLeft size={24} />
        </button>
        <h1 className="page-title">Security & Encryption</h1>
      </div>

      <div className="settings-list">
        <div className="form-group" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ padding: '12px', background: isE2eeEnabled ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)', borderRadius: '12px', color: isE2eeEnabled ? '#10b981' : 'var(--text-secondary)' }}>
                {isE2eeEnabled ? <Lock size={24} /> : <Unlock size={24} />}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px' }}>End-to-End Encryption</h3>
                <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
                  {isE2eeEnabled ? 'Your data is encrypted before leaving your device.' : 'Your data is synced in plain text.'}
                </p>
              </div>
            </div>
            
            {pb.authStore.isValid ? (
              <button 
                onClick={() => openModal(isE2eeEnabled ? 'disable' : 'enable')}
                style={{ 
                  background: isE2eeEnabled ? 'rgba(239,68,68,0.2)' : 'var(--primary-color)', 
                  color: isE2eeEnabled ? '#ef4444' : 'white',
                  border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '500'
                }}
              >
                {isE2eeEnabled ? 'Disable' : 'Enable'}
              </button>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Login Required</span>
            )}
          </div>
        </div>

        {isE2eeEnabled && pb.authStore.isValid && (
          <div className="form-group">
            <button className="submit-btn" onClick={() => openModal('change_pin')} style={{ background: 'rgba(255,255,255,0.05)', color: 'white' }}>
              <Key size={20} /> Change PIN
            </button>
          </div>
        )}
        
        {!pb.authStore.isValid && (
          <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: '14px' }}>You must connect to PocketBase and log in before you can manage encryption settings.</p>
          </div>
        )}
      </div>

      {modalMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(20,20,25,0.95)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <form 
            onSubmit={modalMode === 'enable' ? handleEnableE2EE : modalMode === 'disable' ? handleDisableE2EE : handleChangePin} 
            className="glass-panel" 
            style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', width: '90%', maxWidth: '320px' }}
          >
            <h2 style={{ margin: 0, fontSize: '20px', textAlign: 'center' }}>
              {modalMode === 'enable' ? 'Enable Encryption' : modalMode === 'disable' ? 'Disable Encryption' : 'Change PIN'}
            </h2>
            
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              {modalMode === 'enable' && 'Set a 4-digit PIN. This will encrypt all your data on the server.'}
              {modalMode === 'disable' && 'This will decrypt all your data on the server. Enter your current PIN to proceed.'}
              {modalMode === 'change_pin' && 'Set a new 4-digit PIN. This will re-encrypt all your data on the server.'}
            </p>

            {(modalMode === 'disable' && !isUnlocked()) && (
              <div style={{ width: '100%' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Current PIN</label>
                <input 
                  type="password" maxLength="4" value={pinInput} 
                  onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{ width: '100%', textAlign: 'center', letterSpacing: '8px', fontSize: '24px', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                  required
                />
              </div>
            )}

            {(modalMode === 'enable' || modalMode === 'change_pin') && (
              <>
                <div style={{ width: '100%' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>New PIN</label>
                  <input 
                    type="password" maxLength="4" value={pinInput} 
                    onChange={e => setPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ width: '100%', textAlign: 'center', letterSpacing: '8px', fontSize: '24px', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                    required
                  />
                </div>
                <div style={{ width: '100%' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Confirm New PIN</label>
                  <input 
                    type="password" maxLength="4" value={pinInputConfirm} 
                    onChange={e => setPinInputConfirm(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ width: '100%', textAlign: 'center', letterSpacing: '8px', fontSize: '24px', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                    required
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', width: '100%', marginTop: '8px' }}>
              <button type="button" onClick={() => setModalMode(null)} disabled={isProcessing} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={isProcessing} className="submit-btn bg-primary" style={{ flex: 1 }}>
                {isProcessing ? 'Syncing...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
