import { useMemo } from 'react';
import { formatCurrency, getCurrencySymbol } from '../../utils/format';
import { parseISO, differenceInDays } from 'date-fns';
import { convertAmount } from '../../utils/exchange';
import { getEffectiveReportingItems } from '../../utils/txAdjustments';
import { parseDayLocal } from '../../utils/date';
import { useBaseMoney } from '../../hooks/useBaseMoney';
import { addMoney, moneyEntries, mapMoney, subtractMoney, formatOne } from '../../utils/money';

// Stat tiles, used on the Stats page and in the Home page's Quick Stats.
//
// Money tiles (income, expense, savings, investment, burn, average) total per
// currency and are shown through useBaseMoney: one converted figure in
// unified mode, one figure per currency in native mode.
//
// The rest stay converted in both modes because they have no honest
// per-currency version, and carry a "converted" tag in native mode:
//   - rates (Savings, Investment, Ending Balance Rate): income lands in one
//     currency and is spent in another, so a per-currency rate is ~100% on
//     one side and deeply negative on the other;
//   - Ending Balance: it leaves transfers out, which nets to ~0 converted but
//     loses money between currencies when they are kept apart;
//   - rankings (Largest, Top): "is $100 more than ₨20,000" needs a rate. These
//     rank converted but show the winner in its own currency in native mode.

const isExpense = tx => tx.type === 0 || tx.type === 'expense';
const isIncome = tx => tx.type === 1 || tx.type === 'income';
const isInvestment = tx => (isExpense(tx) || tx.type === 2 || tx.type === 'transfer') &&
  tx.category && tx.category.toLowerCase().includes('invest');

/** Income, expense and investment as money maps, plus expense counts. */
const useTotals = (transactions) => {
  const money = useBaseMoney();
  const totals = useMemo(() => {
    const income = {};
    const expense = {};
    const investment = {};
    const expenseCount = {};
    for (const tx of getEffectiveReportingItems(transactions)) {
      const cur = money.currencyOf(tx);
      const amt = Math.abs(Number(tx.amount) || 0);
      if (isIncome(tx)) addMoney(income, cur, amt);
      else if (isExpense(tx)) { addMoney(expense, cur, amt); addMoney(expenseCount, cur, 1); }
      if (isInvestment(tx)) addMoney(investment, cur, amt);
    }
    return { income, expense, investment, expenseCount };
  }, [transactions, money]);
  return { money, ...totals };
};

// Reusable display component. Give it `value` (a number in `currency`, a
// percentage, or a string) or `moneyMap` (a per-currency total).
function StatDisplay({ value, moneyMap, currency, isPercentage, signed, converted, color, title, subtitle, mini }) {
  const money = useBaseMoney();

  let lines;
  if (moneyMap) {
    lines = money.native
      ? moneyEntries(moneyMap, money.baseCurrency).map(([c, a]) => formatOne(a, c, { signed }))
      : [formatOne(money.inBase(moneyMap), money.baseCurrency, { signed })];
  } else if (typeof value === 'string') {
    lines = [value];
  } else if (isPercentage) {
    lines = [`${value.toFixed(1)}%`];
  } else {
    lines = [`${getCurrencySymbol(currency)}${formatCurrency(Math.abs(value))}`];
  }

  const tag = converted && money.native ? <span className="converted-tag">converted</span> : null;
  const body = lines.length === 1 ? lines[0] : (
    <span className="money-lines">
      {lines.map((l, i) => <span key={i} className={i ? 'money-line-minor' : undefined}>{l}</span>)}
    </span>
  );

  if (mini) {
    return (
      <div className="qs-item">
        <span className="qs-label">{title || subtitle}{tag}</span>
        <span className="qs-value" style={{ color }}>{body}</span>
      </div>
    );
  }

  return (
    <div className="stat-widget-display" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      <div className="stat-value" style={{ color, fontSize: typeof value === 'string' ? '28px' : '36px', lineHeight: 1.2 }}>
        {body}
      </div>
      {(subtitle || tag) && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}{tag}</div>}
    </div>
  );
}

export function TotalIncome({ transactions, mini }) {
  const { income } = useTotals(transactions);
  return <StatDisplay moneyMap={income} color="#10b981" title="Total Income" mini={mini} />;
}

export function TotalExpense({ transactions, mini }) {
  const { expense } = useTotals(transactions);
  return <StatDisplay moneyMap={expense} color="#ef4444" title="Total Expense" mini={mini} />;
}

export function NetSavings({ transactions, mini }) {
  const { money, income, expense } = useTotals(transactions);
  const savings = subtractMoney(income, expense);
  const overall = money.inBase(savings);
  // Signed per currency in native mode: dollars saved and rupees overspent
  // cannot share one colour's meaning.
  return <StatDisplay moneyMap={savings} signed={money.native} color={overall >= 0 ? "#8b5cf6" : "#ef4444"} title="Net Savings" mini={mini} />;
}

