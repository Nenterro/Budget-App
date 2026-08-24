// Shared-expense arithmetic.
//
// Extracted from ExpenseSharingModal so it can be unit tested — this is the
// part that has gone wrong repeatedly, and it is nearly impossible to verify by
// clicking through the UI.
//
// The model, stated once so the rules below are checkable:
//
//   share.amount        what this person still owes, ALREADY reduced by
//                       anything written off for them
//   tx.repayments[]     money actually received; never changes share.amount
//   tx.writeOffs[]      debt forgiven; each one reduced share.amount AND the
//                       parent transaction's amount when it was created, and a
//                       separate "Bad Debt" transaction carries that portion
//   pending             share.amount - repaid   (write-offs are NOT subtracted
//                       again — they are already out of share.amount)
//
// Keeping the parent's amount and the share in step is what makes a write-off
// reversible: deleting one adds the amount back to both.

import { generateId } from '../store/db';

export const personRepaid = (tx, personName) =>
  (tx.repayments || [])
    .filter(r => r.personName === personName)
    .reduce((acc, r) => acc + (r.amount || 0), 0);

export const personWrittenOff = (tx, personName) =>
  (tx.writeOffs || [])
    .filter(w => w.personName === personName)
    .reduce((acc, w) => acc + (w.amount || 0), 0);

export const sharePending = (tx, share) =>
  Math.max(0, (share?.amount || 0) - personRepaid(tx, share?.name));

export const personPending = (tx, personName) =>
  sharePending(tx, (tx.expenseShares || []).find(s => s.name === personName));

// Derived from the amounts rather than the stored `settled` flag, which is only
// a cache and has gone stale in older records.
export const totalPending = (tx) =>
  (tx.expenseShares || []).reduce((acc, share) => acc + sharePending(tx, share), 0);

export const isFullySettled = (tx) => totalPending(tx) <= 0;

export const recomputeShares = (shares, repayments) =>
  (shares || []).map(s => {
    const repaid = (repayments || [])
      .filter(r => r.personName === s.name)
      .reduce((acc, r) => acc + (r.amount || 0), 0);
    return { ...s, settled: s.amount <= 0 || repaid >= s.amount };
  });

// Money is stored signed (expenses negative). Shrinking the magnitude of the
// parent by `delta` means moving it toward zero, whichever side of zero it is.
const shrinkTowardZero = (amount, delta) => amount + (amount < 0 ? delta : -delta);

const round2 = (n) => Math.round(n * 100) / 100;

const touch = (tx) => ({ ...tx, pendingSync: true, updatedAt: new Date().toISOString() });

// ─── Write-offs ────────────────────────────────────────────────────────────

// The most that can be written off for a share right now. Editing an existing
// write-off may grow into whatever is still pending on top of its own amount.
export const maxWriteOff = (tx, share, existingWriteOff = null) =>
  round2(sharePending(tx, share) + (existingWriteOff ? existingWriteOff.amount : 0));

export function applyWriteOff(tx, shareId, { amount, category, payee, date }) {
  const share = (tx.expenseShares || []).find(s => s.id === shareId);
  if (!share) return null;

  // Writing off more than is outstanding used to shrink the parent below what
  // was really spent.
  const capped = round2(Math.min(amount, sharePending(tx, share)));
  if (!(capped > 0)) return null;

  const writeOffTxId = generateId();
  const writeOffTx = touch({
    id: writeOffTxId,
    type: tx.type,
    amount: tx.type === 0 ? -capped : capped,
    category: category || 'Bad Debt',
    payee: payee || share.name,
    note: `Written off from shared expense (${tx.payee || 'Shared Expense'})`,
    date: date || tx.date,
    account: tx.account,
    currency: tx.currency,
    parentExpenseShareTxId: tx.id,
    isWriteOff: true
  });

  const record = {
    id: generateId(),
    shareId,
    personName: share.name,
    amount: capped,
    category: category || 'Bad Debt',
    payee: payee || share.name,
    linkedTxId: writeOffTxId,
    date: date || tx.date
  };

  const parentTx = touch({
    ...tx,
    amount: shrinkTowardZero(tx.amount, capped),
    writeOffs: [...(tx.writeOffs || []), record],
    expenseShares: recomputeShares(
      tx.expenseShares.map(s => (s.id === shareId ? { ...s, amount: round2(Math.max(0, s.amount - capped)) } : s)),
      tx.repayments
    )
  });

  return { parentTx, writeOffTx, amount: capped };
}

// Only the delta moves. Growing a write-off takes more out of the share and the
// parent; shrinking it gives the difference back.
export function editWriteOff(tx, writeOffId, { amount, category, payee, date }, linkedTx) {
  const existing = (tx.writeOffs || []).find(w => w.id === writeOffId);
  if (!existing) return null;

  const share = findShareFor(tx, existing);
  const ceiling = maxWriteOff(tx, share, existing);
  const capped = round2(Math.max(0, Math.min(amount, ceiling)));
  if (!(capped > 0)) return null;

  const delta = round2(capped - existing.amount);

  const updatedRecord = {
    ...existing,
    amount: capped,
    category: category || existing.category,
    payee: payee || existing.payee,
    date: date || existing.date
  };

  const parentTx = touch({
    ...tx,
    amount: shrinkTowardZero(tx.amount, delta),
    writeOffs: (tx.writeOffs || []).map(w => (w.id === writeOffId ? updatedRecord : w)),
    expenseShares: recomputeShares(
      (tx.expenseShares || []).map(s =>
        (share && s.id === share.id ? { ...s, amount: round2(Math.max(0, s.amount - delta)) } : s)
      ),
      tx.repayments
    )
  });

  const childTx = linkedTx
    ? touch({
        ...linkedTx,
        amount: tx.type === 0 ? -capped : capped,
        category: updatedRecord.category,
        payee: updatedRecord.payee,
        date: updatedRecord.date
      })
    : null;

  return { parentTx, childTx, amount: capped };
}

