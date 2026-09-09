import { useState, useEffect } from 'react';
import { ArrowLeft, Cloud, CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { pb, syncAll, connectPocketBase, checkUrl, PB_URLS } from '../store/sync';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import './ManageData.css';

const SYNC_LABELS = {
  pending: 'Starting up',
  syncing: 'Syncing now',
  synced: 'Up to date',
  offline: 'No server reachable',
  expired: 'Session expired — not syncing',
  'signed-out': 'Signed out on this device',
  guest: 'Local only (guest)',
  error: 'Last sync had errors'
};

const SYNC_TONES = {
  synced: 'good',
  syncing: 'busy',
  offline: 'bad',
  error: 'bad',
  expired: 'bad',
  'signed-out': 'bad',
  guest: 'warn',
  pending: 'muted'
};

const REALTIME_LABELS = {
  live: 'Connected',
  connecting: 'Connecting',
  failed: 'Failed to connect',
  off: 'Not connected'
};

const REALTIME_TONES = { live: 'good', connecting: 'busy', failed: 'bad', off: 'warn' };

const TONE_COLORS = {
  good: '#10b981',
  bad: '#ef4444',
  warn: '#f59e0b',
  busy: 'var(--accent-color)',
  muted: 'var(--text-secondary)'
};

function StatusRow({ label, value, tone = 'muted' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: TONE_COLORS[tone] || TONE_COLORS.muted, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

function formatAgo(timestamp, now) {
  if (!timestamp) return 'Never';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SyncSettings() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(localStorage.getItem('PB_URL') || 'https://huz-budget.duckdns.org:8888');
  const [status, setStatus] = useState('Detecting...');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    handleAutoDetect();
  }, []);

  const handleAutoDetect = async () => {
    setStatus('Detecting...');
    const connectedUrl = await connectPocketBase();
    if (connectedUrl) {
      setUrl(connectedUrl);
      setStatus('Connected');
    } else {
      setStatus('Offline');
    }
  };

  const [saveError, setSaveError] = useState('');

  // The URL used to be written to localStorage and pb.baseUrl before it was
  // checked, so a typo left the whole app pointed at a host that answers
  // nothing — with no obvious way back. Verify first, commit only on success.
  const handleSave = async (e) => {
    e.preventDefault();
    const formattedUrl = url.trim().replace(/\/$/, '');
    setSaveError('');
    setStatus('Detecting...');

    const reachable = await checkUrl(formattedUrl);
    if (!reachable) {
      setStatus('Offline');
      setSaveError('That server did not respond, so it was not saved. Check the address and try again.');
      return;
    }

    localStorage.setItem('PB_URL', formattedUrl);
    pb.baseUrl = formattedUrl;
    setStatus('Connected');
  };

  const { loadData, syncStatus } = useData();
  const { sessionExpired, countPendingChanges, logout } = useAuth();

  // "Signed out" only reads as urgent once it says what is stranded here.
  const notSyncing = sessionExpired || syncStatus.mode === 'expired' || syncStatus.mode === 'signed-out';
  const [pendingCount, setPendingCount] = useState(null);
  useEffect(() => {
    if (!notSyncing) return;
    let alive = true;
    countPendingChanges()
      .then(count => { if (alive) setPendingCount(count); })
      .catch(() => {});
    return () => { alive = false; };
  }, [notSyncing, countPendingChanges]);

  const handleSignOutForGood = async () => {
    const warning = pendingCount > 0
      ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} on this device ${pendingCount === 1 ? 'has' : 'have'} never reached the server. Signing out erases the local copy, so ${pendingCount === 1 ? 'it' : 'they'} will be lost. Continue?`
      : 'This clears the local copy of your data on this device. Continue?';
    if (!window.confirm(warning)) return;
    await logout();
  };

  // Only so "Last synced" counts up on its own while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await syncAll();
      if (loadData) await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="page-container manage-data-page">
      <div className="manage-header">
        <button className="back-btn" onClick={() => navigate('/settings')}><ArrowLeft size={24} /></button>
        <h1>Data & Sync</h1>
      </div>

      <div className="manage-content" style={{ gap: '24px' }}>
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {status === 'Connected' ? <CheckCircle color="#10b981" /> : <XCircle color="#ef4444" />}
            <span style={{ fontSize: '18px', fontWeight: '600' }}>
              Server: {status}
            </span>
          </div>

          {/* What the sync engine is actually doing. Without this, a dead
              realtime stream or a rejected push looked exactly like nothing
              having changed. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <StatusRow label="Sync" value={SYNC_LABELS[syncStatus.mode] || syncStatus.mode} tone={SYNC_TONES[syncStatus.mode]} />
            <StatusRow
              label="Live updates"
              value={REALTIME_LABELS[syncStatus.realtime] || syncStatus.realtime}
              tone={REALTIME_TONES[syncStatus.realtime]}
            />
            <StatusRow label="Last synced" value={formatAgo(syncStatus.lastSyncAt, now)} tone="muted" />
          </div>

          {/* The state this page used to report in passing, as one grey row
              among others: the saved session is gone, so nothing here is being
              backed up, and it says so with the action that fixes it. */}
          {notSyncing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '1px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700 }}>This device is signed out</span>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    The saved session expired or was rejected by the server, so
                    nothing has been uploaded since. The app keeps working from
                    the copy stored here.
                    {pendingCount > 0 && ` ${pendingCount} change${pendingCount === 1 ? '' : 's'} ${pendingCount === 1 ? 'is' : 'are'} waiting to be uploaded.`}
                  </span>
                </div>
              </div>
              <button
                className="submit-btn bg-primary"
                onClick={() => navigate('/login', { state: { reason: 'session-expired' } })}
                style={{ margin: 0 }}
              >
                Sign in again
              </button>
              {/* Signing back in first is always the safe order, so the
                  destructive option is the quiet one. */}
              <button
                onClick={handleSignOutForGood}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-secondary)', fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Sign out and clear this device instead
              </button>
            </div>
          )}

          {syncStatus.realtime !== 'live' && syncStatus.mode === 'synced' && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              Live updates are not connected, so changes from other devices arrive
              when you return to the app, regain focus or network, or on the
              periodic check — not the instant they happen.
            </p>
          )}

          {syncStatus.lastError && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px' }}>
              <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '1px' }} />
              <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.45', wordBreak: 'break-word' }}>
                {syncStatus.lastError}
              </span>
            </div>
          )}

          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
            Data is stored on this device first and pushed to your PocketBase
            server whenever it is reachable.
          </p>
        </div>

        <form onSubmit={handleSave} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label>Server URL</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://huz-budget.duckdns.org:8888"
              required
            />
            {saveError && (
              <small style={{ color: '#ef4444', marginTop: '8px', display: 'block', lineHeight: '1.5' }}>
                {saveError}
              </small>
            )}
            {/* Listed straight from the auto-detect list so the hints cannot
                drift out of step with the addresses the app actually tries. */}
            <small style={{ color: 'var(--text-muted)', marginTop: '8px', display: 'block', lineHeight: '1.5' }}>
              Auto-detected in this order:<br/>
              {PB_URLS.map(option => (
                <span key={option} style={{ display: 'block' }}>
                  •{' '}
                  <button
                    type="button"
                    onClick={() => setUrl(option)}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-color)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
                  >
                    {option}
                  </button>
                </span>
              ))}
            </small>
          </div>
          <button type="submit" className="submit-btn bg-primary" style={{ marginTop: '8px' }}>
            Save & Reconnect
          </button>
        </form>

        <button
          className="add-item-btn"
          onClick={handleManualSync}
          disabled={isSyncing}
          style={{ justifyContent: 'center', opacity: isSyncing ? 0.5 : 1 }}
        >
          <RefreshCw size={20} className={isSyncing ? 'spinning' : ''} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
          {isSyncing ? 'Syncing...' : 'Force Sync Now'}
        </button>
      </div>

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
