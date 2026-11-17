// Cross-currency transfers: both amounts are the user's to set.
//
// What leaves one account and what lands in the other differ by the bank's
// spread and fees, so the rate only pre-fills the side not yet typed. Once a
// side is typed — or a bank message stated it — it must never be rewritten.

import { resolveTransferAmounts, convertAmountString } from '../src/utils/transferAmounts.js';
import { pairToTransferSuggestion } from '../src/utils/inboxDraft.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};

// 1 USD = 280 PKR.
const rates = { USD: 1, PKR: 280 };
const base = { from: 'PKR', to: 'USD', rates };

console.log('\n--- Pre-filling the side not typed ---');
{
  const r = resolveTransferAmounts({ ...base, sent: '28,000', received: '' });
  check('sent typed -> received converted', r.received === '100', JSON.stringify(r));
  check('sent kept as typed', r.sent === '28,000', JSON.stringify(r));

  const back = resolveTransferAmounts({ ...base, sent: '', received: '100' });
  check('received typed first -> sent converted back', back.sent === '28,000', JSON.stringify(back));

  const none = resolveTransferAmounts({ ...base, sent: '', received: '' });
  check('nothing typed -> both empty', none.sent === '' && none.received === '', JSON.stringify(none));
}

console.log('\n--- Both typed: neither moves ---');
{
  // 28,000 PKR left, 97.5 USD arrived after fees.
  const r = resolveTransferAmounts({ ...base, sent: '28,000', received: '97.5' });
  check('received kept despite rate', r.received === '97.5', JSON.stringify(r));
  check('sent kept despite rate', r.sent === '28,000', JSON.stringify(r));
}

console.log('\n--- No usable rate: leave it blank, never a fake conversion ---');
{
  check('missing rates -> empty', convertAmountString('500', 'PKR', 'EUR', rates) === '');
  check('no rates at all -> empty', convertAmountString('500', 'PKR', 'USD', {}) === '');
  check('bad expression -> empty', convertAmountString('5+', 'PKR', 'USD', rates) === '');
  check('arithmetic evaluated', convertAmountString('280*2', 'PKR', 'USD', rates) === '2');
}

console.log('\n--- Bank messages state their own side ---');
{
  const accounts = [
    { id: '1', name: 'Meezan', currency: 'PKR', last4: '1111' },
    { id: '2', name: 'Wise', currency: 'USD', last4: '2222' },
  ];
  const msg = (direction, amount) => ({
    id: direction, receivedAt: '2026-11-01T10:00:00Z',
    parsed: { direction, amount, currency: 'PKR', merchant: 'Wise' }
  });

  const credit = pairToTransferSuggestion({ debit: null, credit: msg('credit', 97.5) }, { accounts });
  check('one-sided credit: received is its amount', credit.receivedAmount === '97.5', JSON.stringify(credit));
  check('one-sided credit: no sent figure claimed', credit.sentAmount === '', JSON.stringify(credit));

  const debit = pairToTransferSuggestion({ debit: msg('debit', 28000), credit: null }, { accounts });
  check('one-sided debit: sent is its amount', debit.sentAmount === '28000', JSON.stringify(debit));
  check('one-sided debit: no received figure claimed', debit.receivedAmount === '', JSON.stringify(debit));
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll transfer amount checks passed.');
