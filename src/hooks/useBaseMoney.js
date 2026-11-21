import { useMemo } from 'react';
import { useAppearanceSettings } from '../context/SettingsContext';
import { useData } from '../context/DataContext';
import { convertAmount, currencyOfTx, canConvert } from '../utils/exchange';
import { formatCurrency, getCurrencySymbol } from '../utils/format';
import { formatMoney, moneyInBase, orderCurrencies, currencyColour, passesAmountFilter } from '../utils/money';

// Money as the user has asked to see it — the one place that decides.
//
// Unified mode (the default): every amount is restated in the base currency,
// and a foreign amount keeps its original as a small second line.
//
// Native mode: amounts stay in their own currency and totals are kept apart
// per currency (a "money map", see src/utils/money.js), shown as
// "₨158,478 + $230". A few figures have no honest per-currency version —
// ratios, rankings, the Ending Balance tiles, Budgets — and stay converted,
// carrying a "converted" tag; `native` is what those check.
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

    // Every currency the accounts hold, base first.
    const currencies = orderCurrencies([baseCurrency, ...(accounts || []).map(a => a.currency || 'USD')], baseCurrency);

    return {
      unified,
      native: !unified,
      baseCurrency,
      rates: exchangeRates,
      currencies,
      currencyOf: (tx) => currencyOfTx(tx, accounts, baseCurrency),
      accountCurrency: (name) => accounts?.find(a => a.name === name)?.currency || baseCurrency,
      show,
      toBase: (amount, currency) => convertAmount(amount, currency || baseCurrency, baseCurrency, exchangeRates),
      /** A money map as text: one figure in unified mode, per currency in native. */
      formatMap: (map, opts = {}) => unified
        ? fmt(moneyInBase(map, baseCurrency, exchangeRates), baseCurrency, opts.noDecimals)
        : formatMoney(map, baseCurrency, opts),
      inBase: (map) => moneyInBase(map, baseCurrency, exchangeRates),
      colourOf: (currency) => currencyColour(currency, baseCurrency, currencies),
      /** The min/max filter, typed in `filterState.amountCurrency`. */
      passesAmount: (tx, filterState) => passesAmountFilter(tx, {
        minAmount: filterState.minAmount,
        maxAmount: filterState.maxAmount,
        filterCurrency: filterState.amountCurrency || baseCurrency
      }, { accounts, baseCurrency, rates: exchangeRates }),
    };
  }, [unified, baseCurrency, exchangeRates, accounts]);
}
