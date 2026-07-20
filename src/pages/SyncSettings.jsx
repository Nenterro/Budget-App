import { useState, useEffect } from 'react';
import { ArrowLeft, Cloud, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { pb, syncAll, connectPocketBase } from '../store/sync';
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

  const handleSave = (e) => {
    e.preventDefault();
    const formattedUrl = url.trim().replace(/\/$/, '');
    localStorage.setItem('PB_URL', formattedUrl);
    pb.baseUrl = formattedUrl;
    checkConnection(formattedUrl);
  };

  const handleManualSync = async () => {
    if (status !== 'Connected') return;
    setIsSyncing(true);
    try {
      await syncAll();
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
            <small style={{ color: 'var(--text-muted)', marginTop: '8px', display: 'block', lineHeight: '1.5' }}>
              Options:<br/>
              • <b>Internet:</b> https://huz-budget.duckdns.org:8888<br/>
              • <b>Tailscale:</b> http://100.97.146.42:8090<br/>
              • <b>LAN:</b> http://192.168.18.40:8090
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
