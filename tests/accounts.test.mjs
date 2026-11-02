// Account card wording.
//
// A credit card's balance is negative whenever it is in use. The card has to
// say "owed" with a positive figure instead, and the limit, when there is one,
// has to measure what is left rather than go negative past it. Standard
// accounts must read exactly as before, apart from the minus moving in front
// of the currency symbol.

import { describeBalance, formatSignedAmount, isCreditAccount } from '../src/utils/accounts.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};

const card = (over) => ({ name: 'Credit Card', currency: 'USD', kind: 'credit', ...over });

console.log('\n--- Credit cards show what is owed ---');
{
  const v = describeBalance(card({ currentBalance: -2417 }));
  check('owed amount is positive', v.text === '$2,417.00', v.text);
  check('caption says owed', v.caption === 'owed', v.caption);
  check('no limit when none set', v.limit === null);

  check('zero reads as paid off', describeBalance(card({ currentBalance: 0 })).caption === 'paid off');
  const over = describeBalance(card({ currentBalance: 150 }));
  check('overpaid reads as in credit', over.caption === 'in credit' && over.text === '$150.00', JSON.stringify(over));
}

console.log('\n--- Credit limit ---');
{
  const v = describeBalance(card({ currentBalance: -2500, creditLimit: 10000 }));
  check('available is limit minus owed', v.limit.available === 7500, v.limit?.available);
  check('used fraction', Math.abs(v.limit.used - 0.25) < 1e-9, v.limit?.used);
  check('available text formatted', v.limit.availableText === '$7,500.00', v.limit?.availableText);

  const past = describeBalance(card({ currentBalance: -12000, creditLimit: 10000 }));
  check('over the limit leaves nothing available', past.limit.available === 0);
  check('over the limit caps usage at 100%', past.limit.used === 1);

  const credit = describeBalance(card({ currentBalance: 500, creditLimit: 10000 }));
  check('a credit balance uses none of the limit', credit.limit.used === 0 && credit.limit.available === 10000);
}

console.log('\n--- Standard accounts ---');
{
  check('accounts without kind are standard', !isCreditAccount({ name: 'Meezan' }));
  const v = describeBalance({ currency: 'USD', currentBalance: -2417 });
  check('negative sign goes before the symbol', v.text === '-$2,417.00', v.text);
  check('negative standard is flagged', v.tone === 'negative');
  check('no caption on standard', v.caption === null);
  check('positive unchanged', describeBalance({ currency: 'USD', currentBalance: 50 }).text === '$50.00');
  check('rounding does not leave a -0', formatSignedAmount(-0.001, 'USD') === '$0.00', formatSignedAmount(-0.001, 'USD'));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll account checks passed.');
