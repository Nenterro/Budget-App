import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import CurrencySelector from '../components/CurrencySelector';
import { useAppearanceSettings } from '../context/SettingsContext';
import './AppearanceSettings.css';

export default function CurrencySettings() {
  const navigate = useNavigate();
  const { 
    baseCurrency, setBaseCurrency, 
    displayMode, setDisplayMode 
  } = useAppearanceSettings();

  return (
    <div className="page-container appearance-page">
      <div className="appearance-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>
          <ArrowLeft size={24} />
        </button>
        <h1>Currency</h1>
      </div>

      <div className="appearance-content">
        <p className="section-desc" style={{ marginBottom: '30px' }}>
          Manage how currencies are displayed across your dashboard and graphs.
        </p>

        <div className="settings-row" style={{ marginTop: '20px' }}>
          <div className="settings-row-info">
            <h4>Base Currency</h4>
            <p>Your primary currency for unified net worth and totals.</p>
          </div>
          <div style={{ width: '200px' }}>
            <CurrencySelector value={baseCurrency} onChange={setBaseCurrency} />
          </div>
        </div>

        <div className="settings-row" style={{ marginTop: '20px' }}>
          <div className="settings-row-info">
            <h4>Multi-Currency Display</h4>
            <p>Choose how transactions in different currencies are shown on the dashboard.</p>
          </div>
          <div className="display-mode-toggles" style={{ display: 'flex', gap: '10px' }}>
            <button 
              className={`mode-btn ${displayMode === 'unified' ? 'active' : ''}`}
              onClick={() => setDisplayMode('unified')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${displayMode === 'unified' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                background: displayMode === 'unified' ? 'var(--accent-color)' : 'transparent',
                color: displayMode === 'unified' ? '#fff' : 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Unified (Converted)
            </button>
            <button 
              className={`mode-btn ${displayMode === 'split' ? 'active' : ''}`}
              onClick={() => {}} // Disabled for now
              disabled
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: `1px solid ${displayMode === 'split' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                background: displayMode === 'split' ? 'var(--accent-color)' : 'transparent',
                color: displayMode === 'split' ? '#fff' : 'var(--text-secondary)',
                cursor: 'not-allowed',
                opacity: 0.5
              }}
              title="Native split mode is coming soon"
            >
              Native (Split)
            </button>
          </div>
        </div>
        
        <div className="glass-panel" style={{ marginTop: '30px', padding: '20px' }}>
          <h4 style={{ marginBottom: '10px', fontSize: '15px' }}>How it works</h4>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
            <li style={{ marginBottom: '8px' }}><strong>Unified:</strong> All foreign currency accounts and transactions are converted into your Base Currency on the fly using live exchange rates. This gives you a true net worth figure.</li>
            <li><strong>Native:</strong> Balances and totals are kept separate in their original currencies. No conversions happen, showing exactly what you have in each account.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
