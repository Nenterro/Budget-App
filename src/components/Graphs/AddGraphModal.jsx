import { X, TrendingUp, BarChart2, PieChart, Activity } from 'lucide-react';
import ModalWrapper from '../ModalWrapper';

export const GRAPH_TYPES = [
  {
    id: 'balance_over_time',
    title: 'Balance Over Time',
    desc: 'A line chart tracking your net worth or total balance across time.',
    icon: Activity
  },
  {
    id: 'spending_per_month',
    title: 'Spending per Month',
    desc: 'A bar chart showing your expenses over the last 12 months.',
    icon: BarChart2
  },
  {
    id: 'income_per_month',
    title: 'Income per Month',
    desc: 'A bar chart showing your income over the last 12 months.',
    icon: BarChart2
  },
  {
    id: 'investment_per_month',
    title: 'Investment per Month',
    desc: 'A bar chart showing your investments over the last 12 months.',
    icon: BarChart2
  },
  {
    id: 'spending_by_category',
    title: 'Spending by Category',
    desc: 'A pie chart breaking down your expenses by category.',
    icon: PieChart
  },
  {
    id: 'spending_by_payee',
    title: 'Spending by Payee',
    desc: 'A pie chart showing where your money is going.',
    icon: PieChart
  },
  {
    id: 'income_by_payee',
    title: 'Income by Payee',
    desc: 'A pie chart showing your income sources.',
    icon: PieChart
  }
];

export default function AddGraphModal({ onClose, onAdd }) {
  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', padding: '24px' }}>
        <div className="modal-header">
          <h2>Select Graph Type</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={24} /></button>
        </div>
        
        <div className="graph-type-list">
          {GRAPH_TYPES.map(type => (
            <div key={type.id} className="graph-type-item" onClick={() => onAdd(type.id)}>
              <div className="graph-type-icon">
                <type.icon size={24} />
              </div>
              <div className="graph-type-details">
                <h4>{type.title}</h4>
                <p>{type.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModalWrapper>
  );
}
