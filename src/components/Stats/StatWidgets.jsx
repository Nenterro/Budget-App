import { useMemo } from 'react';
import { formatCurrency, getCurrencySymbol } from '../../utils/format';
import { parseISO, differenceInDays } from 'date-fns';
import { useAppearanceSettings } from '../../context/SettingsContext';
import { useData } from '../../context/DataContext';
import { convertAmount } from '../../utils/exchange';
import { getEffectiveReportingItems } from '../../utils/txAdjustments';

const calculateTotals = (rawTransactions, baseCurrency, exchangeRates, accounts) => {
  const transactions = getEffectiveReportingItems(rawTransactions);
  let income = 0;
  let expense = 0;
  let investment = 0;

  transactions.forEach(tx => {
    let amt = Math.abs(tx.amount);
    
    let txCurrency = tx.currency;
    if (!txCurrency) {
      const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
      txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
    }

    if (txCurrency !== baseCurrency) {
      amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
    }

    if (tx.type === 1 || tx.type === 'income') {
      income += amt;
    } else if (tx.type === 0 || tx.type === 'expense') {
      expense += amt;
    }
    
    // Investment calculation logic: any expense/transfer categorized as 'invest'
    if ((tx.type === 0 || tx.type === 'expense' || tx.type === 2 || tx.type === 'transfer') && 
        tx.category && tx.category.toLowerCase().includes('invest')) {
      investment += amt;
    }
  });

  return { income, expense, investment };
};

export function TotalIncome({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { income } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  return <StatDisplay value={income} currency={baseCurrency} color="#10b981" title="Total Income" mini={mini} />;
}

export function TotalExpense({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { expense } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  return <StatDisplay value={expense} currency={baseCurrency} color="#ef4444" title="Total Expense" mini={mini} />;
}

export function NetSavings({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { income, expense } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  const savings = income - expense;
  return <StatDisplay value={savings} currency={baseCurrency} color={savings >= 0 ? "#8b5cf6" : "#ef4444"} title="Net Savings" mini={mini} />;
}

export function SavingsRate({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { income, expense } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  const rate = income > 0 ? ((income - expense) / income) * 100 : 0;
  return <StatDisplay value={rate} isPercentage={true} color="#3b82f6" title="Savings Rate" mini={mini} />;
}

export function TotalInvestment({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { investment } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  return <StatDisplay value={investment} currency={baseCurrency} color="#a855f7" title="Total Investment" mini={mini} />;
}

export function InvestmentRate({ transactions, accounts, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { income, investment } = useMemo(() => calculateTotals(transactions, baseCurrency, exchangeRates, accounts), [transactions, baseCurrency, exchangeRates, accounts]);
  const rate = income > 0 ? (investment / income) * 100 : 0;
  return <StatDisplay value={rate} isPercentage={true} color="#a855f7" title="Investment Rate" mini={mini} />;
}

export function BurnRate({ transactions, accounts, dateRange, mini }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const burnRate = useMemo(() => {
    let days = 30; // Default fallback
    if (dateRange && dateRange.start && dateRange.end) {
      days = Math.max(1, differenceInDays(new Date(dateRange.end), new Date(dateRange.start)) + 1);
    } else if (transactions.length > 0) {
      // Find oldest transaction date
      let oldest = new Date();
      transactions.forEach(tx => {
        const d = parseISO(tx.date);
        if (d < oldest) oldest = d;
      });
      days = Math.max(1, differenceInDays(new Date(), oldest) + 1);
    }
    
    const { expense } = calculateTotals(transactions, baseCurrency, exchangeRates, accounts);
    return expense / days;
  }, [transactions, dateRange, baseCurrency, accounts, exchangeRates]);

  return <StatDisplay value={burnRate} currency={baseCurrency} color="#f59e0b" title="Average Daily Burn" mini={mini} />;
}

// Reusable display component
function StatDisplay({ value, currency, isPercentage, color, title, subtitle, mini }) {
  const displayValue = isPercentage 
    ? `${value.toFixed(1)}%`
    : `${getCurrencySymbol(currency)}${formatCurrency(Math.abs(value))}`;
    
  if (mini) {
    return (
      <div className="qs-item">
        <span className="qs-label">{title || subtitle}</span>
        <span className="qs-value" style={{ color }}>{typeof value === 'string' ? value : displayValue}</span>
      </div>
    );
  }
    
  return (
    <div className="stat-widget-display" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      <div className="stat-value" style={{ color, fontSize: typeof value === 'string' ? '28px' : '36px', lineHeight: 1.2 }}>
        {typeof value === 'string' ? value : displayValue}
      </div>
      {subtitle && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</div>}
    </div>
  );
}
export function LargestExpense({ transactions: rawTxs, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  const largest = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    let max = null;
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        if (!max || Math.abs(tx.amount) > Math.abs(max.amount)) {
          max = tx;
        }
      }
    });
    return max;
  }, [rawTxs]);
  
  if (!largest) return <StatDisplay value={0} currency={baseCurrency} color="#ef4444" title="Largest Expense" mini={mini} />;
  const subtitle = `${largest.category || 'Uncategorized'} - ${largest.payee || 'Unknown Payee'}`;
  return <StatDisplay value={-largest.amount} currency={baseCurrency} color="#ef4444" title="Largest Expense" subtitle={subtitle} mini={mini} />;
}

export function LargestIncome({ transactions: rawTxs, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  const largest = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    let max = null;
    transactions.forEach(tx => {
      if (tx.type === 1 || tx.type === 'income') {
        if (!max || Math.abs(tx.amount) > Math.abs(max.amount)) {
          max = tx;
        }
      }
    });
    return max;
  }, [rawTxs]);
  
  if (!largest) return <StatDisplay value={0} currency={baseCurrency} color="#10b981" title="Largest Income" mini={mini} />;
  const subtitle = `${largest.category || 'Uncategorized'} - ${largest.payee || 'Unknown Payee'}`;
  return <StatDisplay value={largest.amount} currency={baseCurrency} color="#10b981" title="Largest Income" subtitle={subtitle} mini={mini} />;
}

export function HighestSpendCategory({ transactions: rawTxs, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  const highest = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const sums = {};
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const cat = tx.category || 'Uncategorized';
        sums[cat] = (sums[cat] || 0) + Math.abs(tx.amount);
      }
    });
    let top = null;
    let max = 0;
    Object.keys(sums).forEach(k => {
      if (sums[k] > max) {
        max = sums[k];
        top = k;
      }
    });
    return { name: top || 'None', amount: max };
  }, [rawTxs]);
  
  return <StatDisplay value={highest.name} color="#f59e0b" title="Top Category" subtitle={`${getCurrencySymbol(baseCurrency)}${formatCurrency(highest.amount)} total spend`} mini={mini} />;
}