export function SavingsRate({ transactions, mini }) {
  const { money, income, expense } = useTotals(transactions);
  const inc = money.inBase(income);
  const rate = inc > 0 ? ((inc - money.inBase(expense)) / inc) * 100 : 0;
  return <StatDisplay value={rate} isPercentage converted color="#3b82f6" title="Savings Rate" mini={mini} />;
}

export function TotalInvestment({ transactions, mini }) {
  const { investment } = useTotals(transactions);
  return <StatDisplay moneyMap={investment} color="#a855f7" title="Total Investment" mini={mini} />;
}

export function InvestmentRate({ transactions, mini }) {
  const { money, income, investment } = useTotals(transactions);
  const inc = money.inBase(income);
  const rate = inc > 0 ? (money.inBase(investment) / inc) * 100 : 0;
  return <StatDisplay value={rate} isPercentage converted color="#a855f7" title="Investment Rate" mini={mini} />;
}

export function BurnRate({ transactions, dateRange, mini }) {
  const { expense } = useTotals(transactions);

  const days = useMemo(() => {
    if (dateRange && dateRange.start && dateRange.end) {
      return Math.max(1, differenceInDays(new Date(dateRange.end), new Date(dateRange.start)) + 1);
    }
    if (transactions.length > 0) {
      let oldest = new Date();
      transactions.forEach(tx => {
        const d = parseISO(tx.date);
        if (d < oldest) oldest = d;
      });
      return Math.max(1, differenceInDays(new Date(), oldest) + 1);
    }
    return 30;
  }, [transactions, dateRange]);

  return <StatDisplay moneyMap={mapMoney(expense, a => a / days)} color="#f59e0b" title="Average Daily Burn" mini={mini} />;
}

// ─── Rankings: converted to compare, shown in their own currency ─────────────

const largestOfType = (rawTxs, isType, money) => {
  let max = null;
  getEffectiveReportingItems(rawTxs).forEach(tx => {
    if (!isType(tx)) return;
    const cur = money.currencyOf(tx);
    const native = Math.abs(Number(tx.amount) || 0);
    const converted = Math.abs(money.toBase(native, cur));
    if (!max || converted > max.converted) max = { tx, converted, native, currency: cur };
  });
  return max;
};

const topBy = (rawTxs, key, money) => {
  const groups = {};
  getEffectiveReportingItems(rawTxs).forEach(tx => {
    if (!isExpense(tx)) return;
    const k = key(tx);
    if (!groups[k]) groups[k] = {};
    addMoney(groups[k], money.currencyOf(tx), Math.abs(Number(tx.amount) || 0));
  });
  let top = null;
  let max = 0;
  for (const [k, map] of Object.entries(groups)) {
    const v = money.inBase(map);
    if (v > max) { max = v; top = k; }
  }
  return { name: top || 'None', map: top ? groups[top] : {} };
};

function Largest({ rawTxs, isType, color, title, mini }) {
  const money = useBaseMoney();
  const largest = useMemo(() => largestOfType(rawTxs, isType, money), [rawTxs, isType, money]);

  if (!largest) return <StatDisplay value={0} currency={money.baseCurrency} color={color} title={title} mini={mini} />;
  const subtitle = `${largest.tx.category || 'Uncategorized'} - ${largest.tx.payee || 'Unknown Payee'}`;
  return money.native
    ? <StatDisplay value={largest.native} currency={largest.currency} color={color} title={title} subtitle={subtitle} mini={mini} />
    : <StatDisplay value={largest.converted} currency={money.baseCurrency} color={color} title={title} subtitle={subtitle} mini={mini} />;
}

export function LargestExpense({ transactions: rawTxs, mini }) {
  return <Largest rawTxs={rawTxs} isType={isExpense} color="#ef4444" title="Largest Expense" mini={mini} />;
}

export function LargestIncome({ transactions: rawTxs, mini }) {
  return <Largest rawTxs={rawTxs} isType={isIncome} color="#10b981" title="Largest Income" mini={mini} />;
}

const categoryKey = tx => tx.category || 'Uncategorized';
const payeeKey = tx => tx.payee || 'Unknown';

function TopSpend({ rawTxs, keyOf, color, title, mini }) {
  const money = useBaseMoney();
  const highest = useMemo(() => topBy(rawTxs, keyOf, money), [rawTxs, keyOf, money]);
  return <StatDisplay value={highest.name} color={color} title={title} subtitle={`${money.formatMap(highest.map)} total spend`} mini={mini} />;
}

export function HighestSpendCategory({ transactions: rawTxs, mini }) {
  return <TopSpend rawTxs={rawTxs} keyOf={categoryKey} color="#f59e0b" title="Top Category" mini={mini} />;
}

