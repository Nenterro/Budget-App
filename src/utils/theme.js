// Accent-colour themes and the code that paints them.
//
// Kept out of pages/AppearanceSettings.jsx so that main.jsx and App.jsx can
// apply a theme without pulling that whole page — its CSS, its colour picker,
// its currency selector — into the startup bundle. The settings page itself
// stays lazily loaded.

export const THEMES = [
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

export const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '99, 102, 241';
};

export const generateCustomTheme = (hex) => ({
  id: 'custom',
  name: 'Custom',
  color: hex,
  gradient: `linear-gradient(135deg, ${hex} 0%, ${hex}dd 100%)`,
  glow: `rgba(${hexToRgb(hex)}, 0.3)`
});

// The resolved CSS values are cached separately from the synced settings
// record. Settings live in IndexedDB behind an async read and the provider
// renders nothing until it resolves, so without this the app flashed the
// default indigo on every launch before switching to the chosen accent.
const THEME_VARS_KEY = 'APP_THEME_VARS';

export const applyTheme = (themeId, customHex = '#6366f1') => {
  const theme = themeId === 'custom'
    ? generateCustomTheme(customHex)
    : (THEMES.find(t => t.id === themeId) || THEMES[0]);

  document.documentElement.style.setProperty('--accent-color', theme.color);
  document.documentElement.style.setProperty('--accent-gradient', theme.gradient);
  document.documentElement.style.setProperty('--accent-glow', theme.glow);
  localStorage.setItem('APP_THEME', theme.id);
  try {
    localStorage.setItem(THEME_VARS_KEY, JSON.stringify({
      color: theme.color,
      gradient: theme.gradient,
      glow: theme.glow
    }));
  } catch (e) {
    // Storage full or blocked — the theme still applies for this session.
  }
};

// Paint the last known accent at startup. Safe to call before any settings have
// loaded; a no-op on a device that has never picked a theme.
export const restoreTheme = () => {
  try {
    const raw = localStorage.getItem(THEME_VARS_KEY);
    if (!raw) return;
    const vars = JSON.parse(raw);
    if (!vars || !vars.color) return;
    document.documentElement.style.setProperty('--accent-color', vars.color);
    document.documentElement.style.setProperty('--accent-gradient', vars.gradient);
    document.documentElement.style.setProperty('--accent-glow', vars.glow);
  } catch (e) {
    // Corrupt entry — fall back to the stylesheet default.
  }
};
