import { useState } from 'react';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import UnifiedColorPicker from '../components/UnifiedColorPicker';
import CurrencySelector from '../components/CurrencySelector';
import { useAppearanceSettings } from '../context/SettingsContext';
import './AppearanceSettings.css';

const THEMES = [
  {
    id: 'purple',
    name: 'Amethyst',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)',
    glow: 'rgba(139, 92, 246, 0.3)'
  },
  {
    id: 'blue',
    name: 'Ocean',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    glow: 'rgba(59, 130, 246, 0.3)'
  },
  {
    id: 'green',
    name: 'Emerald',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    glow: 'rgba(16, 185, 129, 0.3)'
  },
  {
    id: 'rose',
    name: 'Rose',
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
    glow: 'rgba(244, 63, 94, 0.3)'
  },
  {
    id: 'amber',
    name: 'Sunset',
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    glow: 'rgba(245, 158, 11, 0.3)'
  },
  {
    id: 'slate',
    name: 'Midnight',
    color: '#64748b',
    gradient: 'linear-gradient(135deg, #64748b 0%, #334155 100%)',
    glow: 'rgba(100, 116, 139, 0.3)'
  }
];

// Utility to convert hex to rgb
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '99, 102, 241';
};

// Generate a theme object from a custom hex
const generateCustomTheme = (hex) => ({
  id: 'custom',
  name: 'Custom',
  color: hex,
  gradient: `linear-gradient(135deg, ${hex} 0%, ${hex}dd 100%)`,
  glow: `rgba(${hexToRgb(hex)}, 0.3)`
});

export const applyTheme = (themeId, customHex = '#6366f1') => {
  const theme = themeId === 'custom' ? generateCustomTheme(customHex) : (THEMES.find(t => t.id === themeId) || THEMES[0]);
  
  document.documentElement.style.setProperty('--accent-color', theme.color);
  document.documentElement.style.setProperty('--accent-gradient', theme.gradient);
  document.documentElement.style.setProperty('--accent-glow', theme.glow);
  localStorage.setItem('APP_THEME', theme.id);
};

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
