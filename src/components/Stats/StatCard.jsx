import { Trash2 } from 'lucide-react';
import { STAT_TYPES } from './AddStatModal';
import {
  TotalIncome, TotalExpense, NetSavings, SavingsRate, BurnRate, TotalInvestment, InvestmentRate,
  LargestExpense, LargestIncome, MostActiveCategory, MostActivePayee, AverageExpenseSize, RetainedSavings, RetainedSavingsRate,
  HighestSpendCategory, HighestSpendPayee
} from './StatWidgets';

export default function StatCard({ stat, onRemove, transactions, advancedFilteredTransactions, accounts, dateRange }) {
  const typeDef = STAT_TYPES.find(t => t.id === stat.type) || { title: 'Unknown Stat' };

  const renderStat = () => {
    switch (stat.type) {
      case 'total_income': return <TotalIncome transactions={transactions} accounts={accounts} />;
      case 'total_expense': return <TotalExpense transactions={transactions} accounts={accounts} />;
      case 'net_savings': return <NetSavings transactions={transactions} accounts={accounts} />;
      case 'savings_rate': return <SavingsRate transactions={transactions} accounts={accounts} />;
      case 'burn_rate': return <BurnRate transactions={transactions} accounts={accounts} dateRange={dateRange} />;
      case 'total_investment': return <TotalInvestment transactions={transactions} accounts={accounts} />;
      case 'investment_rate': return <InvestmentRate transactions={transactions} accounts={accounts} />;
      case 'largest_expense': return <LargestExpense transactions={transactions} accounts={accounts} />;
      case 'largest_income': return <LargestIncome transactions={transactions} accounts={accounts} />;
      case 'most_active_category': return <MostActiveCategory transactions={transactions} />;
      case 'most_active_payee': return <MostActivePayee transactions={transactions} />;
      case 'highest_spend_category': return <HighestSpendCategory transactions={transactions} accounts={accounts} />;
      case 'highest_spend_payee': return <HighestSpendPayee transactions={transactions} accounts={accounts} />;
      case 'average_expense_size': return <AverageExpenseSize transactions={transactions} accounts={accounts} />;
      case 'retained_savings': return <RetainedSavings advancedFilteredTransactions={advancedFilteredTransactions} dateRange={dateRange} accounts={accounts} />;
      case 'retained_savings_rate': return <RetainedSavingsRate advancedFilteredTransactions={advancedFilteredTransactions} dateRange={dateRange} accounts={accounts} />;
      default: return <div style={{ color: 'var(--text-secondary)' }}>Stat not implemented</div>;
    }
  };

  return (
    <div className="stat-card glass-panel">
      <div className="stat-card-header">
        <h3 className="stat-card-title">{typeDef.title}</h3>
        <button className="stat-card-remove" onClick={onRemove} title="Remove Stat">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="stat-container">
        {renderStat()}
      </div>
    </div>
  );
}
