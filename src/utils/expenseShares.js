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

  // Every mutation reports its child transaction under `childTx`, in the shape
  // toBatch() understands. This one used to return it as `writeOffTx`, which
  // nothing read — so the Bad Debt transaction was silently never saved while
  // the parent expense had already been shrunk by the same amount, quietly
  // crediting the account.
  return { parentTx, childTx: { create: writeOffTx }, amount: capped };
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

// ─── Rounded repayments ────────────────────────────────────────────────────
//
// People rarely send the exact figure: 1,234 owed comes back as 1,200 or
// 1,250. Accepting it "in full" means the amount they sent becomes what they
// owed — their share moves by the difference, so they show as settled, and
// your own share absorbs it (a little more if they rounded down, a little less
// if they rounded up). The parent's amount is untouched: you paid what you
// paid.
//
// The difference is stored on the repayment as `adjustment`, which is what
// makes it reversible: deleting the repayment takes it back off the share,
// and editing one starts again from the share as it was before.

// How far from what is owed a payment may be and still settle it: one step of
// the amount's second digit from the left, which is how people round, but
// never less than ROUNDING_MINIMUM. 15,600 allows 1,000 either way; 1,234 and
// 400 both allow 100 (the floor); 87 allows 100 too, so any payment at all
// can settle a debt that small — the toggle still says so and can be turned
// off.
//
// The floor is a plain number, picked for rupees. It is not converted, so in
// a currency with much larger units it is generous accordingly.
export const ROUNDING_MINIMUM = 100;

export function roundingTolerance(owed) {
  const value = Math.abs(Number(owed) || 0);
  if (!(value > 0)) return 0;
  return Math.max(ROUNDING_MINIMUM, 10 ** (Math.floor(Math.log10(value)) - 1));
}

const yourShare = (tx) =>
  round2(Math.abs(tx.amount || 0) - (tx.expenseShares || []).reduce((a, s) => a + (s.amount || 0), 0));

// The expense as it would be without this repayment's adjustment.
export function withoutAdjustment(tx, record) {
  if (!record?.adjustment) return tx;
  return {
    ...tx,
    expenseShares: (tx.expenseShares || []).map(s =>
      (s.name === record.personName ? { ...s, amount: round2(s.amount - record.adjustment) } : s)),
    repayments: (tx.repayments || []).map(r => (r.id === record.id ? { ...r, adjustment: 0 } : r))
  };
}

const adjustShare = (shares, personName, delta) =>
  (delta ? (shares || []).map(s => (s.name === personName ? { ...s, amount: round2(s.amount + delta) } : s)) : shares);

/**
 * Whether `amount` from `personName` can be accepted as settling what they
 * owe, and by how much their share would move. Null when it is not a
 * rounding: exact, too far off, or more than your own share could absorb.
 * `existingRepayment` is the record being edited, if any (same person only).
 */
export function roundingSettlement(tx, personName, amount, existingRepayment = null) {
  const owed = maxRepayment(tx, personName, existingRepayment);
  const paid = round2(Number(amount) || 0);
  const diff = round2(paid - owed);
  if (!(owed > 0) || !(paid > 0) || Math.abs(diff) < 0.005) return null;
  if (Math.abs(diff) > roundingTolerance(owed) + 0.005) return null;
  // Rounding up takes the extra out of your share, which cannot go below zero.
  if (diff > 0 && diff > yourShare(tx) + 0.005) return null;
  return { owed, paid, diff };
}

// What the repayment's own transaction says it is. A caller with something to
// add — the inbox, which knows the message the payment was detected from —
// passes it as `note` and gets both, rather than replacing the only line that
// says which expense this money came back from.
const repaymentNote = (tx, extra) => {
  const base = `Repayment for shared expense (${tx.payee || 'Expense Share'})`;
  return extra ? `${base} • ${extra}` : base;
};

