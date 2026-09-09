import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutDashboard, LineChart, PieChart, Calculator, List, Settings, Pin, PinOff, Plus, Home, MoreHorizontal, Wallet, Inbox } from 'lucide-react';
// Rendered only once the user taps Add, so it does not belong in the chunk
// that paints the shell.
const AddTransactionModal = lazy(() => import('./AddTransactionModal'));
// Same reasoning: most sessions never open the review queue.
const InboxReviewModal = lazy(() => import('./InboxReviewModal'));
import { useInboxDrafts } from '../hooks/useInboxDrafts';
import MoreMenuModal from './MoreMenuModal';
import SessionAlert from './SessionAlert';
import PwaInstallBanner from './PwaInstallPrompt';
import PullToRefresh from './PullToRefresh';
import './Layout.css';

const NAV_ITEMS = [
  { path: '/', label: 'Home Page', icon: Home },
  { path: '/budgets', label: 'Budgets', icon: Wallet },
  { path: '/graphs', label: 'Graphs', icon: LineChart },
  { path: '/stats', label: 'Stats', icon: Calculator },
  { path: '/transactions', label: 'Transactions', icon: List },
];

function GradientDef() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="icon-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent-color)" offset="0%" />
          <stop stopColor="var(--accent-color)" offset="100%" stopOpacity={0.6} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Phone only. The sidebar carries its own badged entry, so on desktop this
// banner was just repeating it above every page. On a phone there is no
// sidebar, and buried behind the More menu it would have gone unseen — on the
// device the messages actually arrive on.
function InboxBanner({ count, onOpen }) {
  if (count === 0) return null;
  return (
    <button className="inbox-banner mobile-only" onClick={onOpen}>
      <Inbox size={18} />
      <span>
        {count} transaction{count === 1 ? '' : 's'} detected
      </span>
      <span className="inbox-banner-cta">Review</span>
    </button>
  );
}

