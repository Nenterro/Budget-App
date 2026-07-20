import { Trash2 } from 'lucide-react';
import { GRAPH_TYPES } from './AddGraphModal';
import {
  BalanceOverTime,
  SpendingPerMonth,
  IncomePerMonth,
  InvestmentPerMonth,
  SpendingByCategory,
  SpendingByPayee,
  IncomeByPayee
} from './ChartWidgets';

export default function ChartCard({ graph, onRemove, transactions, advancedFilteredTransactions, accounts, dateRange }) {
  const typeDef = GRAPH_TYPES.find(t => t.id === graph.type) || { title: 'Unknown Graph' };

  const renderChart = () => {
    switch (graph.type) {
      case 'balance_over_time':
        return <BalanceOverTime transactions={advancedFilteredTransactions} accounts={accounts} dateRange={dateRange} />;
      case 'spending_per_month':
        return <SpendingPerMonth transactions={advancedFilteredTransactions} accounts={accounts} />;
      case 'income_per_month':
        return <IncomePerMonth transactions={advancedFilteredTransactions} accounts={accounts} />;
      case 'investment_per_month':
        return <InvestmentPerMonth transactions={advancedFilteredTransactions} accounts={accounts} />;
      case 'spending_by_category':
        return <SpendingByCategory transactions={transactions} accounts={accounts} />;
      case 'spending_by_payee':
        return <SpendingByPayee transactions={transactions} accounts={accounts} />;
      case 'income_by_payee':
        return <IncomeByPayee transactions={transactions} accounts={accounts} />;
      default:
        return <div style={{ color: 'var(--text-secondary)' }}>Chart not implemented</div>;
    }
  };

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3 className="chart-card-title">{typeDef.title}</h3>
        <button className="chart-card-remove" onClick={onRemove} title="Remove Graph">
          <Trash2 size={18} />
        </button>
      </div>
      <div className="chart-container">
        {renderChart()}
      </div>
    </div>
  );
}
