import { useMemo, useState } from 'react';
import { useBaseMoney } from '../../hooks/useBaseMoney';
import { Trash2, Plus, X } from 'lucide-react';
import { parseISO, format, subDays, isAfter, startOfDay } from 'date-fns';
import { CurrencyBarChart } from '../Graphs/CurrencyChart';
import { addMoney, moneyEntries, formatOne } from '../../utils/money';
import * as Widgets from '../Stats/StatWidgets';
import AddStatModal from '../Stats/AddStatModal';
import { getEffectiveReportingItems } from '../../utils/txAdjustments';

import { WIDGET_TYPES } from './AddDashboardWidgetModal';

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
  const money = useBaseMoney();
  
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
              {/* The account's currency, not `tx.currency || base`: most records
                  carry no currency, so a dollar payment read as rupees. */}
              {isIncome ? '+' : (tx.type !== 2 ? '-' : '')}{money.show(tx.amount, money.currencyOf(tx), { noDecimals: true }).text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniCashFlow({ transactions: rawTxs }) {
  const money = useBaseMoney();
  const { income, expense } = useMemo(() => {
    const income = {};
    const expense = {};
    getEffectiveReportingItems(rawTxs).forEach(tx => {
      const cur = money.currencyOf(tx);
      const amt = Math.abs(Number(tx.amount) || 0);
      if (tx.type === 1 || tx.type === 'income') addMoney(income, cur, amt);
      else if (tx.type === 0 || tx.type === 'expense') addMoney(expense, cur, amt);
    });
    return { income, expense };
  }, [rawTxs, money]);

  // The bar compares in and out, so it is converted in both modes.
  const inBase = money.inBase(income);
  const total = inBase + money.inBase(expense);
  const incomePercent = total > 0 ? (inBase / total) * 100 : 50;

  return (
    <div>
      <div className="cf-labels">
        <span className="cf-pill cf-pill-in">In: {money.formatMap(income, { noDecimals: true })}</span>
        <span className="cf-pill cf-pill-out">Out: {money.formatMap(expense, { noDecimals: true })}</span>
      </div>
      <div className="cf-bar-container">
        <div className="cf-bar-fill" style={{ width: `${incomePercent}%` }}></div>
      </div>
    </div>
  );
}

// Top spending groups: ranked and barred by converted total (comparing needs
// one scale), labelled per currency in native mode.
function useTopSpend(rawTxs, keyOf) {
  const money = useBaseMoney();
  return useMemo(() => {
    const groups = {};
    getEffectiveReportingItems(rawTxs).forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const k = keyOf(tx);
        if (!groups[k]) groups[k] = {};
        addMoney(groups[k], money.currencyOf(tx), Math.abs(Number(tx.amount) || 0));
      }
    });
    const ranked = Object.entries(groups).map(([name, map]) => ({ name, map, amount: money.inBase(map) }));
    const maxAmount = Math.max(0, ...ranked.map(r => r.amount));
    return ranked
      .map(r => ({ ...r, percent: maxAmount > 0 ? (r.amount / maxAmount) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [rawTxs, keyOf, money]);
}

function TopSpendList({ items, barColour, empty }) {
  const money = useBaseMoney();
  if (items.length === 0) return <div style={{ color: 'var(--text-secondary)' }}>{empty}</div>;
  return (
    <div className="tc-list">
      {items.map(item => {
        const lines = money.native
          ? moneyEntries(item.map, money.baseCurrency).map(([c, a]) => formatOne(a, c, { noDecimals: true }))
          : [formatOne(item.amount, money.baseCurrency, { noDecimals: true })];
        return (
          <div key={item.name} className="tc-item">
            <span style={{ width: '80px', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
            <div className="tc-bar-bg">
              <div className="tc-bar-fill" style={{ width: `${item.percent}%`, ...(barColour ? { background: barColour } : {}) }}></div>
            </div>
            <span className="money-lines" style={{ minWidth: '60px', textAlign: 'right', alignItems: 'flex-end', fontSize: '13px', fontWeight: 500 }}>
              {lines.map((l, i) => <span key={i} className={i ? 'money-line-minor' : undefined}>{l}</span>)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const categoryOf = tx => tx.category || 'Uncategorized';
const payeeOf = tx => (tx.payee ? tx.payee.trim() : 'Unknown');

function TopCategories({ transactions: rawTxs }) {
  const items = useTopSpend(rawTxs, categoryOf);
  return <TopSpendList items={items} empty="No expenses found." />;
}

function TopPayees({ transactions: rawTxs }) {
  const items = useTopSpend(rawTxs, payeeOf);
  return <TopSpendList items={items} barColour="#f43f5e" empty="No expenses found." />;
}

export function SevenDayExpenseChart({ transactions: rawTxs }) {
  const money = useBaseMoney();

  const rows = useMemo(() => {
    const today = startOfDay(new Date());
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i);
      days.push({ dateObj: d, day: format(d, 'EEE'), fullDate: format(d, 'MMM dd'), money: {} });
    }
    getEffectiveReportingItems(rawTxs).forEach(tx => {
      if (tx.type === 0 || tx.type === 'expense') {
        const txDate = startOfDay(parseISO(tx.date));
        const dayMatch = days.find(d => d.dateObj.getTime() === txDate.getTime());
        if (dayMatch) addMoney(dayMatch.money, money.currencyOf(tx), Math.abs(Number(tx.amount) || 0));
      }
    });
    return days;
  }, [rawTxs, money]);

  return (
    <div style={{ width: '100%', flex: 1, minHeight: '150px', marginTop: '16px' }}>
      <CurrencyBarChart
        rows={rows}
        xKey="day"
        colour="#ef4444"
        idPrefix="colorExpenseBar"
        fillOpacity={0.8}
        barSize={24}
        labelOf={(row) => row.fullDate}
        xAxisProps={{ dy: 10 }}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
      />
    </div>
  );
}
