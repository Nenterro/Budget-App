import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Globe, Layers, Info, ArrowRightLeft, RefreshCw } from 'lucide-react';
import { useData } from '../context/DataContext';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import CurrencySelector from '../components/CurrencySelector';
import { useAppearanceSettings } from '../context/SettingsContext';
import './ManageData.css';

export default function CurrencySettings() {
  const navigate = useNavigate();
  const { 
    baseCurrency, setBaseCurrency, 
    displayMode, setDisplayMode,
    rateSource, setRateSource
  } = useAppearanceSettings();
  const { exchangeRates, exchangeRateInfo, setRateReloadKey } = useData();

  // The rate actually in use for US dollars, whichever source supplied it.
  const usdLine = (() => {
    if (baseCurrency === 'USD') return null;
    const r = exchangeRates?.USD;
    return r ? `$1.00 = ${getCurrencySymbol(baseCurrency)}${formatCurrency(1 / r)}` : null;
  })();
  const peg = exchangeRateInfo?.source === 'elevate' ? exchangeRateInfo.pegged?.[0] : null;
  const pegTime = peg?.time ? new Date(peg.time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;

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

          {/* Exchange Rate Source Card */}
          <div className="data-item-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px', padding: '20px' }}>
            <div className="item-info" style={{ width: '100%' }}>
              <div className="item-icon-wrap" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                <ArrowRightLeft size={22} />
              </div>
              <div className="item-details" style={{ flex: 1 }}>
                <span className="item-name" style={{ fontSize: '16px', fontWeight: '600' }}>Exchange Rate</span>
                <span className="item-currency" style={{ fontSize: '13px', opacity: 0.7, marginTop: '2px' }}>
                  Which US dollar rate converted figures use.
                </span>
              </div>
            </div>

            <div className="segmented" role="radiogroup" aria-label="Exchange rate source">
              <button type="button" role="radio" aria-checked={rateSource === 'market'}
                className={`segment ${rateSource === 'market' ? 'active' : ''}`} onClick={() => setRateSource('market')}>
                Market rate
              </button>
              <button type="button" role="radio" aria-checked={rateSource === 'elevate'}
                className={`segment ${rateSource === 'elevate' ? 'active' : ''}`} onClick={() => setRateSource('elevate')}>
                Elevate Pay
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <div style={{ flex: 1, lineHeight: 1.5 }}>
                {usdLine && <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '15px' }}>{usdLine}</div>}
                {rateSource === 'elevate' && peg && (
                  <div>Elevate live rate{pegTime ? `, as of ${pegTime}` : ''}{peg.stale ? ' (last known; Elevate is not answering)' : ''}</div>
                )}
                {rateSource === 'elevate' && exchangeRateInfo?.fallback && (
                  <div style={{ color: '#f59e0b' }}>{exchangeRateInfo.fallback}</div>
                )}
                {rateSource === 'market' && <div>Mid-market rate, refreshed twice a day</div>}
              </div>
              {rateSource === 'elevate' && (
                <button type="button" className="icon-btn-ghost" title="Refresh rate" aria-label="Refresh rate"
                  onClick={() => setRateReloadKey(k => k + 1)}>
                  <RefreshCw size={16} />
                </button>
              )}
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
                <strong>Unified Mode:</strong> All non-base currency transactions and accounts are automatically converted into your base currency (<strong>{baseCurrency}</strong>) on the fly using live exchange rates. Foreign amounts show their original figure underneath.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Elevate Pay rate:</strong> US dollars convert at Elevate's own "Live rate" (what you get when you move money out of Elevate), checked every 10 minutes while the app is open. Other currencies keep the market rate.
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
