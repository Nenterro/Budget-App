import { useState } from 'react';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import UnifiedColorPicker from '../components/UnifiedColorPicker';
import CurrencySelector from '../components/CurrencySelector';
import { useAppearanceSettings } from '../context/SettingsContext';
import './AppearanceSettings.css';
import { THEMES, applyTheme, restoreTheme, generateCustomTheme, hexToRgb } from '../utils/theme';

// Re-exported for callers that still import them from this module.
export { applyTheme, restoreTheme, THEMES, generateCustomTheme, hexToRgb };

export default function AppearanceSettings() {
  const navigate = useNavigate();
  const { 
    activeTheme, customHex, setTheme 
  } = useAppearanceSettings();

  const handleThemeChange = (themeId, hex = customHex) => {
    setTheme(themeId, hex);
    applyTheme(themeId, hex);
  };

  return (
    <div className="page-container appearance-page">
      <div className="appearance-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>
          <ArrowLeft size={24} />
        </button>
        <h1>Appearance</h1>
      </div>

      <div className="appearance-content">
        <h3 className="section-subtitle">Accent Color</h3>
        <p className="section-desc">Choose a primary color theme for the app.</p>
        
        <div className="theme-grid">
          {THEMES.map(theme => (
            <button 
              key={theme.id}
              className={`theme-card ${activeTheme === theme.id ? 'active' : ''}`}
              onClick={() => handleThemeChange(theme.id)}
            >
              <div 
                className="theme-preview" 
                style={{ background: theme.gradient }}
              >
                {activeTheme === theme.id && <Check size={20} color="#fff" />}
              </div>
              <span className="theme-name">{theme.name}</span>
            </button>
          ))}
          
          <UnifiedColorPicker color={customHex} onChange={(c) => handleThemeChange('custom', c)}>
            <div 
              className={`theme-card ${activeTheme === 'custom' ? 'active' : ''}`}
              onClick={() => {
                if (activeTheme !== 'custom') {
                  handleThemeChange('custom', customHex);
                }
              }}
            >
              <div 
                className="theme-preview" 
                style={{ 
                  background: activeTheme === 'custom' ? generateCustomTheme(customHex).gradient : 'rgba(255, 255, 255, 0.05)', 
                  border: activeTheme === 'custom' ? 'none' : '2px dashed rgba(255,255,255,0.2)' 
                }}
              >
                {activeTheme === 'custom' ? <Check size={20} color="#fff" /> : <Plus size={20} color="var(--text-secondary)" />}
              </div>
              <span className="theme-name">Custom</span>
            </div>
          </UnifiedColorPicker>
        </div>

      </div>
    </div>
  );
}