function Sidebar({ isPinned, togglePin, onOpenAdd, inboxCount, onOpenInbox }) {
  return (
    <div className={`sidebar-wrapper desktop-only ${isPinned ? 'pinned' : 'unpinned'}`}>
      <aside className={`sidebar glass-panel ${isPinned ? 'pinned' : 'unpinned'}`}>
        <div className="sidebar-header">
          <h1 className="gradient-text title">My Budget</h1>
          <button className="pin-btn" onClick={togglePin} title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}>
            {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
        </div>
        <nav className="sidebar-nav">
          <button className="nav-item add-tx-btn" onClick={onOpenAdd} style={{ width: '100%', background: 'var(--accent-gradient)', color: '#fff', border: 'none', cursor: 'pointer', marginBottom: '16px' }}>
            <Plus size={20} className="nav-icon" />
            <span className="nav-label">Add Transaction</span>
          </button>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={item.label}>
              <item.icon size={20} className="nav-icon" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
          {inboxCount > 0 && (
            <button className="nav-item nav-inbox-btn" onClick={onOpenInbox} title="Detected Transactions">
              <Inbox size={20} className="nav-icon" />
              <span className="nav-label">Detected</span>
              <span className="nav-badge">{inboxCount}</span>
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Settings">
            <Settings size={20} className="nav-icon" />
            <span className="nav-label">Settings</span>
          </NavLink>
        </div>
      </aside>
    </div>
  );
}

function BottomNav({ onOpenAdd, onOpenMore }) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const timeoutRef = useRef(null);

  const handleNavClick = (label) => {
    setActiveTooltip(label);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActiveTooltip(null);
    }, 1500);
  };

  return (
    <nav className="bottom-nav mobile-only">
      <NavLink to="/graphs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Graphs" onClick={() => handleNavClick('Graphs')}>
        <LineChart size={24} />
        <AnimatePresence>
          {activeTooltip === 'Graphs' && (
            <motion.div initial={{ opacity: 0, y: 10, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} className="nav-tooltip">Graphs</motion.div>
          )}
        </AnimatePresence>
      </NavLink>
      <NavLink to="/budgets" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Budgets" onClick={() => handleNavClick('Budgets')}>
        <Wallet size={24} />
        <AnimatePresence>
          {activeTooltip === 'Budgets' && (
            <motion.div initial={{ opacity: 0, y: 10, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} className="nav-tooltip">Budgets</motion.div>
          )}
        </AnimatePresence>
      </NavLink>
      
      <div className="fab-container">
        <button className="fab-btn" title="Add Transaction" onClick={() => { onOpenAdd(); handleNavClick('Add'); }}>
          <Plus size={28} color="#fff" />
        </button>
        <AnimatePresence>
          {activeTooltip === 'Add' && (
            <motion.div initial={{ opacity: 0, y: 10, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} className="nav-tooltip">Add</motion.div>
          )}
        </AnimatePresence>
      </div>

      <NavLink to="/transactions" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Transactions" onClick={() => handleNavClick('Transactions')}>
        <List size={24} />
        <AnimatePresence>
          {activeTooltip === 'Transactions' && (
            <motion.div initial={{ opacity: 0, y: 10, x: "-50%" }} animate={{ opacity: 1, y: 0, x: "-50%" }} exit={{ opacity: 0, y: 10, x: "-50%" }} className="nav-tooltip">Transactions</motion.div>
          )}
        </AnimatePresence>
      </NavLink>
      
      <button className="nav-item" onClick={onOpenMore} title="More">
        <MoreHorizontal size={24} />
      </button>
    </nav>
  );
}

const SIDEBAR_PIN_KEY = 'SIDEBAR_PINNED';

export default function Layout() {
  // Persisted, so unpinning the sidebar is a preference rather than something
  // that has to be redone on every visit.
  const [isSidebarPinned, setIsSidebarPinned] = useState(
    () => localStorage.getItem(SIDEBAR_PIN_KEY) !== '0'
  );

  const toggleSidebarPin = () => {
    setIsSidebarPinned(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_PIN_KEY, next ? '1' : '0');
      return next;
    });
  };
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);

  const { drafts, refresh: refreshInbox, count: inboxCount } = useInboxDrafts();

  const location = useLocation();

  useEffect(() => {
    if (!location.pathname.startsWith('/settings')) {
      sessionStorage.setItem('lastNonSettingsPath', location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="app-container">
      <PullToRefresh />
      <GradientDef />
      <Sidebar
        isPinned={isSidebarPinned}
        togglePin={toggleSidebarPin}
        onOpenAdd={() => setIsAddOpen(true)}
        inboxCount={inboxCount}
        onOpenInbox={() => setIsInboxOpen(true)}
      />
      <div className="main-wrapper">
        <main className="main-content">
          {/* Unlike the inbox banner this shows on the settings screens too:
              losing data is not something to hide behind a route check. */}
          <SessionAlert />
          {!location.pathname.startsWith('/settings') && (
            <InboxBanner count={inboxCount} onOpen={() => setIsInboxOpen(true)} />
          )}
          <div key={location.pathname} className="page-transition-wrapper">
            <Outlet />
          </div>
        </main>
        {!location.pathname.startsWith('/settings') && (
          <BottomNav onOpenAdd={() => setIsAddOpen(true)} onOpenMore={() => setIsMoreOpen(true)} />
        )}
      </div>
      
      <AnimatePresence>
        {isAddOpen && (
          <Suspense fallback={null}>
            <AddTransactionModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
          </Suspense>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isInboxOpen && (
          <Suspense fallback={null}>
            <InboxReviewModal
              isOpen={isInboxOpen}
              onClose={() => setIsInboxOpen(false)}
              drafts={drafts}
              onRefresh={refreshInbox}
            />
          </Suspense>
        )}
      </AnimatePresence>
      <MoreMenuModal isOpen={isMoreOpen} onClose={() => setIsMoreOpen(false)} />
    </div>
  );
}
