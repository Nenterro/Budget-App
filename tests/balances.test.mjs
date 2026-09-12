// Home page balances.
//
// The bug this guards: the balances were summed only up to the end of the
// page's selected period, so switching the picker from "All Time" to "This
// Week" restated the total and every account card as of Sunday. Balances are
// not a reporting figure — the period picker owns the widgets below them and
// nothing else.

import { computeBalances } from '../src/utils/balances.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

const accounts = [
  { id: '1', name: 'Meezan', currency: 'PKR', initialBalance: 1000 },
  { id: '2', name: 'Wise', currency: 'USD', initialBalance: 100 },
];
// 1 USD = 280 PKR.
const exchangeRates = { USD: 1, PKR: 280 };

const tx = (over) => ({ type: 0, account: 'Meezan', amount: 0, ...over });

console.log('\n--- The regression: the date range must not move a balance ---');
{
  // Spread across years, so any end-of-period cutoff would bite.
  const transactions = [
    tx({ date: '2020-01-15', amount: -500 }),
    tx({ date: '2026-09-01', amount: 2000 }),
    tx({ date: '2026-09-12', amount: -300 }),
    tx({ date: '2030-06-30', amount: -200, account: 'Wise' }),
  ];
  const r = computeBalances({ transactions, accounts, baseCurrency: 'PKR', exchangeRates });
  const meezan = r.accountBalances.find(a => a.name === 'Meezan').currentBalance;
  const wise = r.accountBalances.find(a => a.name === 'Wise').currentBalance;

  check('every transaction counts, whatever its date', near(meezan, 1000 - 500 + 2000 - 300), `got ${meezan}`);
  check('including one dated outside any period', near(wise, 100 - 200), `got ${wise}`);
  // 2200 PKR + (-100 USD -> -28000 PKR)
  check('total converts into the base currency', near(r.totalBalance, 2200 - 28000), `got ${r.totalBalance}`);

  // The sharp end of it: strip the dates off entirely. Nothing here reads
  // them, so the answer must not budge — and anyone who reintroduces a date
  // cutoff fails this line rather than shipping it.
  const undated = computeBalances({
    transactions: transactions.map(({ date, ...rest }) => rest), accounts, baseCurrency: 'PKR', exchangeRates,
  });
  check('balances do not read tx.date at all', near(undated.totalBalance, r.totalBalance), `${undated.totalBalance} vs ${r.totalBalance}`);
  const again = computeBalances({ transactions: [...transactions].reverse(), accounts, baseCurrency: 'PKR', exchangeRates });
  check('order of transactions is irrelevant', near(again.totalBalance, r.totalBalance), `${again.totalBalance} vs ${r.totalBalance}`);
}

console.log('\n--- Split balances stay in their own currency ---');
{
  const transactions = [tx({ date: '2026-09-01', amount: 2000 }), tx({ date: '2026-09-02', amount: -50, account: 'Wise' })];
  const { splitBalances } = computeBalances({ transactions, accounts, baseCurrency: 'PKR', exchangeRates });
  check('PKR side', near(splitBalances.PKR, 1000 + 2000), `got ${splitBalances.PKR}`);
  check('USD side', near(splitBalances.USD, 100 - 50), `got ${splitBalances.USD}`);
}

console.log('\n--- Transfers move money twice, at each side\'s own amount ---');
{
  const transactions = [
    // 28,000 PKR out of Meezan arrives as 100 USD in Wise.
    tx({ type: 2, date: '2026-09-05', account: 'Meezan', amount: -28000, transferTo: 'Wise', receivedAmount: 100 }),
  ];
  const r = computeBalances({ transactions, accounts, baseCurrency: 'PKR', exchangeRates });
  const meezan = r.accountBalances.find(a => a.name === 'Meezan').currentBalance;
  const wise = r.accountBalances.find(a => a.name === 'Wise').currentBalance;
  check('source debited', near(meezan, 1000 - 28000), `got ${meezan}`);
  check('destination credited in its own currency', near(wise, 100 + 100), `got ${wise}`);
  // Nothing left the system: the total is unchanged from the opening balances.
  check('a transfer does not change the total', near(r.totalBalance, 1000 + 100 * 280), `got ${r.totalBalance}`);
}

console.log('\n--- Split transactions land on each leg\'s account ---');
{
  const transactions = [
    tx({ date: '2026-09-07', amount: -1500, splits: [{ account: 'Meezan', amount: -1000 }, { account: 'Wise', amount: -2 }] }),
  ];
  const r = computeBalances({ transactions, accounts, baseCurrency: 'PKR', exchangeRates });
  const meezan = r.accountBalances.find(a => a.name === 'Meezan').currentBalance;
  const wise = r.accountBalances.find(a => a.name === 'Wise').currentBalance;
  check('first leg', near(meezan, 1000 - 1000), `got ${meezan}`);
  check('second leg, in its own currency', near(wise, 100 - 2), `got ${wise}`);
  check('the parent amount is not double counted', near(r.totalBalance, 0 + 98 * 280), `got ${r.totalBalance}`);
}

console.log('\n--- Degenerate input ---');
{
  const empty = computeBalances();
  check('no arguments at all', empty.totalBalance === 0 && empty.accountBalances.length === 0, JSON.stringify(empty));
  const noRates = computeBalances({ transactions: [tx({ date: '2026-09-01', amount: 5 })], accounts, baseCurrency: 'PKR' });
  check('missing exchange rates fall back to 1:1', near(noRates.totalBalance, 1000 + 100 + 5), `got ${noRates.totalBalance}`);
}

if (failed) {
  console.error(`\n${failed} balance check(s) failed.`);
  process.exit(1);
}
console.log('\nALL BALANCE CHECKS PASSED');