export function HighestSpendPayee({ transactions: rawTxs, mini }) {
  return <TopSpend rawTxs={rawTxs} keyOf={payeeKey} color="#3b82f6" title="Top Payee" mini={mini} />;
}

const mostActive = (rawTxs, keyOf) => {
  const counts = {};
  getEffectiveReportingItems(rawTxs).forEach(tx => {
    if (isExpense(tx)) {
      const k = keyOf(tx);
      counts[k] = (counts[k] || 0) + 1;
    }
  });
  let top = null;
  let max = 0;
  Object.keys(counts).forEach(k => {
    if (counts[k] > max) { max = counts[k]; top = k; }
  });
  return { name: top || 'None', count: max };
};

export function MostActiveCategory({ transactions: rawTxs, mini }) {
  const active = useMemo(() => mostActive(rawTxs, categoryKey), [rawTxs]);
  return <StatDisplay value={active.name} color="#f59e0b" title="Most Active Cat" subtitle={`${active.count} transactions`} mini={mini} />;
}

export function MostActivePayee({ transactions: rawTxs, mini }) {
  const active = useMemo(() => mostActive(rawTxs, payeeKey), [rawTxs]);
  return <StatDisplay value={active.name} color="#3b82f6" title="Most Active Payee" subtitle={`${active.count} transactions`} mini={mini} />;
}

export function AverageExpenseSize({ transactions, mini }) {
  const { money, expense, expenseCount } = useTotals(transactions);
  const count = Object.values(expenseCount).reduce((a, b) => a + b, 0);
  // Native: the average dollar expense and the average rupee expense, each
  // over its own count. Unified: one converted average over all of them.
  const avg = money.native
    ? mapMoney(expense, (a, c) => a / (expenseCount[c] || 1))
    : { [money.baseCurrency]: count > 0 ? money.inBase(expense) / count : 0 };
  return <StatDisplay moneyMap={avg} color="#ef4444" title="Avg Expense" subtitle={`Based on ${count} expenses`} mini={mini} />;
}

// ─── Ending balance: converted in both modes (see the note at the top) ───────

const useEndingBalance = (advancedFilteredTransactions, dateRange, accounts) => {
  const money = useBaseMoney();
  return useMemo(() => {
    if (!advancedFilteredTransactions || advancedFilteredTransactions.length === 0) return null;
    const { baseCurrency, rates } = money;

    let startingBalance = 0;
    (accounts || []).forEach(acc => {
      startingBalance += convertAmount(Number(acc.initialBalance) || 0, acc.currency || 'USD', baseCurrency, rates);
    });

    // Same reporting view the Income/Expense stats use: a shared expense counts
    // only your own portion, and a loan that has been paid back contributes
    // neither its outflow nor its repayment. Reading the raw list here made
    // this tile disagree with the Total Income and Total Expense beside it.
    const sorted = getEffectiveReportingItems(advancedFilteredTransactions)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const startT = dateRange && dateRange.start ? dateRange.start.getTime() : null;
    const endT = dateRange && dateRange.end ? dateRange.end.getTime() : null;
    const inBase = (tx) => money.toBase(Number(tx.amount) || 0, money.currencyOf(tx));

    let expensesInPeriod = 0;
    let incomeInPeriod = 0;
    sorted.forEach(tx => {
      const txTime = parseDayLocal(tx.date).getTime();
      if (startT && txTime < startT) {
        if (tx.type !== 2) startingBalance += inBase(tx); // 2 = transfer
      } else if ((!startT || txTime >= startT) && (!endT || txTime <= endT)) {
        if (isExpense(tx)) expensesInPeriod += Math.abs(inBase(tx));
        else if (isIncome(tx)) incomeInPeriod += Math.abs(inBase(tx));
      }
    });

    return { startingBalance, endingBalance: startingBalance + incomeInPeriod - expensesInPeriod };
  }, [advancedFilteredTransactions, dateRange, accounts, money]);
};

export function RetainedSavings({ advancedFilteredTransactions, dateRange, accounts, mini }) {
  const money = useBaseMoney();
  const result = useEndingBalance(advancedFilteredTransactions, dateRange, accounts);
  return <StatDisplay value={result ? result.endingBalance : 0} currency={money.baseCurrency} converted color="#8b5cf6" title="Ending Balance" subtitle="Start + Income - Expense" mini={mini} />;
}

export function RetainedSavingsRate({ advancedFilteredTransactions, dateRange, accounts, mini }) {
  const result = useEndingBalance(advancedFilteredTransactions, dateRange, accounts);
  const rate = result && result.startingBalance > 0 ? (result.endingBalance / result.startingBalance) * 100 : 0;
  return <StatDisplay value={rate} isPercentage converted color="#8b5cf6" title="Ending Balance Rate" subtitle="% of starting balance" mini={mini} />;
}
