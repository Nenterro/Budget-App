import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Layers, Info } from 'lucide-react';
import CurrencySelector from '../components/CurrencySelector';
import { useAppearanceSettings } from '../context/SettingsContext';
import './ManageData.css';

export default function CurrencySettings() {
  const navigate = useNavigate();
  const { 
    baseCurrency, setBaseCurrency, 
    displayMode, setDisplayMode 
  } = useAppearanceSettings();

  return (
    <div className="page-container manage-data-page">
      <div className="manage-header">
        <button className="back-btn" onClick={() => navigate('/settings')} aria-label="Go back">
          <ArrowLeft size={24} />
        </button>
        <h1>Currency Settings</h1>
      </div>

      <div className="manage-content">
        <div className="data-item-list">
          {/* Base Currency Card */}
          <div className="data-item-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px', padding: '20px' }}>
            <div className="item-info" style={{ width: '100%' }}>
              <div className="item-icon-wrap" style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-color)' }}>
                <Globe size={22} />
              </div>
              <div className="item-details" style={{ flex: 1 }}>
                <span className="item-name" style={{ fontSize: '16px', fontWeight: '600' }}>Base Currency</span>
                <span className="item-currency" style={{ fontSize: '13px', opacity: 0.7, marginTop: '2px' }}>
                  Primary currency for net worth calculations and converted totals.
                </span>
              </div>
            </div>
            <div style={{ width: '100%', marginTop: '4px' }}>
              <CurrencySelector value={baseCurrency} onChange={setBaseCurrency} />
            </div>
          </div>

          {/* Multi-Currency Display Card */}
          <div className="data-item-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px', padding: '20px' }}>
            <div className="item-info" style={{ width: '100%' }}>
              <div className="item-icon-wrap" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'white' }}>
                <Layers size={22} />
              </div>
              <div className="item-details" style={{ flex: 1 }}>
                <span className="item-name" style={{ fontSize: '16px', fontWeight: '600' }}>Display Mode</span>
                <span className="item-currency" style={{ fontSize: '13px', opacity: 0.7, marginTop: '2px' }}>
                  Choose how foreign currency transactions appear across your app.
                </span>
              </div>
            </div>
            
            <div className="display-mode-toggles" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', width: '100%' }}>
              <button 
                className={`mode-btn ${displayMode === 'unified' ? 'active' : ''}`}
                onClick={() => setDisplayMode('unified')}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: `1px solid ${displayMode === 'unified' ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)'}`,
                  background: displayMode === 'unified' ? 'var(--accent-color)' : 'rgba(255,255,255,0.04)',
                  color: displayMode === 'unified' ? '#fff' : 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.2s'
                }}
              >
                Unified (Converted)
              </button>
              <button 
                className={`mode-btn ${displayMode === 'split' ? 'active' : ''}`}
                disabled
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-secondary)',
                  fontWeight: '500',
                  fontSize: '14px',
                  cursor: 'not-allowed',
                  opacity: 0.5,
                  textAlign: 'center'
                }}
                title="Native split mode coming soon"
              >
                Native (Split)
              </button>
            </div>
          </div>

          {/* Guide Box */}
          <div className="glass-panel" style={{ padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', color: 'var(--text-primary)' }}>
              <Info size={18} style={{ color: 'var(--accent-color)' }} />
              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '600' }}>How Currency Conversion Works</h4>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0 }}>
                <strong>Unified Mode:</strong> All non-base currency transactions and accounts are automatically converted into your base currency (<strong>{baseCurrency}</strong>) on the fly using live exchange rates.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Native Mode:</strong> Balances and totals are displayed in their original account currencies without conversion.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
