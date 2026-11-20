// Exchange rates, and turning an amount in one currency into another.
//
// `rates` everywhere in the app is a map relative to the base currency:
// rates[X] is how many X one unit of base buys, and rates[base] is 1. So
// converting divides by the source's rate and multiplies by the target's.
//
// Two sources, picked in Currency settings:
//   market  — the mid-market feed below, cached 12 hours.
//   elevate — the same feed with the US dollar pair replaced by Elevate Pay's
//             "Live rate", what you actually get moving dollars out of
//             Elevate. Elevate only quotes from USD, so other pairs stay on
//             the market rate. Elevate does not serve browsers on other
//             sites, so the home server's ingest service fetches it
//             (GET /fx/elevate). If that fails the market rate is used, and
//             the settings page says so.

const CACHE_KEY = 'budget_exchange_rates';
const CACHE_TIME_KEY = 'budget_exchange_rates_time';
const CACHE_DURATION = 1000 * 60 * 60 * 12; // 12 hours

// Tunnel first; DuckDNS is the fallback (it cannot work on the CGNAT line).
const INGEST_URLS = ['https://ingest-api.huzaifa.page', 'https://huz-ingest.duckdns.org:8888'];
const ELEVATE_CACHE_KEY = 'budget_elevate_rates';
// Elevate moves its rate through the day; the server caches for 10 minutes.
const ELEVATE_CACHE_DURATION = 1000 * 60 * 10;
export const ELEVATE_QUOTES = ['GBP', 'EUR', 'PKR', 'CAD', 'INR', 'SAR', 'BDT', 'AUD', 'JPY', 'PHP', 'EGP', 'LKR'];

const readJSON = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

