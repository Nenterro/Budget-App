// Account balances for the Home page.
//
// The one rule worth stating up front: this does NOT take a date range, and
// should not be given one. A balance is what is sitting in the account, not a
// figure about a period, so the Home page's period picker and its filters must
// leave it alone — they belong to the widgets below it. Summing only up to the
// end of the selected range is what this used to do, and picking "This Week"
// silently restated every balance on the page as of Sunday.
//
// Amounts are stored in each account's own currency. `totalBalance` converts
// them into `baseCurrency` for the unified pill; `splitBalances` keeps them
// apart, per currency, for the split pill.
//
// Credit cards are kept out of both totals. The total is the money you have,
// and a card's balance is a bill that has not fallen due: spending on it leaves
// the total alone, and paying it off (a transfer from a bank into the card) is
// what takes the money out. The card's own figure is still tracked in full.

import { isCreditAccount } from './accounts';

const convert = (amount, fromCurrency, baseCurrency, exchangeRates) => {
  const rate = exchangeRates && exchangeRates[fromCurrency] ? exchangeRates[fromCurrency] : 1;
  const baseRate = exchangeRates && exchangeRates[baseCurrency] ? exchangeRates[baseCurrency] : 1;
  return (amount / rate) * baseRate;
};

/**
 * What a transaction does to each account it touches, in that account's own
 * currency. A split moves money per line; a transfer moves it twice — out of
 * the source at its amount, into the destination at `receivedAmount`, which
 * differs when the two accounts are in different currencies.
 */
export function transactionLegs(tx) {
  if (tx.splits && tx.splits.length > 0 && tx.type !== 2) {
    return tx.splits.map(s => ({ account: s.account, amount: s.amount }));
  }
  if (tx.type !== 2) return [{ account: tx.account, amount: tx.amount }];
  return [
    { account: tx.account, amount: tx.amount },
    { account: tx.transferTo, amount: tx.receivedAmount || Math.abs(tx.amount) }
  ];
}

export function computeBalances({ transactions = [], accounts = [], baseCurrency = 'USD', exchangeRates = {} } = {}) {
  let total = 0;
  const split = {};
  const accBalances = {};

  const currencyOf = (name) => {
    const acc = accounts?.find(a => a.name === name);
    return acc ? (acc.currency || 'USD') : 'USD';
  };
  const creditNames = new Set((accounts || []).filter(isCreditAccount).map(a => a.name));
  const add = (amount, currency, accountName) => {
    if (creditNames.has(accountName)) return;
    total += convert(amount, currency, baseCurrency, exchangeRates);
    if (!split[currency]) split[currency] = 0;
    split[currency] += amount;
  };

  if (accounts) {
    accounts.forEach(acc => {
      const initBal = Number(acc.initialBalance) || 0;
      accBalances[acc.name] = { ...acc, currentBalance: initBal };
      add(initBal, acc.currency || 'USD', acc.name);
    });
  }

  transactions.forEach(tx => {
    for (const leg of transactionLegs(tx)) {
      add(leg.amount, currencyOf(leg.account), leg.account);
      if (accBalances[leg.account]) accBalances[leg.account].currentBalance += leg.amount;
    }
  });

  return { totalBalance: total, accountBalances: Object.values(accBalances), splitBalances: split };
}

/**
 * The total balance over time, for the balance graph.
 *
 * Built from the same legs, the same credit-card exclusion and the same
 * conversion as `computeBalances`, so the graph's last point is the Home
 * page's total. It used to keep its own arithmetic — reporting figures rather
 * than money moved, transfers skipped, cards counted — and drifted from it.
 *
 * Returns the opening total (initial balances) and the net change per day,
 * keyed by `dayOf(tx.date)`, both in `baseCurrency`.
 */
export function balanceChangesByDay({ transactions = [], accounts = [], baseCurrency = 'USD', exchangeRates = {}, dayOf }) {
  const byName = new Map((accounts || []).map(a => [a.name, a]));
  const counts = (name) => !isCreditAccount(byName.get(name) || {});
  const toBase = (amount, name) =>
    convert(amount, byName.get(name)?.currency || 'USD', baseCurrency, exchangeRates);

  let opening = 0;
  for (const acc of accounts || []) {
    if (counts(acc.name)) opening += toBase(Number(acc.initialBalance) || 0, acc.name);
  }

  const daily = {};
  for (const tx of transactions) {
    let delta = 0;
    for (const leg of transactionLegs(tx)) {
      if (counts(leg.account)) delta += toBase(leg.amount, leg.account);
    }
    if (delta === 0) continue;
    const key = dayOf(tx.date);
    daily[key] = (daily[key] || 0) + delta;
  }
  return { opening, daily };
}
