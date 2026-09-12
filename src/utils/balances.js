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

const convert = (amount, fromCurrency, baseCurrency, exchangeRates) => {
  const rate = exchangeRates && exchangeRates[fromCurrency] ? exchangeRates[fromCurrency] : 1;
  const baseRate = exchangeRates && exchangeRates[baseCurrency] ? exchangeRates[baseCurrency] : 1;
  return (amount / rate) * baseRate;
};

export function computeBalances({ transactions = [], accounts = [], baseCurrency = 'USD', exchangeRates = {} } = {}) {
  let total = 0;
  const split = {};
  const accBalances = {};

  const currencyOf = (name) => {
    const acc = accounts?.find(a => a.name === name);
    return acc ? (acc.currency || 'USD') : 'USD';
  };
  const add = (amount, currency) => {
    total += convert(amount, currency, baseCurrency, exchangeRates);
    if (!split[currency]) split[currency] = 0;
    split[currency] += amount;
  };

  if (accounts) {
    accounts.forEach(acc => {
      const initBal = Number(acc.initialBalance) || 0;
      accBalances[acc.name] = { ...acc, currentBalance: initBal };
      add(initBal, acc.currency || 'USD');
    });
  }

  transactions.forEach(tx => {
    if (tx.splits && tx.splits.length > 0 && tx.type !== 2) {
      tx.splits.forEach(s => {
        add(s.amount, currencyOf(s.account));
        if (accBalances[s.account]) accBalances[s.account].currentBalance += s.amount;
      });
      return;
    }

    const cur = currencyOf(tx.account);

    if (tx.type !== 2) {
      add(tx.amount, cur);
    } else {
      // A transfer moves money twice: out of the source at its amount, into
      // the destination at `receivedAmount` — which differs when the two
      // accounts are in different currencies.
      const destCur = currencyOf(tx.transferTo);
      const destAmt = tx.receivedAmount || Math.abs(tx.amount);
      add(tx.amount, cur);
      add(destAmt, destCur);
      if (accBalances[tx.transferTo]) accBalances[tx.transferTo].currentBalance += destAmt;
    }

    if (accBalances[tx.account]) accBalances[tx.account].currentBalance += tx.amount;
  });

  return { totalBalance: total, accountBalances: Object.values(accBalances), splitBalances: split };
}