async function fetchElevateQuote(quote) {
  let lastErr;
  for (const base of INGEST_URLS) {
    try {
      const res = await fetch(`${base}/fx/elevate?quote=${encodeURIComponent(quote)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rate = Number(data.rate);
      if (!(rate > 0) || data.base !== 'USD' || data.quote !== quote) throw new Error('unexpected reply');
      return { rate, time: data.time || null, stale: !!data.stale };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Elevate's USD -> quote rates, e.g. { PKR: { rate: 273.68, time } }. On
 * failure the last good quote comes back marked `stale`; one never fetched is
 * left out.
 */
export async function fetchElevateRates(quotes, { force = false } = {}) {
  const wanted = [...new Set(quotes)].filter(q => ELEVATE_QUOTES.includes(q));
  const cache = readJSON(ELEVATE_CACHE_KEY) || {};
  const out = {};
  await Promise.all(wanted.map(async (quote) => {
    const hit = cache[quote];
    if (!force && hit && Date.now() - hit.fetchedAt < ELEVATE_CACHE_DURATION) {
      out[quote] = hit;
      return;
    }
    try {
      const q = await fetchElevateQuote(quote);
      out[quote] = cache[quote] = { ...q, fetchedAt: Date.now() };
    } catch (err) {
      console.error('Elevate Rate Error:', err);
      if (hit) out[quote] = { ...hit, stale: true };
    }
  }));
  try { localStorage.setItem(ELEVATE_CACHE_KEY, JSON.stringify(cache)); } catch { /* the cache is optional */ }
  return out;
}

/**
 * Lay Elevate's USD quotes over a base-relative market map. Pure, so it is
 * tested directly. Returns the new map and the pairs actually pegged.
 */
export function applyElevateRates(marketRates, baseCurrency, elevate) {
  const rates = { ...marketRates };
  const pegged = [];
  const note = (quote, q) => pegged.push({ from: 'USD', to: quote, rate: q.rate, time: q.time, stale: !!q.stale });
  if (baseCurrency === 'USD') {
    for (const [quote, q] of Object.entries(elevate)) {
      rates[quote] = q.rate;
      note(quote, q);
    }
  } else if (elevate[baseCurrency]) {
    // 1 USD = r base, so one unit of base buys 1/r USD.
    rates.USD = 1 / elevate[baseCurrency].rate;
    note(baseCurrency, elevate[baseCurrency]);
  }
  return { rates, pegged };
}

/**
 * The rates the app runs on, plus where they came from for the settings page.
 * `currencies` are the ones in use, so Elevate is only asked what matters.
 */
export async function loadExchangeRates({ baseCurrency, source = 'market', currencies = [], force = false }) {
  const market = await fetchExchangeRates(baseCurrency);
  const info = { source, baseCurrency, pegged: [], fallback: null };
  if (source !== 'elevate') return { rates: market, info };

  const inUse = new Set([...currencies, baseCurrency]);
  if (!inUse.has('USD')) {
    return { rates: market, info: { ...info, fallback: 'None of your accounts are in US dollars, so there is nothing to peg.' } };
  }
  if (baseCurrency !== 'USD' && !ELEVATE_QUOTES.includes(baseCurrency)) {
    return { rates: market, info: { ...info, fallback: `Elevate does not quote ${baseCurrency}, so the market rate is used.` } };
  }
  const quotes = baseCurrency === 'USD' ? [...inUse].filter(c => c !== 'USD') : [baseCurrency];
  const elevate = await fetchElevateRates(quotes, { force });
  const { rates, pegged } = applyElevateRates(market, baseCurrency, elevate);
  if (pegged.length === 0) {
    return { rates: market, info: { ...info, fallback: 'Elevate’s rate could not be fetched, so the market rate is in use for now.' } };
  }
  return { rates, info: { ...info, pegged } };
}

export async function fetchExchangeRates(baseCurrency = 'PKR') {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);

    if (cached && cachedTime) {
      const isExpired = (Date.now() - parseInt(cachedTime)) > CACHE_DURATION;
      const parsedCache = JSON.parse(cached);

      // Return cache if not expired and base currency matches
      if (!isExpired && parsedCache.base_code === baseCurrency) {
        return parsedCache.rates;
      }
    }

    // Fetch from free API (fawazahmed0 tracking google rates)
    const response = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`);
    if (!response.ok) throw new Error('Failed to fetch exchange rates');

    const data = await response.json();
    const rawRates = data[baseCurrency.toLowerCase()];
    const rates = {};
    for (const key in rawRates) {
      rates[key.toUpperCase()] = rawRates[key];
    }
    // The API does not always echo the base currency back. Without it
    // convertAmount bails out and silently returns unconverted figures.
    const baseCode = baseCurrency.toUpperCase();
    if (!rates[baseCode]) rates[baseCode] = 1;

    const cacheData = { base_code: baseCurrency, rates };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());

    return rates;
  } catch (err) {
    console.error("Exchange Rate Error:", err);
    // Return empty or fallback
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (parsedCache.base_code === baseCurrency) {
        return parsedCache.rates; // fallback to stale cache
      }
    }
    return { [baseCurrency]: 1 };
  }
}

export function convertAmount(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amount;
  if (!rates || !rates[fromCurrency] || !rates[toCurrency]) return amount; // fallback

  // Formula: (Amount / FromRate) * ToRate
  // Since rates are relative to baseCurrency (e.g. USD)
  const amountInBase = amount / rates[fromCurrency];
  return amountInBase * rates[toCurrency];
}

/**
 * The currency a transaction's amount is in. Amounts are stored in their
 * account's currency (see balances.js), so the account wins; `tx.currency`
 * only covers a transaction whose account is gone.
 */
export function currencyOfTx(tx, accounts, baseCurrency) {
  const acc = accounts?.find(a => a.name === tx.account || a.id === tx.account);
  if (acc) return acc.currency || 'USD';
  return tx.currency || baseCurrency;
}

/** Whether `rates` can convert `currency` into `baseCurrency`. */
export function canConvert(currency, baseCurrency, rates) {
  return currency === baseCurrency || !!(rates && rates[currency] && rates[baseCurrency]);
}

/** A transaction's amount in the base currency (sign kept). */
export function txAmountInBase(tx, accounts, baseCurrency, rates, amount = tx.amount) {
  return convertAmount(Number(amount) || 0, currencyOfTx(tx, accounts, baseCurrency), baseCurrency, rates);
}
