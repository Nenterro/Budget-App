import { useAppearanceSettings } from '../context/SettingsContext';
import { useBaseMoney } from '../hooks/useBaseMoney';

// Unified / Native, in the page headers on desktop (where there is room).
//
// The same app-wide setting as Settings -> Currency -> Display Mode, so
// flipping it here flips every page. Hidden on phones (desktop-only) and when
// the accounts hold a single currency, where there is nothing to split.
export default function CurrencyModeToggle() {
  const { displayMode, setDisplayMode } = useAppearanceSettings();
  const { currencies } = useBaseMoney();
  if (currencies.length < 2) return null;

  const native = displayMode === 'split';
  return (
    <div className="segmented currency-mode-toggle desktop-only" role="radiogroup" aria-label="Currency display">
      <button type="button" role="radio" aria-checked={!native}
        className={`segment ${!native ? 'active' : ''}`}
        title="Convert everything into your base currency"
        onClick={() => setDisplayMode('unified')}>
        Unified
      </button>
      <button type="button" role="radio" aria-checked={native}
        className={`segment ${native ? 'active' : ''}`}
        title="Keep every amount in its own currency"
        onClick={() => setDisplayMode('split')}>
        Native
      </button>
    </div>
  );
}
