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

export default function AddStatModal({ onClose, onAdd }) {
  return (
    <ModalWrapper onClose={onClose}>
      <div className="modal-content glass-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', padding: '24px' }}>
        <div className="modal-header">
          <h2>Select Stat Type</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={24} /></button>
        </div>
        
        <div className="stat-type-list">
          {STAT_TYPES.map(type => (
            <div key={type.id} className="stat-type-item" onClick={() => onAdd(type.id)}>
              <div className="stat-type-icon">
                <type.icon size={24} />
              </div>
              <div className="stat-type-details">
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
