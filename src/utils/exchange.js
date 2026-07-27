// Utility to fetch exchange rates

const CACHE_KEY = 'budget_exchange_rates';
const CACHE_TIME_KEY = 'budget_exchange_rates_time';
const CACHE_DURATION = 1000 * 60 * 60 * 12; // 12 hours

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
