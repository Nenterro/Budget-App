import { useMemo, useState } from 'react';
import { Trash2, Plus, X } from 'lucide-react';
import { formatCurrency, getCurrencySymbol } from '../../utils/format';
import { parseISO, format, subDays, isAfter, startOfDay } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as Widgets from '../Stats/StatWidgets';
import AddStatModal from '../Stats/AddStatModal';
import { useAppearanceSettings } from '../../context/SettingsContext';
import { useData } from '../../context/DataContext';
import { convertAmount } from '../../utils/exchange';
import { getEffectiveReportingItems } from '../../utils/txAdjustments';

import { WIDGET_TYPES } from './AddDashboardWidgetModal';

const formatCompactNumber = (amount) => {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(amount);
};

export default function DashboardWidgetCard({ widget, onUpdate, onRemove, transactions, advancedFilteredTransactions, accounts, dateRange }) {
  const typeDef = WIDGET_TYPES.find(t => t.id === widget.type) || { title: 'Unknown Widget' };

  const renderWidget = () => {
    switch (widget.type) {
      case 'quick_stats': return <QuickStats widget={widget} onUpdate={onUpdate} transactions={transactions} advancedFilteredTransactions={advancedFilteredTransactions} accounts={accounts} dateRange={dateRange} />;
      case 'seven_day_trend': return <SevenDayExpenseChart transactions={transactions} accounts={accounts} />;
      case 'recent_transactions': return <RecentTransactions transactions={transactions} accounts={accounts} />;
      case 'mini_cash_flow': return <MiniCashFlow transactions={transactions} accounts={accounts} />;
      case 'top_categories': return <TopCategories transactions={transactions} accounts={accounts} />;
      case 'top_payees': return <TopPayees transactions={transactions} accounts={accounts} />;
      default: return <div style={{ color: 'var(--text-secondary)' }}>Widget not implemented</div>;
    }
  };

  return (
    <div className="widget-card-wrapper">
      <div className="widget-header">
        <h3 className="widget-title">{typeDef.title}</h3>
        <button className="widget-remove-btn" onClick={onRemove} title="Remove widget">
          <Trash2 size={16} />
        </button>
      </div>
      {renderWidget()}
    </div>
  );
}

const STAT_COMPONENT_MAP = {
  total_income: 'TotalIncome',
  total_expense: 'TotalExpense',
  net_savings: 'NetSavings',
  savings_rate: 'SavingsRate',
  retained_savings: 'RetainedSavings',
  retained_savings_rate: 'RetainedSavingsRate',
  total_investment: 'TotalInvestment',
  investment_rate: 'InvestmentRate',
  burn_rate: 'BurnRate',
  largest_expense: 'LargestExpense',
  largest_income: 'LargestIncome',
  highest_spend_category: 'HighestSpendCategory',
  highest_spend_payee: 'HighestSpendPayee',
  most_active_category: 'MostActiveCategory',
  most_active_payee: 'MostActivePayee',
  average_expense_size: 'AverageExpenseSize'
};

