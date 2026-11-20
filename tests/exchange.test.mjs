// Exchange rates: the Elevate peg and which currency a transaction is in.
//
// Guards two things. The peg must turn Elevate's "1 USD = r PKR" into the
// app's base-relative map the right way up (a flipped rate is off by a
// factor of ~75,000 and looks like nonsense only in hindsight). And a
// transaction's amount is in its account's currency: the Recent Transactions
// widget used `tx.currency || base`, and most records carry no currency, so
// a $230 payment showed as ₨230.

import { applyElevateRates, convertAmount, currencyOfTx, txAmountInBase } from '../src/utils/exchange.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

console.log('\n--- Elevate peg, base PKR ---');
{
  const market = { PKR: 1, USD: 1 / 280, EUR: 1 / 300 };
  const { rates, pegged } = applyElevateRates(market, 'PKR', { PKR: { rate: 273.68, time: 't' } });
  check('$100 converts at Elevate\'s rate', near(convertAmount(100, 'USD', 'PKR', rates), 27368), convertAmount(100, 'USD', 'PKR', rates));
  check('other currencies keep the market rate', rates.EUR === market.EUR);
  check('the market map is not mutated', market.USD === 1 / 280);
  check('the pegged pair is reported', pegged.length === 1 && pegged[0].to === 'PKR' && pegged[0].rate === 273.68);
}

console.log('\n--- Elevate peg, base USD ---');
{
  const { rates } = applyElevateRates({ USD: 1, PKR: 280 }, 'USD', { PKR: { rate: 273.68 } });
  check('₨27,368 converts to $100', near(convertAmount(27368, 'PKR', 'USD', rates), 100));
}

console.log('\n--- No Elevate quote: nothing changes ---');
{
  const market = { PKR: 1, USD: 1 / 280 };
  const { rates, pegged } = applyElevateRates(market, 'PKR', {});
  check('rates untouched', rates.USD === market.USD && pegged.length === 0);
}

console.log('\n--- A transaction is in its account\'s currency ---');
{
  const accounts = [{ name: 'Elevate', currency: 'USD' }, { name: 'Askari', currency: 'PKR' }];
  const rates = { PKR: 1, USD: 1 / 273.68 };
  check('no tx.currency: the account decides', currencyOfTx({ account: 'Elevate', amount: 230.76 }, accounts, 'PKR') === 'USD');
  check('the account wins over a stale tx.currency', currencyOfTx({ account: 'Askari', currency: 'USD' }, accounts, 'PKR') === 'PKR');
  check('a deleted account falls back to tx.currency', currencyOfTx({ account: 'Gone', currency: 'USD' }, accounts, 'PKR') === 'USD');
  check('$230.76 in base', near(txAmountInBase({ account: 'Elevate', amount: 230.76 }, accounts, 'PKR', rates), 230.76 * 273.68));
}

if (failed) { console.log(`\n${failed} exchange check(s) FAILED`); process.exit(1); }
console.log('\nAll exchange checks passed.');