export function HighestSpendPayee({ transactions: rawTxs, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  const highest = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const sums = {};
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const payee = tx.payee || 'Unknown';
        sums[payee] = (sums[payee] || 0) + Math.abs(tx.amount);
      }
    });
    let top = null;
    let max = 0;
    Object.keys(sums).forEach(k => {
      if (sums[k] > max) {
        max = sums[k];
        top = k;
      }
    });
    return { name: top || 'None', amount: max };
  }, [rawTxs]);
  
  return <StatDisplay value={highest.name} color="#3b82f6" title="Top Payee" subtitle={`${getCurrencySymbol(baseCurrency)}${formatCurrency(highest.amount)} total spend`} mini={mini} />;
}

export function MostActiveCategory({ transactions: rawTxs, mini }) {
  const active = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const counts = {};
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const cat = tx.category || 'Uncategorized';
        counts[cat] = (counts[cat] || 0) + 1;
      }
    });
    let top = null;
    let max = 0;
    Object.keys(counts).forEach(k => {
      if (counts[k] > max) {
        max = counts[k];
        top = k;
      }
    });
    return { name: top || 'None', count: max };
  }, [rawTxs]);
  
  return <StatDisplay value={active.name} color="#f59e0b" title="Most Active Cat" subtitle={`${active.count} transactions`} mini={mini} />;
}

