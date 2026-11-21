import { StrictMode } from 'react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DataProvider } from './context/DataContext'
import { SettingsProvider } from './context/SettingsContext'
import { AuthProvider } from './context/AuthContext'
import { restoreTheme } from './utils/theme'
import { isChunkLoadError, reloadForNewVersion } from './utils/staleChunk'
import { startAppUpdates } from './utils/appUpdate'
import { clearBadgeWhenOpen } from './utils/push'

// Before the first paint, so the saved accent colour is in place rather than
// flashing the default while settings load out of IndexedDB.
restoreTheme()

startAppUpdates()

clearBadgeWhenOpen()

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error(error);
    // A chunk from a build that has since been replaced. Lazy imports reload
    // for this themselves; this catches anything that slips past them.
    if (isChunkLoadError(error) && reloadForNewVersion()) this.setState({ reloading: true });
  }
  render() {
    if (this.state.reloading) return null;
    if (this.state.hasError) {
      // A way out that does not involve force-quitting the app. Reloading is
      // what cures a stale-build failure, and it is harmless for anything else.
      return (
        <div style={{ padding: 20, color: 'red', background: '#fff' }}>
          <h1>App Crashed!</h1>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ margin: '4px 0 16px', padding: '10px 18px', fontSize: 16, fontWeight: 600, borderRadius: 10, border: 'none', background: '#8b5cf6', color: '#fff' }}
          >
            Reload app
          </button>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.info?.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <SettingsProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </SettingsProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
