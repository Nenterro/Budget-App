import { useState, useEffect } from 'react';
import { ArrowLeft, Cloud, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { pb, syncAll, connectPocketBase, checkUrl, PB_URLS } from '../store/sync';
import { useData } from '../context/DataContext';
import './ManageData.css';

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

  const { loadData } = useData();

  const handleManualSync = async () => {
    if (status !== 'Connected') return;
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
              Status: {status}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
            Connect your app to a self-hosted PocketBase server for real-time synchronization across devices. 
            Data is stored locally first and pushes automatically when online.
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
          disabled={status !== 'Connected' || isSyncing}
          style={{ justifyContent: 'center', opacity: status !== 'Connected' ? 0.5 : 1 }}
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
