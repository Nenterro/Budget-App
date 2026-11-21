// Native (split) currency mode.
//
// Guards the per-currency arithmetic native mode is built on, and the one
// property that keeps the two modes honest with each other: the split figures,
// converted and added up, are exactly the unified figure. If a change makes
// native mode drop or double a leg (a cross-currency transfer is the usual
// suspect), the two stop agreeing here first.

import { addMoney, sumByCurrency, moneyEntries, formatMoney, moneyInBase, subtractMoney, mapMoney, orderCurrencies, passesAmountFilter } from '../src/utils/money.js';
import { balanceChangesByDay, balanceChangesByDayPerCurrency } from '../src/utils/balances.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

const accounts = [
  { name: 'Askari', currency: 'PKR', initialBalance: 1000 },
  { name: 'Elevate', currency: 'USD', initialBalance: 100 },
  { name: 'Card', currency: 'PKR', kind: 'credit', initialBalance: 0 },
];
// Base PKR: 1 PKR buys 1/280 USD.
const rates = { PKR: 1, USD: 1 / 280 };

console.log('\n--- Money maps ---');
{
  const txs = [
    { account: 'Askari', amount: -500 },
    { account: 'Elevate', amount: 230 },
    { account: 'Askari', amount: -250 },
  ];
  const map = sumByCurrency(txs, accounts, 'PKR');
  check('sums per account currency', map.PKR === -750 && map.USD === 230, JSON.stringify(map));
  check('converted total', near(moneyInBase(map, 'PKR', rates), -750 + 230 * 280));
  check('base first, then the rest', JSON.stringify(orderCurrencies(['USD', 'EUR', 'PKR'], 'PKR')) === '["PKR","EUR","USD"]');
  check('formats as one line', formatMoney({ USD: 30, PKR: 1200 }, 'PKR') === '₨1,200.00 + $30.00', formatMoney({ USD: 30, PKR: 1200 }, 'PKR'));
  check('zero currencies are dropped', formatMoney({ PKR: 1200, USD: 0 }, 'PKR') === '₨1,200.00');
  check('an empty map still shows a zero', JSON.stringify(moneyEntries({}, 'PKR')) === '[["PKR",0]]');
  check('signed keeps the minus', formatMoney({ PKR: -50, USD: 20 }, 'PKR', { signed: true }) === '-₨50.00 + $20.00');
  const net = subtractMoney({ USD: 230 }, { PKR: 900 });
  check('subtraction per currency', net.USD === 230 && net.PKR === -900);
  check('mapMoney', mapMoney({ PKR: 300, USD: 9 }, a => a / 3).USD === 3);
  const m = {};
  addMoney(m, 'USD', '12.5');
  check('addMoney coerces strings', m.USD === 12.5);
}

console.log('\n--- Amount filter: limits in their own currency ---');
{
  const ctx = { accounts, baseCurrency: 'PKR', rates };
  const dollar = { account: 'Elevate', amount: 230 };
  const rupee = { account: 'Askari', amount: -20000 };
  // $100 = ₨28,000.
  const f = { minAmount: '100', maxAmount: '', filterCurrency: 'USD' };
  check('$100 min keeps a $230 row', passesAmountFilter(dollar, f, ctx));
  check('$100 min drops a ₨20,000 row', !passesAmountFilter(rupee, f, ctx));
  const g = { minAmount: '20000', maxAmount: '', filterCurrency: 'PKR' };
  check('₨20,000 min keeps a $230 row (₨64,400)', passesAmountFilter(dollar, g, ctx));
  check('expenses match on magnitude', passesAmountFilter(rupee, g, ctx));
  check('max works too', !passesAmountFilter(dollar, { minAmount: '', maxAmount: '50', filterCurrency: 'USD' }, ctx));
  check('no limits keeps everything', passesAmountFilter(rupee, { minAmount: '', maxAmount: '', filterCurrency: '' }, ctx));
}

console.log('\n--- Split balances agree with the unified balance ---');
{
  const transactions = [
    { date: '2026-11-01', type: 1, account: 'Elevate', amount: 500 },
    // Cross-currency transfer: $200 leaves Elevate, ₨54,000 lands in Askari.
    { date: '2026-11-02', type: 2, account: 'Elevate', transferTo: 'Askari', amount: -200, receivedAmount: 54000 },
    { date: '2026-11-03', type: 0, account: 'Askari', amount: -3000 },
    // On the card: a bill, not money held, so neither view counts it.
    { date: '2026-11-03', type: 0, account: 'Card', amount: -999 },
  ];
  const dayOf = d => d;
  const one = balanceChangesByDay({ transactions, accounts, baseCurrency: 'PKR', exchangeRates: rates, dayOf });
  const per = balanceChangesByDayPerCurrency({ transactions, accounts, dayOf });

  check('opening kept apart', per.opening.PKR === 1000 && per.opening.USD === 100, JSON.stringify(per.opening));
  check('the transfer moves money between lines', per.daily['2026-11-02'].USD === -200 && per.daily['2026-11-02'].PKR === 54000, JSON.stringify(per.daily['2026-11-02']));
  check('the card is left out', per.daily['2026-11-03'].PKR === -3000, JSON.stringify(per.daily['2026-11-03']));
  check('opening converts to the unified opening', near(moneyInBase(per.opening, 'PKR', rates), one.opening));
  for (const day of Object.keys(one.daily)) {
    check(`${day} converts to the unified change`, near(moneyInBase(per.daily[day], 'PKR', rates), one.daily[day]), `${moneyInBase(per.daily[day], 'PKR', rates)} vs ${one.daily[day]}`);
  }
}

if (failed) { console.log(`\n${failed} money check(s) FAILED`); process.exit(1); }
console.log('\nAll money checks passed.');
