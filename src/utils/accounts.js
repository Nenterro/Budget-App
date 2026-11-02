// How an account's balance reads on its card.
//
// Balances themselves stay signed. The Total Balance pill leaves credit cards
// out altogether (see computeBalances); this only decides how one account
// presents its own figure.
//
// A credit card is the case worth separating: its balance is negative whenever
// it is in use, and "Rs-2,417.00" reads as a fault rather than as a bill. So a
// card shows what is owed as a positive amount with a word saying which way it
// points, and, when it has a limit, how much of that limit is left.

import { formatCurrency, getCurrencySymbol } from './format';

export const ACCOUNT_KINDS = { standard: 'standard', credit: 'credit' };

// Accounts saved before kinds existed have no `kind`; they are all standard.
export const isCreditAccount = (acc) => acc?.kind === ACCOUNT_KINDS.credit;

const round2 = (n) => Math.round(n * 100) / 100;

// "-₨2,417.00", not "₨-2,417.00": the sign belongs to the amount, not the digits.
export const formatSignedAmount = (amount, currency) => {
  const value = round2(Number(amount) || 0);
  const sign = value < 0 ? '-' : '';
  return `${sign}${getCurrencySymbol(currency)}${formatCurrency(Math.abs(value))}`;
};

export function describeBalance(acc) {
  const balance = round2(Number(acc?.currentBalance) || 0);
  const currency = acc?.currency;

  if (!isCreditAccount(acc)) {
    return { text: formatSignedAmount(balance, currency), caption: null, tone: balance < 0 ? 'negative' : 'neutral', limit: null };
  }

  const owed = Math.max(0, -balance);
  const caption = balance < 0 ? 'owed' : balance > 0 ? 'in credit' : 'paid off';

  // A limit is optional. Without one there is nothing to measure usage against.
  const limitValue = Number(acc.creditLimit);
  const limit = limitValue > 0
    ? {
        total: limitValue,
        // Overspending past the limit leaves nothing available, not a negative.
        available: round2(Math.max(0, limitValue - owed)),
        used: Math.min(1, owed / limitValue),
        availableText: `${getCurrencySymbol(currency)}${formatCurrency(Math.max(0, limitValue - owed))}`
      }
    : null;

  return {
    text: `${getCurrencySymbol(currency)}${formatCurrency(Math.abs(balance))}`,
    caption,
    tone: balance < 0 ? 'owed' : 'neutral',
    limit
  };
}
