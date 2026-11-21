// Money kept apart by currency, for native (split) mode.
//
// A "money map" is a plain object of currency code -> amount, e.g.
// { PKR: 158478.27, USD: 230.76 }. Native mode adds up into one of these
// instead of converting, and shows it as "₨158,478.27 + $230.76". Every
// helper here is pure, so tests drive them directly.

import { convertAmount, currencyOfTx } from './exchange';
import { formatCurrency, getCurrencySymbol } from './format';

/** Add `amount` in `currency` to `map` (mutates and returns it). */
export function addMoney(map, currency, amount) {
  const n = Number(amount) || 0;
  map[currency] = (map[currency] || 0) + n;
  return map;
}

/** Sum transactions into a money map, each in its account's currency. */
export function sumByCurrency(transactions, accounts, baseCurrency, amountOf = tx => tx.amount) {
  const map = {};
  for (const tx of transactions) addMoney(map, currencyOfTx(tx, accounts, baseCurrency), amountOf(tx));
  return map;
}

/**
 * The display order of currencies: base first, then the rest alphabetically.
 * Stable, so a currency keeps its colour and its place everywhere.
 */
export function orderCurrencies(codes, baseCurrency) {
  const rest = [...new Set(codes)].filter(c => c !== baseCurrency).sort();
  return codes.includes(baseCurrency) ? [baseCurrency, ...rest] : rest;
}

/**
 * [currency, amount] pairs worth showing: zero entries dropped (a currency
 * with nothing in this period is noise), but an all-zero map still shows the
 * base currency's zero rather than nothing.
 */
export function moneyEntries(map, baseCurrency) {
  const codes = orderCurrencies(Object.keys(map || {}), baseCurrency);
  const nonZero = codes.filter(c => Math.abs(map[c]) >= 0.005);
  if (nonZero.length) return nonZero.map(c => [c, map[c]]);
  return [[baseCurrency, 0]];
}

export const formatOne = (amount, currency, { noDecimals = false, signed = false } = {}) => {
  const sign = signed && amount < -0.004 ? '-' : '';
  return `${sign}${getCurrencySymbol(currency)}${formatCurrency(Math.abs(amount), noDecimals)}`;
};

/** "₨1,200.00 + $30.00". Magnitudes unless `signed`. */
export function formatMoney(map, baseCurrency, opts = {}) {
  return moneyEntries(map, baseCurrency).map(([c, a]) => formatOne(a, c, opts)).join(' + ');
}

/** The map as one figure in `baseCurrency` (for ranking, ratios, sizing). */
export function moneyInBase(map, baseCurrency, rates) {
  let total = 0;
  for (const [c, a] of Object.entries(map || {})) total += convertAmount(a, c, baseCurrency, rates);
  return total;
}

/** Apply `fn` to every amount: per-currency subtraction, averages and so on. */
export function mapMoney(map, fn) {
  const out = {};
  for (const [c, a] of Object.entries(map || {})) out[c] = fn(a, c);
  return out;
}

/** a - b, per currency. */
export function subtractMoney(a, b) {
  const out = { ...a };
  for (const [c, v] of Object.entries(b || {})) out[c] = (out[c] || 0) - v;
  return out;
}

// Series colours for charts: the base currency wears the app's accent, the
// others take these in display order. Kept apart from the category palette
// so a currency never looks like a category.
const FOREIGN_COLOURS = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899'];

export function currencyColour(currency, baseCurrency, ordered) {
  if (currency === baseCurrency) return 'var(--accent-color)';
  const foreign = ordered.filter(c => c !== baseCurrency);
  const i = Math.max(0, foreign.indexOf(currency));
  return FOREIGN_COLOURS[i % FOREIGN_COLOURS.length];
}

/**
 * Whether a min/max amount filter keeps `tx`. The limits are typed in
 * `filterCurrency` and converted into the transaction's own currency, so
 * "$100" means the same thing against a rupee row and a dollar row.
 */
export function passesAmountFilter(tx, { minAmount, maxAmount, filterCurrency }, { accounts, baseCurrency, rates }) {
  const txCurrency = currencyOfTx(tx, accounts, baseCurrency);
  const magnitude = Math.abs(Number(tx.amount) || 0);
  const limit = (raw) => {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Math.abs(parseFloat(raw));
    return isNaN(n) ? null : convertAmount(n, filterCurrency || baseCurrency, txCurrency, rates);
  };
  const min = limit(minAmount);
  const max = limit(maxAmount);
  if (min !== null && magnitude < min) return false;
  if (max !== null && magnitude > max) return false;
  return true;
}