export function MostActivePayee({ transactions: rawTxs, mini }) {
  const active = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const counts = {};
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const payee = tx.payee || 'Unknown';
        counts[payee] = (counts[payee] || 0) + 1;
      }
    });
    let top = null;
    let max = 0;
    Object.keys(counts).forEach(k => {
      if (counts[k] > max) {
        max = counts[k];
        top = k;
      }
    });
    return { name: top || 'None', count: max };
  }, [rawTxs]);
  
  return <StatDisplay value={active.name} color="#3b82f6" title="Most Active Payee" subtitle={`${active.count} transactions`} mini={mini} />;
}

export function AverageExpenseSize({ transactions: rawTxs, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  const { avg, count } = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    let sum = 0;
    let count = 0;
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        sum += Math.abs(tx.amount);
        count++;
      }
    });
    return { avg: count > 0 ? sum / count : 0, count };
  }, [rawTxs]);
  
  return <StatDisplay value={avg} currency={baseCurrency} color="#ef4444" title="Avg Expense" subtitle={`Based on ${count} expenses`} mini={mini} />;
}

export function RetainedSavings({ advancedFilteredTransactions, dateRange, accounts, mini }) {
  const baseCurrency = accounts && accounts.length > 0 ? accounts[0].currency : 'PKR';
  
  const retained = useMemo(() => {
    if (!advancedFilteredTransactions || advancedFilteredTransactions.length === 0) return 0;
    
    // Calculate starting balance
    let startingBalance = 0;
    if (accounts) {
      accounts.forEach(acc => {
        startingBalance += (Number(acc.initialBalance) || 0);
      });
    }
    
    const sorted = [...advancedFilteredTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const startT = dateRange && dateRange.start ? dateRange.start.getTime() : null;
    const endT = dateRange && dateRange.end ? dateRange.end.getTime() : null;
    
    let expensesInPeriod = 0;
    let incomeInPeriod = 0;
    
    sorted.forEach(tx => {
      const txTime = parseISO(tx.date).getTime();
      
      if (startT && txTime < startT) {
        if (tx.type !== 2) { // 2 = transfer
          startingBalance += tx.amount;
        }
      } else if ((!startT || txTime >= startT) && (!endT || txTime <= endT)) {
        if (tx.type === 0 || tx.type === 'expense') {
          expensesInPeriod += Math.abs(tx.amount);
        } else if (tx.type === 1 || tx.type === 'income') {
          incomeInPeriod += Math.abs(tx.amount);
        }
      }
    });
    
    return startingBalance + incomeInPeriod - expensesInPeriod;
  }, [advancedFilteredTransactions, dateRange, accounts]);
  
  return <StatDisplay value={retained} currency={baseCurrency} color="#8b5cf6" title="Ending Balance" subtitle="Start + Income - Expense" mini={mini} />;
}

export function RetainedSavingsRate({ advancedFilteredTransactions, dateRange, accounts, mini }) {
  const rate = useMemo(() => {
    if (!advancedFilteredTransactions || advancedFilteredTransactions.length === 0) return 0;
    
    // Calculate starting balance
    let startingBalance = 0;
    if (accounts) {
      accounts.forEach(acc => {
        startingBalance += (Number(acc.initialBalance) || 0);
      });
    }
    
    const sorted = [...advancedFilteredTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const startT = dateRange && dateRange.start ? dateRange.start.getTime() : null;
    const endT = dateRange && dateRange.end ? dateRange.end.getTime() : null;
    
    let expensesInPeriod = 0;
    let incomeInPeriod = 0;
    
    sorted.forEach(tx => {
      const txTime = parseISO(tx.date).getTime();
      
      if (startT && txTime < startT) {
        if (tx.type !== 2) { // 2 = transfer
          startingBalance += tx.amount;
        }
      } else if ((!startT || txTime >= startT) && (!endT || txTime <= endT)) {
        if (tx.type === 0 || tx.type === 'expense') {
          expensesInPeriod += Math.abs(tx.amount);
        } else if (tx.type === 1 || tx.type === 'income') {
          incomeInPeriod += Math.abs(tx.amount);
        }
      }
    });
    
    const endingBalance = startingBalance + incomeInPeriod - expensesInPeriod;
    return startingBalance > 0 ? (endingBalance / startingBalance) * 100 : 0;
  }, [advancedFilteredTransactions, dateRange, accounts]);
  
  return <StatDisplay value={rate} isPercentage={true} color="#8b5cf6" title="Ending Balance Rate" subtitle="% of starting balance" mini={mini} />;
}
