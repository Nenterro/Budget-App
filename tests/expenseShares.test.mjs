import {
  sharePending, personPending, totalPending, personWrittenOff,
  applyWriteOff, editWriteOff, removeWriteOff,
  applyRepayment, editRepayment, removeRepayment,
  maxWriteOff, maxRepayment, toBatch, findOrphanedLinks, openLoans, splitPayment
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
  const linked = created.childTx.create;

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

// -- What actually reaches the database -------------------------------------
//
// The bug that credited real money lived here, not in the arithmetic above:
// applyWriteOff returned its Bad Debt transaction under a key the modal did not
// read, so the parent expense shrank and nothing offset it. Every test above
// passed while that was broken, because they all inspected the returned object
// directly instead of the batch that actually gets saved.
console.log('\n--- Every mutation must save its counterpart transaction ---');
{
  const find = (list) => (id) => list.find(t => t.id === id);

  const tx = base();
  const wo = applyWriteOff(tx, 's1', { amount: 200, category: 'Bad Debt', payee: 'Ali' });
  const woBatch = toBatch(wo, find([tx]));
  check('write-off saves two transactions', woBatch.save.length === 2, `saved ${woBatch.save.length}`);

  const badDebt = woBatch.save.find(t => t.isWriteOff);
  check('one of them is the Bad Debt transaction', !!badDebt);
  check('Bad Debt carries the written-off amount', !!badDebt && near(badDebt.amount, -200),
        `got ${badDebt && badDebt.amount}`);

  // The whole point: writing off must not create or destroy money.
  const before = tx.amount;
  const after = woBatch.save.reduce((sum, t) => sum + t.amount, 0);
  check('total across the batch is unchanged', near(before, after), `before ${before}, after ${after}`);

  const tx2 = base();
  const rep = applyRepayment(tx2, { personName: 'Ali', amount: 150, account: 'Cash', date: '2026-08-05' });
  const repBatch = toBatch(rep, find([tx2]));
  check('repayment saves two transactions', repBatch.save.length === 2);
  check('one of them is the linked income',
        repBatch.save.some(t => t.isRepayment && near(t.amount, 150)));

  const woState = wo.parentTx;
  const edit = editWriteOff(woState, woState.writeOffs[0].id, { amount: 300 }, badDebt);
  const editBatch = toBatch(edit, find([woState, badDebt]));
  check('editing saves the updated Bad Debt too', editBatch.save.length === 2);
  check('and it carries the new amount', near(editBatch.save[1].amount, -300),
        `got ${editBatch.save[1].amount}`);
  const editTotal = editBatch.save.reduce((sum, t) => sum + t.amount, 0);
  check('editing keeps the total unchanged', near(editTotal, before),
        `expected ${before}, got ${editTotal}`);

  const removed = removeWriteOff(woState, woState.writeOffs[0].id);
  const removeBatch = toBatch(removed, find([woState, badDebt]));
  check('removing deletes the Bad Debt transaction', removeBatch.remove.length === 1);
  check('and restores the parent', near(removeBatch.save[0].amount, before),
        `got ${removeBatch.save[0].amount}`);
}

console.log('\n--- Repairing counterparts that went missing ---');
{
  // Exactly the state the dropped-write-off bug left behind.
  const wo = applyWriteOff(base(), 's1', { amount: 250, category: 'Bad Debt', payee: 'Ali' });
  const damaged = [wo.parentTx];   // its Bad Debt transaction was never saved

  const rebuilt = findOrphanedLinks(damaged);
  check('the missing Bad Debt transaction is found', rebuilt.length === 1, `found ${rebuilt.length}`);
  check('rebuilt with the amount from the record', near(rebuilt[0].amount, -250));
  check('rebuilt with the id the record already points at',
        rebuilt[0].id === wo.parentTx.writeOffs[0].linkedTxId);
  check('books balance once repaired', near(damaged[0].amount + rebuilt[0].amount, -1000),
        `got ${damaged[0].amount + rebuilt[0].amount}`);

  // Reusing the stored id keeps this safe to run repeatedly, and safe if the
  // real transaction turns up later from another device.
  check('nothing left to repair afterwards', findOrphanedLinks([...damaged, ...rebuilt]).length === 0);

  const healthy = toBatch(applyWriteOff(base(), 's1', { amount: 100 }), () => null);
  check('a healthy pair needs no repair', findOrphanedLinks(healthy.save).length === 0);

  const repaired = findOrphanedLinks([
    applyRepayment(base(), { personName: 'Ali', amount: 120, account: 'Cash', date: '2026-08-05' }).parentTx
  ]);
  check('a missing repayment income is rebuilt too', repaired.length === 1 && near(repaired[0].amount, 120),
        JSON.stringify(repaired.map(t => t.amount)));
}

console.log('\n--- Outstanding loans, flattened ---');
{
  const dinner = base();
  const taxi = {
    ...base(),
    id: 'tx2', payee: 'Taxi', date: '2026-08-09T00:00:00.000Z', amount: -500,
    expenseShares: [{ id: 's3', name: 'Ali', amount: 200, settled: false }]
  };

  const loans = openLoans([dinner, taxi, { id: 'tx3', amount: -50, payee: 'Coffee' }]);
  check('one row per person per expense', loans.length === 3, `got ${loans.length}`);
  check('a plain transaction contributes nothing', loans.every(l => l.txId !== 'tx3'));

  // The same person owing on two expenses is two rows, not one — which is why
  // a row is keyed on both ids and never on the name.
  const ali = loans.filter(l => l.personName === 'Ali');
  check('the same person can appear twice', ali.length === 2);
  check('with distinct ids', ali[0].id !== ali[1].id);
  check('each carrying its own expense', new Set(ali.map(l => l.txId)).size === 2);

  check('newest expense first', loans[0].txId === 'tx2', loans[0].txId);
  check('a row knows its parent and its share',
        loans[0].txId === 'tx2' && loans[0].shareId === 's3');
  check('pending is what is still owed',
        near(ali.find(l => l.txId === 'tx1').pending, 400));
}

console.log('\n--- A share that is no longer owed leaves the list ---');
{
  const tx = base();

  const paid = applyRepayment(tx, { personName: 'Ali', amount: 400, account: 'Cash', date: '2026-08-05' }).parentTx;
  const names = openLoans([paid]).map(l => l.personName);
  check('Ali is gone once settled', !names.includes('Ali'), names.join(','));
  check('Sara is still owing', names.includes('Sara'));

  const partly = applyRepayment(tx, { personName: 'Ali', amount: 150, account: 'Cash', date: '2026-08-05' }).parentTx;
  const rest = openLoans([partly]).find(l => l.personName === 'Ali');
  check('a part payment leaves the remainder', near(rest.pending, 250), `got ${rest && rest.pending}`);

  // Written-off debt is already out of share.amount. Subtracting it again here
  // would under-report what is owed — the trap the module header warns about.
  const written = applyWriteOff(tx, 's1', { amount: 400 }).parentTx;
  check('a written-off share is not outstanding',
        !openLoans([written]).some(l => l.personName === 'Ali'));

  check('nothing at all', openLoans([]).length === 0 && openLoans(null).length === 0);
}

console.log('\n--- A repayment carries the caller\'s note as well as its own ---');
{
  const tx = base();

  const plain = applyRepayment(tx, { personName: 'Ali', amount: 100, account: 'Cash', date: '2026-08-05' });
  check('the default still names the expense',
        plain.childTx.create.note === 'Repayment for shared expense (Dinner)',
        plain.childTx.create.note);

  const noted = applyRepayment(tx, {
    personName: 'Ali', amount: 100, account: 'Cash', date: '2026-08-05',
    note: 'Auto-added from Askari SMS'
  });
  check('provenance is added, not substituted',
        noted.childTx.create.note.startsWith('Repayment for shared expense (Dinner)')
        && noted.childTx.create.note.includes('Auto-added from Askari SMS'),
        noted.childTx.create.note);
  check('and it is still a repayment of the parent',
        noted.childTx.create.isRepayment === true
        && noted.childTx.create.parentExpenseShareTxId === 'tx1'
        && noted.childTx.create.category === 'Loan');
}

console.log('\n--- Dividing a payment between a loan and the rest ---');
{
  // Ali owes 400 and sends exactly that. Nothing is left to review.
  const exact = splitPayment(400, 400);
  check('an exact payment gives the loan everything', near(exact.toLoan, 400));
  check('and leaves nothing behind', near(exact.remainder, 0));

  // He owes 400 and sends 1000. The loan takes its 400; the other 600 is
  // ordinary income and has to come back to the queue rather than vanish with
  // the draft it arrived on.
  const over = splitPayment(1000, 400);
  check('a bigger payment is capped at what is owed', near(over.toLoan, 400));
  check('and the rest is the remainder', near(over.remainder, 600));
  check('the ceiling is what is owed', near(over.ceiling, 400));

  // He owes 400 and sends 150. The ceiling is the money, not the debt.
  const under = splitPayment(150, 400);
  check('a smaller payment gives all of itself', near(under.toLoan, 150));
  check('with nothing left over', near(under.remainder, 0));
  check('the ceiling is what arrived', near(under.ceiling, 150));

  // Choosing to spend only part of it on the loan, of the user's own accord.
  const chosen = splitPayment(1000, 400, 250);
  check('an explicit share is honoured', near(chosen.toLoan, 250));
  check('and the rest still comes back', near(chosen.remainder, 750));

  // Typing more than either bound must not move money that is not there.
  check('asking for more than is owed is capped', near(splitPayment(1000, 400, 900).toLoan, 400));
  check('asking for more than arrived is capped', near(splitPayment(150, 400, 900).toLoan, 150));
  check('the capped remainder still adds up', near(splitPayment(1000, 400, 900).remainder, 600));
  check('a negative share takes nothing', near(splitPayment(1000, 400, -50).toLoan, 0));
  check('and then the whole payment is the remainder',
        near(splitPayment(1000, 400, -50).remainder, 1000));

  // The two halves must always reconstitute the payment, or money is invented
  // or lost at the moment a draft is reduced.
  for (const [d, p, a] of [[1000, 400, 250], [33.33, 11.11, 7.77], [0.1, 0.05, 0.02], [999.99, 333.33]]) {
    const r = splitPayment(d, p, a);
    check(`${d} splits without drift`, near(r.toLoan + r.remainder, Math.round(d * 100) / 100),
          `${r.toLoan} + ${r.remainder}`);
  }

  // Thirds are where an unrounded remainder leaves a draft worth 0.004.
  const thirds = splitPayment(100, 33.333333, 33.333333);
  check('an awkward share is rounded to money', near(thirds.toLoan, 33.33), `${thirds.toLoan}`);
  check('and so is what is left', near(thirds.remainder, 66.67), `${thirds.remainder}`);

  // Degenerate input, because the amount field can hold anything mid-typing.
  check('nothing owed takes nothing', near(splitPayment(1000, 0).toLoan, 0));
  check('nothing owed returns it all', near(splitPayment(1000, 0).remainder, 1000));
  check('nothing arrived', near(splitPayment(0, 400).toLoan, 0) && near(splitPayment(0, 400).remainder, 0));
  check('an unreadable share falls back to the ceiling',
        near(splitPayment(1000, 400, NaN).toLoan, 400));
  check('undefined everything', near(splitPayment().toLoan, 0));
}

console.log(failed === 0 ? '\nALL EXPENSE-SHARE CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