export function applyRepayment(tx, { personName, amount, account, date, currency, note, settleInFull = false }) {
  const share = (tx.expenseShares || []).find(s => s.name === personName);
  if (!share) return null;

  // Accepting a rounded figure moves their share to meet it; anything not
  // within the rounding tolerance is an ordinary (capped) repayment.
  const adjustment = settleInFull ? (roundingSettlement(tx, personName, amount)?.diff || 0) : 0;

  // A repayment larger than the debt used to be accepted silently: the person
  // showed as settled, the surplus vanished from the share, and the linked
  // income transaction still booked the full amount.
  const capped = round2(Math.min(amount, sharePending(tx, share) + adjustment));
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
    const mergedAdjustment = round2((existing.adjustment || 0) + adjustment);
    updatedRepayments[existingIndex] = {
      ...existing,
      amount: mergedAmount,
      ...(mergedAdjustment ? { adjustment: mergedAdjustment } : {})
    };
    childTx = { mergeInto: existing.linkedTxId, amount: mergedAmount };
  } else {
    const linkedTxId = generateId();
    updatedRepayments = [...(tx.repayments || []), {
      id: generateId(),
      personName,
      amount: capped,
      date: day,
      account: accountToUse,
      linkedTxId,
      ...(adjustment ? { adjustment } : {})
    }];
    childTx = {
      create: touch({
        id: linkedTxId,
        type: 1, // Income
        amount: capped,
        category: 'Loan',
        payee: personName,
        note: repaymentNote(tx, note),
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
    expenseShares: recomputeShares(adjustShare(tx.expenseShares, personName, adjustment), updatedRepayments)
  });

  return { parentTx, childTx, amount: capped, adjustment };
}

export function editRepayment(tx, repaymentId, { personName, amount, account, date, currency, settleInFull = false }, linkedTx) {
  const existing = (tx.repayments || []).find(r => r.id === repaymentId);
  if (!existing) return null;

  // Start from the share as it was before this repayment moved it, so an edit
  // never stacks a second adjustment on the first.
  const base = withoutAdjustment(tx, existing);
  const samePerson = existing.personName === personName ? existing : null;
  const adjustment = settleInFull
    ? (roundingSettlement(base, personName, amount, samePerson)?.diff || 0)
    : 0;

  const ceiling = round2(maxRepayment(base, personName, samePerson) + adjustment);
  const capped = round2(Math.max(0, Math.min(amount, ceiling)));
  if (!(capped > 0)) return null;

  const day = (date || existing.date || '').substring(0, 10);
  const updatedRepayments = (base.repayments || []).map(r => {
    if (r.id !== repaymentId) return r;
    const { adjustment: _old, ...rest } = r;
    return { ...rest, personName, amount: capped, account, date: day, ...(adjustment ? { adjustment } : {}) };
  });

  const parentTx = touch({
    ...tx,
    repayments: updatedRepayments,
    expenseShares: recomputeShares(adjustShare(base.expenseShares, personName, adjustment), updatedRepayments)
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

  // A rounded repayment moved the share to meet it; taking it away moves the
  // share back, so they owe what they owed before.
  const parentTx = touch({
    ...tx,
    repayments: updatedRepayments,
    expenseShares: recomputeShares(withoutAdjustment(tx, record).expenseShares, updatedRepayments)
  });

  return { parentTx, deleteIds: record.linkedTxId ? [record.linkedTxId] : [] };
}

// ─── Outstanding loans ──────────────────────────────────────────
//
// The shared-expenses list answers "which expense is still outstanding". Money
// arriving in your account asks the other question — "who owes me, and how
// much" — which cuts across expenses: one person can owe on three of them.
//
// So the same pending amounts, flattened one row per person per expense. A row
// carries both ids because `applyRepayment` needs the parent transaction, and
// the name alone does not identify which expense it was owed on.

export function openLoans(transactions) {
  const loans = [];

  for (const tx of transactions || []) {
    if (!tx.isExpenseShare || !Array.isArray(tx.expenseShares)) continue;

    for (const share of tx.expenseShares) {
      const pending = round2(sharePending(tx, share));
      if (!(pending > 0)) continue;

      loans.push({
        // Unique per row: the same person can owe on several expenses, and a
        // picker keyed on the name alone would collapse them into one.
        id: `${tx.id}::${share.id}`,
        txId: tx.id,
        shareId: share.id,
        personName: share.name,
        pending,
        expensePayee: tx.payee || 'Shared expense',
        date: tx.date,
        account: tx.account,
        currency: tx.currency
      });
    }
  }

  // Newest expense first, largest debt first within a day — the order the
  // shared-expenses list already uses.
  return loans.sort((a, b) =>
    new Date(b.date) - new Date(a.date) || b.pending - a.pending);
}

// ─── Dividing a payment between a loan and the rest ─────────────────
//
// Money arriving need not be all one thing. Someone who owes 400 can send
// 1000, and only the 400 belongs to the expense; the other 600 is ordinary
// income and has to be reviewed as such.
//
// So a payment has a ceiling — it can never give a loan more than is owed, nor
// more than actually arrived — and whatever it does not use is the remainder.
// Both are rounded, because a remainder computed from unrounded halves is how
// a stray 0.004 ends up in the queue as a draft worth nothing.

export function splitPayment(detected, pending, applied) {
  const total = round2(Math.max(0, Number(detected) || 0));
  const ceiling = round2(Math.min(total, Math.max(0, Number(pending) || 0)));

  // Undefined means "as much as it can take", which is what opening the tool
  // should offer: the common case is a payment that settles exactly.
  const wanted = applied === null || applied === undefined || !Number.isFinite(Number(applied))
    ? ceiling
    : Number(applied);

  const toLoan = round2(Math.max(0, Math.min(wanted, ceiling)));
  return { ceiling, toLoan, remainder: round2(total - toLoan) };
}

// The same division, aware of rounding. A payment a little off what is owed —
// 390 or 410 against 400 — can settle the loan in full (see
// roundingSettlement), in which case all of it goes to the loan and nothing is
// left in the queue. `settle` is the user's choice; `rounding` says whether
// the choice applies at all, so the screen knows whether to offer it.
//
// Which figure is the near miss: if the loan is being given everything it can
// take, the whole payment (410 arriving for 400 owed); if the user typed less,
// what they typed (390 of a larger payment); if they typed more, that.
export function planRepayment(tx, personName, detected, applied, settle = true) {
  const pending = tx ? personPending(tx, personName) : 0;
  const total = round2(Math.max(0, Number(detected) || 0));
  const split = splitPayment(total, pending, applied);
  const given = applied !== null && applied !== undefined && Number.isFinite(Number(applied));
  const wanted = given ? round2(Number(applied)) : split.ceiling;

  const candidate = wanted > split.ceiling + 0.005
    ? Math.min(wanted, total)
    : wanted >= split.ceiling - 0.005 ? total : wanted;
  const rounding = tx && candidate > 0 && candidate <= total + 0.005
    ? roundingSettlement(tx, personName, candidate)
    : null;

  if (rounding && settle) {
    return {
      ceiling: split.ceiling,
      toLoan: rounding.paid,
      remainder: round2(total - rounding.paid),
      loanRemaining: 0,
      rounding,
      settling: true,
      over: false
    };
  }

  return {
    ...split,
    loanRemaining: round2(Math.max(0, pending - split.toLoan)),
    rounding,
    settling: false,
    over: given && wanted > split.ceiling + 0.005
  };
}

// ─── Turning a mutation into a save batch ──────────────────────────────────
//
// The single place that decides what actually reaches the database. It used to
// live inside the modal, which let a helper return its child under a key the
// modal did not read, with no test able to catch it.
//
// `findTx` resolves an id to an existing transaction, for the merge case.
export function toBatch(result, findTx) {
  if (!result) return null;

  const save = [result.parentTx];
  const remove = result.deleteIds || [];
  const child = result.childTx;

  if (child) {
    if (child.create) {
      save.push(child.create);
    } else if (child.mergeInto) {
      const linked = findTx(child.mergeInto);
      if (linked) save.push(touch({ ...linked, amount: child.amount }));
    } else {
      save.push(child);
    }
  }

  return { save, remove };
}

// ─── Repairing orphaned links ──────────────────────────────────────────────
//
// A write-off or repayment always has a counterpart transaction: the parent's
// amount is reduced by the write-off and a Bad Debt transaction carries that
// portion, so if the counterpart goes missing the books gain money out of
// nowhere. Records written while applyWriteOff's result was being dropped are
// in exactly that state.
//
// Rebuilt with the id already stored on the record, so this is idempotent: if
// the real transaction turns up later from another device it is the same
// record, not a duplicate.
export function findOrphanedLinks(transactions) {
  const byId = new Map((transactions || []).map(t => [t.id, t]));
  const rebuilt = [];

  for (const tx of transactions || []) {
    if (!tx.isExpenseShare || !Array.isArray(tx.expenseShares)) continue;

    for (const record of tx.writeOffs || []) {
      if (!record.linkedTxId || byId.has(record.linkedTxId)) continue;
      rebuilt.push(touch({
        id: record.linkedTxId,
        type: tx.type,
        amount: tx.type === 0 ? -record.amount : record.amount,
        category: record.category || 'Bad Debt',
        payee: record.payee || record.personName,
        note: `Written off from shared expense (${tx.payee || 'Shared Expense'})`,
        date: record.date || tx.date,
        account: tx.account,
        currency: tx.currency,
        parentExpenseShareTxId: tx.id,
        isWriteOff: true
      }));
    }

    for (const record of tx.repayments || []) {
      if (!record.linkedTxId || byId.has(record.linkedTxId)) continue;
      rebuilt.push(touch({
        id: record.linkedTxId,
        type: 1,
        amount: record.amount,
        category: 'Loan',
        payee: record.personName,
        note: repaymentNote(tx),
        date: record.date ? new Date(record.date).toISOString() : tx.date,
        account: record.account || tx.account,
        currency: tx.currency,
        parentExpenseShareTxId: tx.id,
        isRepayment: true
      }));
    }
  }

  return rebuilt;
}

// ─── Looking across expenses: by person, by payee ──────────────────────────
//
// The list answers one expense at a time. These answer the cross-cutting
// questions — "what does Ali owe me in total, and on what?", "what has
// everyone run up at this restaurant?" — from the same per-share arithmetic,
// so a total here always agrees with the detail view it breaks down into.
//
// Money is grouped by currency rather than summed: shared expenses can sit on
// accounts in different currencies, and adding rupees to dollars gives a
// number that is wrong in both. `currencyOf(tx)` resolves the code the same
// way the modal does (account currency first).
//
// Names match case-insensitively and ignore surrounding spaces, because the
// same friend typed as "Ali" and "ali " on two expenses is one person.

export const nameKey = (value) => String(value || '').trim().toLowerCase();

const sharedOnly = (transactions) =>
  (transactions || []).filter(tx =>
    tx.isExpenseShare && Array.isArray(tx.expenseShares) && tx.expenseShares.length > 0);

const defaultCurrencyOf = (tx) => tx.currency || '';

const bump = (totals, currency, fields) => {
  const row = totals[currency] || (totals[currency] = {});
  for (const [key, value] of Object.entries(fields)) {
    row[key] = round2((row[key] || 0) + (value || 0));
  }
};

const pendingAcross = (totals) =>
  round2(Object.values(totals).reduce((a, t) => a + (t.pending || 0), 0));

// Write-offs are matched to the share by id where the record has one, the same
// way removeWriteOff finds it, so two people with one name stay apart.
const shareWrittenOff = (tx, share) =>
  (tx.writeOffs || [])
    .filter(w => (w.shareId ? w.shareId === share.id : w.personName === share.name))
    .reduce((acc, w) => acc + (w.amount || 0), 0);

// One person's position on one expense. `share` is what they were originally
// asked for: share.amount has write-offs taken out already, so they go back in.
const shareFigures = (tx, share) => {
  const writtenOff = round2(shareWrittenOff(tx, share));
  return {
    share: round2((share.amount || 0) + writtenOff),
    repaid: round2(personRepaid(tx, share.name)),
    writtenOff,
    pending: round2(sharePending(tx, share))
  };
};

// The bill as it was paid. tx.amount shrinks by every write-off, but the money
// left the account in full — the written-off part moved to a Bad Debt
// transaction, it was not refunded.
const billOf = (tx) =>
  round2(Math.abs(tx.amount || 0) + (tx.writeOffs || []).reduce((a, w) => a + (w.amount || 0), 0));

const yourShareOf = (tx) =>
  round2(Math.abs(tx.amount || 0) - (tx.expenseShares || []).reduce((a, s) => a + (s.amount || 0), 0));

// Still-owing expenses first, then newest.
const byOutstandingThenDate = (a, b) =>
  (b.pending > 0) - (a.pending > 0) || new Date(b.tx.date) - new Date(a.tx.date);

// Whoever owes most first; the alphabet only breaks ties.
const byPendingThenName = (a, b) => b.pending - a.pending || a.name.localeCompare(b.name);

// Everyone and every payee whose name contains `query`, with what is still
// outstanding, for the search results. An empty query matches everything.
export function searchShared(transactions, query, currencyOf = defaultCurrencyOf) {
  const q = nameKey(query);
  const people = new Map();
  const payees = new Map();

  const add = (map, key, name, tx, pending) => {
    const entry = map.get(key) || { key, name: name.trim(), ids: new Set(), totals: {} };
    entry.ids.add(tx.id);
    bump(entry.totals, currencyOf(tx), { pending });
    map.set(key, entry);
  };

  for (const tx of sharedOnly(transactions)) {
    for (const share of tx.expenseShares) {
      const key = nameKey(share.name);
      if (key && key.includes(q)) add(people, key, share.name, tx, sharePending(tx, share));
    }
    const key = nameKey(tx.payee);
    if (key && key.includes(q)) add(payees, key, tx.payee, tx, totalPending(tx));
  }

  const finish = (e) => ({
    key: e.key, name: e.name, count: e.ids.size, totals: e.totals, pending: pendingAcross(e.totals)
  });

  // This feeds an autocomplete, so a name that starts with what was typed
  // beats one that merely contains it ("Al" → Ali before Khalid); after that,
  // whoever owes most.
  const rank = (a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || byPendingThenName(a, b);

  return {
    people: [...people.values()].map(finish).sort(rank),
    payees: [...payees.values()].map(finish).sort(rank)
  };
}

// One person across every shared expense they are on: their totals, the same
// broken down by payee, and each expense with their part of it.
export function personSummary(transactions, personName, currencyOf = defaultCurrencyOf) {
  const key = nameKey(personName);
  const totals = {};
  const payees = new Map();
  const expenses = [];
  let name = String(personName || '').trim();

  for (const tx of sharedOnly(transactions)) {
    const currency = currencyOf(tx);
    for (const share of tx.expenseShares) {
      if (nameKey(share.name) !== key) continue;
      name = share.name.trim() || name;

      const figures = shareFigures(tx, share);
      bump(totals, currency, figures);
      expenses.push({ tx, shareId: share.id, currency, ...figures });

      const payeeKey = nameKey(tx.payee);
      const entry = payees.get(payeeKey)
        || { key: payeeKey, name: (tx.payee || '').trim(), count: 0, totals: {} };
      entry.count += 1;
      bump(entry.totals, currency, figures);
      payees.set(payeeKey, entry);
    }
  }

  return {
    name,
    totals,
    pending: pendingAcross(totals),
    byPayee: [...payees.values()]
      .map(p => ({ ...p, pending: pendingAcross(p.totals) }))
      .sort(byPendingThenName),
    expenses: expenses.sort(byOutstandingThenDate)
  };
}

// One payee across every shared expense paid there: what was spent, your part,
// what each person on those expenses owes, and the expenses themselves.
export function payeeSummary(transactions, payee, currencyOf = defaultCurrencyOf) {
  const key = nameKey(payee);
  const totals = {};
  const people = new Map();
  const expenses = [];
  let name = String(payee || '').trim();

  for (const tx of sharedOnly(transactions)) {
    if (nameKey(tx.payee) !== key) continue;
    name = (tx.payee || '').trim() || name;

    const currency = currencyOf(tx);
    const bill = billOf(tx);
    const pending = round2(totalPending(tx));
    bump(totals, currency, { spent: bill, yours: yourShareOf(tx), pending });
    expenses.push({ tx, currency, bill, pending });

    for (const share of tx.expenseShares) {
      const personKey = nameKey(share.name);
      if (!personKey) continue;
      const entry = people.get(personKey)
        || { key: personKey, name: share.name.trim(), count: 0, totals: {} };
      entry.count += 1;
      bump(entry.totals, currency, shareFigures(tx, share));
      people.set(personKey, entry);
    }
  }

  return {
    name,
    totals,
    pending: pendingAcross(totals),
    people: [...people.values()]
      .map(p => ({ ...p, pending: pendingAcross(p.totals) }))
      .sort(byPendingThenName),
    expenses: expenses.sort(byOutstandingThenDate)
  };
}
