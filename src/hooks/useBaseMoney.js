import { useMemo } from 'react';
import { useAppearanceSettings } from '../context/SettingsContext';
import { useData } from '../context/DataContext';
import { convertAmount, currencyOfTx, canConvert } from '../utils/exchange';
import { formatCurrency, getCurrencySymbol } from '../utils/format';

// Money as the user has asked to see it.
//
// In unified mode (the default) every amount on screen is restated in the
// base currency, and a foreign amount keeps its original as a small second
// line so nothing is lost. A balance or row that stayed in dollars beside
// rupee totals is what "unified doesn't work" looked like.
//
// When rates have not loaded, or cannot convert a currency, an amount stays
// in its own currency rather than being shown as a wrong number in base.
export function useBaseMoney() {
  const { baseCurrency, displayMode } = useAppearanceSettings();
  const { exchangeRates, accounts } = useData();
  const unified = displayMode !== 'split';

  return useMemo(() => {
    const fmt = (amount, currency, noDecimals) =>
      `${getCurrencySymbol(currency)}${formatCurrency(Math.abs(amount), noDecimals)}`;

    /**
     * `amount` in `currency`, as shown: { amount, currency, text, original }.
     * `original` is the untouched figure's text when it was converted.
     */
    const show = (amount, currency, { noDecimals = false } = {}) => {
      const cur = currency || baseCurrency;
      if (unified && cur !== baseCurrency && canConvert(cur, baseCurrency, exchangeRates)) {
        const converted = convertAmount(amount, cur, baseCurrency, exchangeRates);
        return { amount: converted, currency: baseCurrency, text: fmt(converted, baseCurrency, noDecimals), original: fmt(amount, cur, noDecimals) };
      }
      return { amount, currency: cur, text: fmt(amount, cur, noDecimals), original: null };
    };

    return {
      unified,
      baseCurrency,
      rates: exchangeRates,
      currencyOf: (tx) => currencyOfTx(tx, accounts, baseCurrency),
      accountCurrency: (name) => accounts?.find(a => a.name === name)?.currency || baseCurrency,
      show,
    };
  }, [unified, baseCurrency, exchangeRates, accounts]);
}
