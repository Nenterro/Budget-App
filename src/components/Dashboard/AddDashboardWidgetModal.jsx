import { X, User, BarChart2 } from 'lucide-react';
import { Activity, Clock, PieChart, LayoutGrid } from 'lucide-react';
import ModalWrapper from '../ModalWrapper';
import '../../pages/Stats.css';

export const WIDGET_TYPES = [
  {
    id: 'quick_stats',
    title: 'Quick Stats',
    desc: 'A compact 2x2 grid of your Income, Expense, Savings, and Savings Rate.',
    icon: LayoutGrid
  },
  {
    id: 'seven_day_trend',
    title: '7-Day Expense Trend',
    desc: 'A bar chart showing your expenses over the last 7 days.',
    icon: BarChart2
  },
  {
    id: 'recent_transactions',
    title: 'Recent Transactions',
    desc: 'A quick list of your latest transactions.',
    icon: Clock
  },
  {
    id: 'mini_cash_flow',
    title: 'Cash Flow Overview',
    desc: 'A simple visual bar comparing your income against your expenses.',
    icon: Activity
  },
  {
    id: 'top_categories',
    title: 'Top Categories',
    desc: 'A list of your highest spending categories with progress bars.',
    icon: PieChart
  },
  {
    id: 'top_payees',
    title: 'Top Payees',
    desc: 'A list of the payees you spend the most money on.',
    icon: User
  }
];

export default function AddDashboardWidgetModal({ onClose, onAdd, activeWidgets }) {
  const availableWidgets = WIDGET_TYPES.filter(type => !activeWidgets.find(w => w.type === type.id));

  return (
    <ModalWrapper onClose={onClose}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '560px' }}
      >
        <div className="modal-header">
          <h2>Add Dashboard Widget</h2>
          <button className="close-btn" onClick={onClose} type="button"><X size={20} /></button>
        </div>

        <div className="modal-body">
          {availableWidgets.length === 0 ? (
            <div className="empty-state">All available widgets are already on your dashboard.</div>
          ) : (
            <div className="picker-list">
              {availableWidgets.map(widget => {
                const Icon = widget.icon;
                return (
                  <button
                    key={widget.id}
                    type="button"
                    className="picker-item"
                    onClick={() => onAdd(widget.id)}
                  >
                    <div className="picker-icon"><Icon size={22} /></div>
                    <div className="picker-details">
                      <h4>{widget.title}</h4>
                      <p>{widget.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}