function QuickStats({ widget, onUpdate, transactions, advancedFilteredTransactions, accounts, dateRange }) {
  const stats = widget.stats || [null, null, null, null];
  const [modalSlot, setModalSlot] = useState(null);

  const handleSelectStat = (statType) => {
    const newStats = [...stats];
    newStats[modalSlot] = statType;
    onUpdate({ ...widget, stats: newStats });
    setModalSlot(null);
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="qs-grid">
        {stats.map((statId, idx) => {
          if (!statId) {
            return (
              <div key={`empty-${idx}`} className="qs-item" style={{ cursor: 'pointer', borderStyle: 'dashed' }} onClick={() => setModalSlot(idx)}>
                <Plus size={24} color="var(--text-muted)" />
                <span className="qs-label" style={{ marginTop: '4px', marginBottom: 0 }}>Add Stat</span>
              </div>
            );
          }

          const componentName = STAT_COMPONENT_MAP[statId];
          const StatComponent = Widgets[componentName];

          if (!StatComponent) return <div key={idx} className="qs-item">Unknown</div>;

          return (
            <div key={`${statId}-${idx}`} className="qs-item-wrapper" style={{ position: 'relative', display: 'flex' }}>
              <div style={{ flex: 1, display: 'flex' }}>
                <StatComponent 
                  transactions={transactions} 
                  advancedFilteredTransactions={advancedFilteredTransactions}
                  accounts={accounts} 
                  dateRange={dateRange} 
                  mini={true} 
                />
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  const newStats = [...stats];
                  newStats[idx] = null;
                  onUpdate({ ...widget, stats: newStats });
                }}
                style={{ 
                  position: 'absolute', 
                  top: '6px', 
                  right: '6px', 
                  background: 'rgba(255, 255, 255, 0.1)', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%'
                }}
                className="qs-remove-btn hover-bg"
                title="Remove Stat"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      
      {modalSlot !== null && (
        <AddStatModal 
          onClose={() => setModalSlot(null)}
          onAdd={handleSelectStat}
        />
      )}
    </div>
  );
}

function RecentTransactions({ transactions, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const recent = useMemo(() => {
    let flattened = [];
    transactions.forEach(tx => {
      if (tx.splits && tx.splits.length > 0 && tx.type !== 2) {
        tx.splits.forEach(s => {
          flattened.push({
            ...tx,
            id: `${tx.id}-${s.id}`,
            amount: s.amount,
            category: s.category || 'Unspecified',
            payee: s.payee || 'Unspecified',
            isSplitChild: true
          });
        });
      } else {
        flattened.push(tx);
      }
    });

    return flattened
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 4);
  }, [transactions]);

  if (recent.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>No transactions found.</div>;

  return (
    <div className="rt-list">
      {recent.map(tx => {
        const isIncome = tx.type === 1 || tx.type === 'income';
        return (
          <div key={tx.id} className="rt-item">
            <div className="rt-left">
              <span className="rt-payee">{tx.payee || tx.category || 'Unknown'}</span>
              <span className="rt-date">{format(parseISO(tx.date), 'MMM dd')} • {tx.category}</span>
            </div>
            <div className="rt-amount" style={{ color: isIncome ? '#10b981' : (tx.type === 2 ? '#fff' : '#ef4444') }}>
              {isIncome ? '+' : (tx.type !== 2 ? '-' : '')}{getCurrencySymbol(tx.currency || baseCurrency)}{formatCurrency(Math.abs(tx.amount), true)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniCashFlow({ transactions: rawTxs, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  const { income, expense } = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    let inc = 0, exp = 0;
    transactions.forEach(tx => {
      let txCurrency = tx.currency;
      if (!txCurrency) {
        const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
        txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
      }
      let amt = Math.abs(tx.amount);
      if (txCurrency !== baseCurrency && exchangeRates) {
        amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
      }
      
      if (tx.type === 1 || tx.type === 'income') inc += amt;
      else if (tx.type === 0 || tx.type === 'expense') exp += amt;
    });
    return { income: inc, expense: exp };
  }, [rawTxs, baseCurrency, exchangeRates, accounts]);

  const total = income + expense;
  const incomePercent = total > 0 ? (income / total) * 100 : 50;

  return (
    <div>
      <div className="cf-labels">
        <span className="cf-pill cf-pill-in">In: {getCurrencySymbol(baseCurrency)}{formatCurrency(income, true)}</span>
        <span className="cf-pill cf-pill-out">Out: {getCurrencySymbol(baseCurrency)}{formatCurrency(expense, true)}</span>
      </div>
      <div className="cf-bar-container">
        <div className="cf-bar-fill" style={{ width: `${incomePercent}%` }}></div>
      </div>
    </div>
  );
}

function TopCategories({ transactions: rawTxs, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const topCategories = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const sums = {};
    let totalExpense = 0;
    
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const cat = tx.category || 'Uncategorized';
        let txCurrency = tx.currency;
        if (!txCurrency) {
          const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
          txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
        }
        let amt = Math.abs(tx.amount);
        if (txCurrency !== baseCurrency && exchangeRates) {
          amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
        }
        sums[cat] = (sums[cat] || 0) + amt;
        totalExpense += amt;
      }
    });

    const maxAmount = Math.max(0, ...Object.values(sums));

    return Object.keys(sums)
      .map(cat => ({ name: cat, amount: sums[cat], percent: maxAmount > 0 ? (sums[cat] / maxAmount) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [rawTxs, baseCurrency, exchangeRates, accounts]);

  if (topCategories.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>No expenses found.</div>;

  return (
    <div className="tc-list">
      {topCategories.map(cat => (
        <div key={cat.name} className="tc-item">
          <span style={{ width: '80px', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
          <div className="tc-bar-bg">
            <div className="tc-bar-fill" style={{ width: `${cat.percent}%` }}></div>
          </div>
          <span style={{ width: '60px', textAlign: 'right', fontSize: '13px', fontWeight: 500 }}>
            {getCurrencySymbol(baseCurrency)}{formatCurrency(cat.amount, true)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TopPayees({ transactions: rawTxs, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const topPayees = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const sums = {};
    let totalExpense = 0;
    
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const payee = tx.payee ? tx.payee.trim() : 'Unknown';
        let txCurrency = tx.currency;
        if (!txCurrency) {
          const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
          txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
        }
        let amt = Math.abs(tx.amount);
        if (txCurrency !== baseCurrency && exchangeRates) {
          amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
        }
        sums[payee] = (sums[payee] || 0) + amt;
        totalExpense += amt;
      }
    });

    const maxAmount = Math.max(0, ...Object.values(sums));

    return Object.keys(sums)
      .map(payee => ({ name: payee, amount: sums[payee], percent: maxAmount > 0 ? (sums[payee] / maxAmount) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [rawTxs, baseCurrency, exchangeRates, accounts]);

  if (topPayees.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>No expenses found.</div>;

  return (
    <div className="tc-list">
      {topPayees.map(payee => (
        <div key={payee.name} className="tc-item">
          <span style={{ width: '80px', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payee.name}</span>
          <div className="tc-bar-bg">
            <div className="tc-bar-fill" style={{ width: `${payee.percent}%`, background: '#f43f5e' }}></div>
          </div>
          <span style={{ width: '60px', textAlign: 'right', fontSize: '13px', fontWeight: 500 }}>
            {getCurrencySymbol(baseCurrency)}{formatCurrency(payee.amount, true)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SevenDayExpenseChart({ transactions: rawTxs, accounts }) {
  const { baseCurrency } = useAppearanceSettings();
  const { exchangeRates } = useData();
  
  const chartData = useMemo(() => {
    const transactions = getEffectiveReportingItems(rawTxs);
    const data = [];
    const today = startOfDay(new Date());
    
    // Create an array of the last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i);
      data.push({
        dateObj: d,
        day: format(d, 'EEE'), // e.g., 'Mon'
        fullDate: format(d, 'MMM dd'), // e.g., 'Jul 15'
        expense: 0
      });
    }

    // Accumulate expenses
    transactions.forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const txDate = startOfDay(parseISO(tx.date));
        const dayMatch = data.find(d => d.dateObj.getTime() === txDate.getTime());
        if (dayMatch) {
          let txCurrency = tx.currency;
          if (!txCurrency) {
            const acc = accounts && accounts.find(a => a.id === tx.account || a.name === tx.account);
            txCurrency = acc ? (acc.currency || 'USD') : baseCurrency;
          }
          let amt = Math.abs(tx.amount);
          if (txCurrency !== baseCurrency && exchangeRates) {
            amt = convertAmount(amt, txCurrency, baseCurrency, exchangeRates);
          }
          dayMatch.expense += amt;
        }
      }
    });

    return data;
  }, [rawTxs, baseCurrency, exchangeRates, accounts]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: '#1e1e24', border: '1px solid rgba(255,255,255,0.1)', padding: '8px 12px', borderRadius: '8px', color: '#fff' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>{payload[0].payload.fullDate}</p>
          <p style={{ margin: 0, fontWeight: 600, color: '#ef4444' }}>
            {getCurrencySymbol(baseCurrency)}{formatCurrency(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: '100%', flex: 1, minHeight: '150px', marginTop: '16px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorExpenseBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={1}/>
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis 
            dataKey="day" 
            stroke="var(--text-secondary)" 
            fontSize={12} 
            tickLine={false} 
            axisLine={false} 
            dy={10}
          />
          <YAxis 
            stroke="var(--text-secondary)" 
            fontSize={12} 
            tickLine={false} 
            axisLine={false} 
            tickFormatter={(val) => formatCompactNumber(val)} 
            width={40} 
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar 
            dataKey="expense" 
            fill="url(#colorExpenseBar)" 
            fillOpacity={0.8} 
            activeBar={{ fillOpacity: 1 }} 
            barSize={24} 
            radius={[4, 4, 0, 0]} 
            style={{ transition: 'fill-opacity 0.3s ease' }} 
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