export function removeWriteOff(tx, writeOffId) {
  const record = (tx.writeOffs || []).find(w => w.id === writeOffId);
  if (!record) return null;

  const share = findShareFor(tx, record);

  const parentTx = touch({
    ...tx,
    amount: shrinkTowardZero(tx.amount, -record.amount),
    writeOffs: (tx.writeOffs || []).filter(w => w.id !== writeOffId),
    expenseShares: recomputeShares(
      (tx.expenseShares || []).map(s =>
        (share && s.id === share.id ? { ...s, amount: round2(s.amount + record.amount) } : s)
      ),
      tx.repayments
    )
  });

  return { parentTx, deleteIds: record.linkedTxId ? [record.linkedTxId] : [] };
}

// Match on shareId, falling back to the name only for records written before
// shareId existed — so two people sharing a name don't both get adjusted.
function findShareFor(tx, record) {
  const shares = tx.expenseShares || [];
  return (record.shareId && shares.find(s => s.id === record.shareId))
    || shares.find(s => s.name === record.personName)
    || null;
}

// ─── Repayments ────────────────────────────────────────────────────────────

export const maxRepayment = (tx, personName, existingRepayment = null) =>
  round2(personPending(tx, personName) + (existingRepayment ? existingRepayment.amount : 0));

export function applyRepayment(tx, { personName, amount, account, date, currency }) {
  const share = (tx.expenseShares || []).find(s => s.name === personName);
  if (!share) return null;

  // A repayment larger than the debt used to be accepted silently: the person
  // showed as settled, the surplus vanished from the share, and the linked
  // income transaction still booked the full amount.
  const capped = round2(Math.min(amount, sharePending(tx, share)));
  if (!(capped > 0)) return null;

  const day = (date || '').substring(0, 10);
  const accountToUse = account || tx.account;

  // Same person, same account, same day folds into the existing row rather than
  // creating a second near-identical transaction.
  const existingIndex = (tx.repayments || []).findIndex(
    r => r.personName === personName
      && (r.account || tx.account) === accountToUse
      && (r.date ? r.date.substring(0, 10) : '') === day
  );

  let updatedRepayments;
  let childTx;

  if (existingIndex !== -1) {
    const existing = tx.repayments[existingIndex];
    const mergedAmount = round2(existing.amount + capped);
    updatedRepayments = [...tx.repayments];
    updatedRepayments[existingIndex] = { ...existing, amount: mergedAmount };
    childTx = { mergeInto: existing.linkedTxId, amount: mergedAmount };
  } else {
    const linkedTxId = generateId();
    updatedRepayments = [...(tx.repayments || []), {
      id: generateId(),
      personName,
      amount: capped,
      date: day,
      account: accountToUse,
      linkedTxId
    }];
    childTx = {
      create: touch({
        id: linkedTxId,
        type: 1, // Income
        amount: capped,
        category: 'Loan',
        payee: personName,
        note: `Repayment for shared expense (${tx.payee || 'Expense Share'})`,
        date: new Date(day).toISOString(),
        account: accountToUse,
        currency: currency || tx.currency,
        parentExpenseShareTxId: tx.id,
        isRepayment: true
      })
    };
  }

  const parentTx = touch({
    ...tx,
    repayments: updatedRepayments,
    expenseShares: recomputeShares(tx.expenseShares, updatedRepayments)
  });

  return { parentTx, childTx, amount: capped };
}

export function editRepayment(tx, repaymentId, { personName, amount, account, date, currency }, linkedTx) {
  const existing = (tx.repayments || []).find(r => r.id === repaymentId);
  if (!existing) return null;

  const ceiling = maxRepayment(tx, personName, existing.personName === personName ? existing : null);
  const capped = round2(Math.max(0, Math.min(amount, ceiling)));
  if (!(capped > 0)) return null;

  const day = (date || existing.date || '').substring(0, 10);
  const updatedRepayments = (tx.repayments || []).map(r =>
    r.id === repaymentId
      ? { ...r, personName, amount: capped, account, date: day }
      : r
  );

  const parentTx = touch({
    ...tx,
    repayments: updatedRepayments,
    expenseShares: recomputeShares(tx.expenseShares, updatedRepayments)
  });

  const childTx = linkedTx
    ? touch({
        ...linkedTx,
        payee: personName,
        amount: capped,
        account,
        date: new Date(day).toISOString(),
        currency: currency || linkedTx.currency
      })
    : null;

  return { parentTx, childTx, amount: capped };
}

export function removeRepayment(tx, repaymentId) {
  const record = (tx.repayments || []).find(r => r.id === repaymentId);
  if (!record) return null;

  const updatedRepayments = (tx.repayments || []).filter(r => r.id !== repaymentId);

  const parentTx = touch({
    ...tx,
    repayments: updatedRepayments,
    expenseShares: recomputeShares(tx.expenseShares, updatedRepayments)
  });

  return { parentTx, deleteIds: record.linkedTxId ? [record.linkedTxId] : [] };
}
