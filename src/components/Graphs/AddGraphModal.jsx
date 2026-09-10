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
    id: 'income_by_category',
    title: 'Income by Category',
    desc: 'A pie chart breaking down your income by category.',
    icon: PieChart
  },
  {
    id: 'income_by_payee',
    title: 'Income by Payee',
    desc: 'A pie chart showing your income sources.',
    icon: PieChart
  }
];

// `usedTypes` are the graphs already on the board. A graph carries no
// per-instance configuration, so a second copy of one would render exactly the
// same chart — they are dropped from the list rather than offered again.
export default function AddGraphModal({ onClose, onAdd, usedTypes = [] }) {
  const available = GRAPH_TYPES.filter(type => !usedTypes.includes(type.id));

  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2>Select Graph Type</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={20} /></button>
        </div>

        <div className="modal-body">
          {available.length === 0 ? (
            <div className="empty-state">Every graph has already been added.</div>
          ) : (
            <div className="picker-list">
              {available.map(type => (
                <button key={type.id} type="button" className="picker-item" onClick={() => onAdd(type.id)}>
                  <div className="picker-icon">
                    <type.icon size={22} />
                  </div>
                  <div className="picker-details">
                    <h4>{type.title}</h4>
                    <p>{type.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}
