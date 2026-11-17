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

// Before the first paint, so the saved accent colour is in place rather than
// flashing the default while settings load out of IndexedDB.
restoreTheme()

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
      return (
        <div style={{ padding: 20, color: 'red', background: '#fff' }}>
          <h1>App Crashed!</h1>
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
