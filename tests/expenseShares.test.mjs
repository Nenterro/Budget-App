import {
  sharePending, personPending, totalPending, personWrittenOff,
  applyWriteOff, editWriteOff, removeWriteOff,
  applyRepayment, editRepayment, removeRepayment,
  maxWriteOff, maxRepayment
} from '../src/utils/expenseShares.js';

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : '  <-- ' + extra}`);
  if (!cond) failed++;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

// A ₨1000 dinner: Ali owes 400, Sara owes 300, your share is 300.
const base = () => ({
  id: 'tx1', type: 0, amount: -1000, payee: 'Dinner', category: 'Food',
  account: 'Cash', currency: 'PKR', date: '2026-08-01T00:00:00.000Z',
  isExpenseShare: true,
  expenseShares: [
    { id: 's1', name: 'Ali', amount: 400, settled: false },
    { id: 's2', name: 'Sara', amount: 300, settled: false }
  ],
  repayments: [],
  writeOffs: []
});

const yourShare = (tx) =>
  Math.abs(tx.amount) - tx.expenseShares.reduce((a, s) => a + s.amount, 0);

console.log('\n--- Baseline ---');
{
  const tx = base();
  check('total pending is 700', near(totalPending(tx), 700));
  check('your share is 300', near(yourShare(tx), 300));
}

console.log('\n--- Partial write-off must not settle the whole share ---');
{
  const tx = base();
  const { parentTx } = applyWriteOff(tx, 's1', { amount: 150, category: 'Bad Debt', payee: 'Ali' });
  check('Ali still owes 250', near(personPending(parentTx, 'Ali'), 250),
        `got ${personPending(parentTx, 'Ali')}`);
  check('Ali is not marked settled', parentTx.expenseShares[0].settled === false);
  check('write-off is recorded as 150', near(personWrittenOff(parentTx, 'Ali'), 150));
  check('parent shrank to 850', near(parentTx.amount, -850), `got ${parentTx.amount}`);
  check('your share is unchanged at 300', near(yourShare(parentTx), 300), `got ${yourShare(parentTx)}`);
  check('total pending is 550', near(totalPending(parentTx), 550));
}

console.log('\n--- Write-off is capped at what is outstanding ---');
{
  const tx = base();
  const { parentTx, amount } = applyWriteOff(tx, 's1', { amount: 9999 });
  check('capped to 400', near(amount, 400), `got ${amount}`);
  check('parent shrank by exactly 400', near(parentTx.amount, -600));
  check('your share still 300', near(yourShare(parentTx), 300));
  check('Ali settled', parentTx.expenseShares[0].settled === true);
}

console.log('\n--- Editing a write-off moves only the delta ---');
{
  let tx = base();
  const created = applyWriteOff(tx, 's1', { amount: 150, category: 'Bad Debt', payee: 'Ali' });
  tx = created.parentTx;
  const woId = tx.writeOffs[0].id;
  const linked = created.writeOffTx;

  check('ceiling is 400 (250 pending + its own 150)', near(maxWriteOff(tx, tx.expenseShares[0], tx.writeOffs[0]), 400));

  const grown = editWriteOff(tx, woId, { amount: 250 }, linked);
  check('write-off is now 250', near(grown.parentTx.writeOffs[0].amount, 250));
  check('Ali now owes 150', near(personPending(grown.parentTx, 'Ali'), 150),
        `got ${personPending(grown.parentTx, 'Ali')}`);
  check('parent shrank to 750', near(grown.parentTx.amount, -750), `got ${grown.parentTx.amount}`);
  check('your share still 300', near(yourShare(grown.parentTx), 300));
  check('linked Bad Debt tx follows the amount', near(grown.childTx.amount, -250));

  const shrunk = editWriteOff(grown.parentTx, woId, { amount: 50 }, grown.childTx);
  check('shrinking gives the debt back', near(personPending(shrunk.parentTx, 'Ali'), 350),
        `got ${personPending(shrunk.parentTx, 'Ali')}`);
  check('parent back to 950', near(shrunk.parentTx.amount, -950), `got ${shrunk.parentTx.amount}`);
  check('your share STILL 300', near(yourShare(shrunk.parentTx), 300));

  const edited = editWriteOff(shrunk.parentTx, woId, { amount: 50, category: 'Gifts', payee: 'Ali B' }, shrunk.childTx);
  check('category is editable', edited.parentTx.writeOffs[0].category === 'Gifts');
  check('payee is editable', edited.parentTx.writeOffs[0].payee === 'Ali B');
  check('linked tx picks up the new category', edited.childTx.category === 'Gifts');
}

console.log('\n--- Editing a write-off cannot exceed what is outstanding ---');
{
  let tx = base();
  tx = applyWriteOff(tx, 's1', { amount: 100 }).parentTx;
  const res = editWriteOff(tx, tx.writeOffs[0].id, { amount: 9999 }, null);
  check('capped at 400', near(res.amount, 400), `got ${res.amount}`);
  check('parent shrank by exactly 400 total', near(res.parentTx.amount, -600), `got ${res.parentTx.amount}`);
  check('Ali fully written off', near(personPending(res.parentTx, 'Ali'), 0));
}

console.log('\n--- Deleting a write-off is a clean reversal ---');
{
  let tx = base();
  const created = applyWriteOff(tx, 's1', { amount: 175 });
  const removed = removeWriteOff(created.parentTx, created.parentTx.writeOffs[0].id);
  check('parent restored to -1000', near(removed.parentTx.amount, -1000), `got ${removed.parentTx.amount}`);
  check('Ali owes 400 again', near(personPending(removed.parentTx, 'Ali'), 400));
  check('no write-offs left', removed.parentTx.writeOffs.length === 0);
  check('linked Bad Debt tx is deleted', removed.deleteIds.length === 1);
  check('your share still 300', near(yourShare(removed.parentTx), 300));
}

console.log('\n--- Repayments ---');
{
  let tx = base();
  const paid = applyRepayment(tx, { personName: 'Ali', amount: 100, account: 'Cash', date: '2026-08-05' });
  check('Ali owes 300 after paying 100', near(personPending(paid.parentTx, 'Ali'), 300));
  check('parent amount untouched by a repayment', near(paid.parentTx.amount, -1000));
  check('a linked income tx is created', !!paid.childTx.create);

  const again = applyRepayment(paid.parentTx, { personName: 'Ali', amount: 50, account: 'Cash', date: '2026-08-05' });
  check('same person/account/day merges', again.parentTx.repayments.length === 1);
  check('merged to 150', near(again.parentTx.repayments[0].amount, 150));
  check('Ali owes 250', near(personPending(again.parentTx, 'Ali'), 250));

  const over = applyRepayment(again.parentTx, { personName: 'Ali', amount: 9999, account: 'Bank', date: '2026-08-06' });
  check('repayment capped at the remaining 250', near(over.amount, 250), `got ${over.amount}`);
  check('Ali is settled', near(personPending(over.parentTx, 'Ali'), 0));
  check('Ali flagged settled', over.parentTx.expenseShares[0].settled === true);
}

console.log('\n--- Repayment edit and delete ---');
{
  let tx = base();
  const paid = applyRepayment(tx, { personName: 'Ali', amount: 100, account: 'Cash', date: '2026-08-05' });
  const repId = paid.parentTx.repayments[0].id;

  check('ceiling is 400 (300 pending + its own 100)', near(maxRepayment(paid.parentTx, 'Ali', paid.parentTx.repayments[0]), 400));

  const edited = editRepayment(paid.parentTx, repId, { personName: 'Ali', amount: 250, account: 'Cash', date: '2026-08-05' }, paid.childTx.create);
  check('edited to 250', near(edited.parentTx.repayments[0].amount, 250));
  check('Ali owes 150', near(personPending(edited.parentTx, 'Ali'), 150));
  check('linked tx follows', near(edited.childTx.amount, 250));

  const removed = removeRepayment(edited.parentTx, repId);
  check('Ali owes 400 again', near(personPending(removed.parentTx, 'Ali'), 400));
  check('linked income tx deleted', removed.deleteIds.length === 1);
}

console.log('\n--- Write-off and repayment together on one share ---');
{
  let tx = base();
  tx = applyRepayment(tx, { personName: 'Ali', amount: 100, account: 'Cash', date: '2026-08-05' }).parentTx;
  check('Ali owes 300', near(personPending(tx, 'Ali'), 300));
  tx = applyWriteOff(tx, 's1', { amount: 300 }).parentTx;
  check('Ali fully covered', near(personPending(tx, 'Ali'), 0));
  check('expense reduced to 700', near(tx.amount, -700), `got ${tx.amount}`);
  check('your share still 300', near(yourShare(tx), 300), `got ${yourShare(tx)}`);
  check('Sara untouched at 300', near(personPending(tx, 'Sara'), 300));
  check('total pending is Sara only', near(totalPending(tx), 300));
}

console.log('\n--- Two people with the same name stay independent ---');
{
  const tx = {
    ...base(),
    expenseShares: [
      { id: 's1', name: 'Ali', amount: 400, settled: false },
      { id: 's2', name: 'Ali', amount: 300, settled: false }
    ]
  };
  const { parentTx } = applyWriteOff(tx, 's2', { amount: 300 });
  check('only the targeted share changed', near(parentTx.expenseShares[0].amount, 400) && near(parentTx.expenseShares[1].amount, 0),
        JSON.stringify(parentTx.expenseShares.map(s => s.amount)));
  const removed = removeWriteOff(parentTx, parentTx.writeOffs[0].id);
  check('reversal targets the same share', near(removed.parentTx.expenseShares[0].amount, 400) && near(removed.parentTx.expenseShares[1].amount, 300),
        JSON.stringify(removed.parentTx.expenseShares.map(s => s.amount)));
}

console.log(failed === 0 ? '\nALL EXPENSE-SHARE CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
