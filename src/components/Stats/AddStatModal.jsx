import { X, DollarSign, ArrowDownRight, ArrowUpRight, Target, Activity, Flame, PieChart } from 'lucide-react';
import ModalWrapper from '../ModalWrapper';

export const STAT_TYPES = [
  {
    id: 'total_income',
    title: 'Total Income',
    desc: 'Your total incoming cash flow for the selected period.',
    icon: ArrowDownRight
  },
  {
    id: 'total_expense',
    title: 'Total Expense',
    desc: 'Your total outgoing cash flow for the selected period.',
    icon: ArrowUpRight
  },
  {
    id: 'net_savings',
    title: 'Net Savings',
    desc: 'Income minus expenses. What you have left over.',
    icon: DollarSign
  },
  {
    id: 'savings_rate',
    title: 'Savings Rate',
    desc: 'The percentage of your income that you save.',
    icon: Target
  },
  {
    id: 'burn_rate',
    title: 'Burn Rate',
    desc: 'Your average daily expense over the selected period.',
    icon: Flame
  },
  {
    id: 'total_investment',
    title: 'Total Investment',
    desc: 'Money allocated to investments in the selected period.',
    icon: Activity
  },
  {
    id: 'investment_rate',
    title: 'Investment Rate',
    desc: 'The percentage of your income that you invest.',
    icon: PieChart
  },
  {
    id: 'largest_expense',
    title: 'Largest Expense',
    desc: 'The single largest expense in the selected period.',
    icon: ArrowUpRight
  },
  {
    id: 'largest_income',
    title: 'Largest Income',
    desc: 'The single largest income in the selected period.',
    icon: ArrowDownRight
  },
  {
    id: 'most_active_category',
    title: 'Most Active Category',
    desc: 'The category with the most transactions.',
    icon: Activity
  },
  {
    id: 'most_active_payee',
    title: 'Most Active Payee',
    desc: 'The payee you transacted with most frequently.',
    icon: Target
  },
  {
    id: 'highest_spend_category',
    title: 'Highest Spend Category',
    desc: 'The category where you spent the most money.',
    icon: Activity
  },
  {
    id: 'highest_spend_payee',
    title: 'Highest Spend Payee',
    desc: 'The payee you spent the most money on.',
    icon: Target
  },
  {
    id: 'average_expense_size',
    title: 'Average Expense',
    desc: 'The average amount of each expense transaction.',
    icon: Flame
  },
  {
    id: 'retained_savings',
    title: 'Ending Balance',
    desc: 'Starting balance + income - expenses. Shows your total balance at the end of the period.',
    icon: DollarSign
  },
  {
    id: 'retained_savings_rate',
    title: 'Ending Balance Rate',
    desc: 'The percentage of your starting balance that you ended up with.',
    icon: Target
  }
];

// `usedTypes` are the stats already on the board. They are dropped from the
// list rather than shown disabled: a stat is a single tile with no per-instance
// settings, so a second copy would be an identical duplicate. The Dashboard's
// quick-stat slots pass nothing and keep the full list.
export default function AddStatModal({ onClose, onAdd, usedTypes = [] }) {
  const available = STAT_TYPES.filter(type => !usedTypes.includes(type.id));

  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2>Select Stat Type</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={20} /></button>
        </div>

        <div className="modal-body">
          {available.length === 0 ? (
            <div className="empty-state">Every stat has already been added.</div>
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
