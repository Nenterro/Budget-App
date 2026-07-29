/**
 * Processes raw transactions into effective reporting items for Stats, Charts, Graphs, and Widgets.
 * 
 * Rules:
 * 1. Shared Expenses (isExpenseShare = true):
 *    - User's personal share (Total - Others' Shares) hits the primary selected Category and Payee.
 *    - Pending participant shares hit Category "Loan" with Payee = Participant Name.
 *    - Repaid / settled participant shares cancel out to $0 and are excluded from stats & charts.
 * 2. Child Repayment Transactions (isRepayment = true):
 *    - Excluded from income reporting since the corresponding loan expense is also neutralized ($0 net effect).
 */

export function getEffectiveReportingItems(transactions = []) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }

  const result = [];

  for (const tx of transactions) {
    // 1. Exclude child repayment income transactions (linked to parent shared expenses)
    if (tx.isRepayment || (tx.parentExpenseShareTxId && tx.type === 1 && !tx.isWriteOff)) {
      continue;
    }

    // 2. Handle Shared Expenses
    if (tx.isExpenseShare && Array.isArray(tx.expenseShares) && tx.expenseShares.length > 0) {
      const isNegative = tx.amount < 0;
      const totalAmount = Math.abs(tx.amount || 0);

      // Calculate sum of initial shares assigned to others
      const othersInitialTotal = tx.expenseShares.reduce((acc, s) => acc + (s.amount || 0), 0);
      const userShareAmount = Math.max(0, totalAmount - othersInitialTotal);

      // Emit user's personal share under primary Category and Payee
      if (userShareAmount > 0) {
        result.push({
          ...tx,
          id: `${tx.id}_user_share`,
          amount: isNegative ? -userShareAmount : userShareAmount,
          category: tx.category || 'Uncategorized',
          payee: tx.payee || 'Shared Expense'
        });
      }

      // Process participant shares
      for (const share of tx.expenseShares) {
        const totalRepaid = (tx.repayments || [])
          .filter(r => r.personName === share.name)
          .reduce((acc, r) => acc + (r.amount || 0), 0);

        const totalWrittenOff = (tx.writeOffs || [])
          .filter(w => w.personName === share.name)
          .reduce((acc, w) => acc + (w.amount || 0), 0);

        const pendingAmount = Math.max(0, share.amount - totalRepaid - totalWrittenOff);

        // Only report UNSETTLED / PENDING loan portions under "Loan" category & Participant Payee
        // Repaid / settled loans (pendingAmount === 0) are excluded (cancel out to $0)
        if (pendingAmount > 0) {
          result.push({
            ...tx,
            id: `${tx.id}_loan_${share.id || share.name}`,
            amount: isNegative ? -pendingAmount : pendingAmount,
            category: 'Loan',
            payee: share.name,
            isUnsettledLoan: true
          });
        }
      }
    } else {
      // 3. Regular non-shared transactions pass through intact
      result.push(tx);
    }
  }

  return result;
}
