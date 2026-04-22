import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { DashboardProvider } from './context/DashboardContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import AppShell from './components/layout/AppShell.jsx';
import DashboardView from './components/views/DashboardView.jsx';
import CameraView from './components/views/CameraView.jsx';
import InstrumentationView from './components/views/InstrumentationView.jsx';
import BeamlineView from './components/views/BeamlineView.jsx';
import BeamlineLayoutView from './components/views/BeamlineLayout.jsx';
import SettingsView from './components/views/SettingsView.jsx';
import TicketsView from './components/views/TicketsView.jsx';
import K8sView from './components/views/K8sView.jsx';
import ChannelBrowserView from './components/views/ChannelBrowserView.jsx';
import SoftIOCView from './components/views/SoftIOCView.jsx';
import OpsFilesView from './components/views/OpsFilesView.jsx';
import { SoftIOCProvider } from './context/SoftIOCContext.jsx';

/** Top-level error boundary: catches crashes and shows a readable message. */
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#f87171', background: '#0f1117', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: '1rem' }}>Application Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            style={{ marginTop: '1rem', padding: '8px 16px', cursor: 'pointer' }}
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRoutes() {
  const { loading, error, config, resetGitConfig, gitConfig } = useApp();
  const { theme, toggleTheme } = useTheme();

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading configuration…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <h2>Configuration Error</h2>
        <p>{error}</p>
        <p>
          Make sure <code>values.yaml</code> is available in the public folder
          or specify <code>?values=/path/to/values.yaml</code>.
        </p>
        {gitConfig?.giturl && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              style={{ padding: '8px 14px', cursor: 'pointer' }}
              onClick={resetGitConfig}
            >
              Use local values.yaml
            </button>
            <span style={{ opacity: 0.8 }}>
              Current git source: {gitConfig.giturl}
            </span>
            <span style={{ opacity: 0.8 }}>
              Config path: {gitConfig.valuesPath || '/values.yaml'}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <AuthProvider giturl={config?.giturl}>
      <DashboardProvider>
        <SoftIOCProvider>
          <AppShell theme={theme} onToggleTheme={toggleTheme}>
            <Routes>
              <Route path="/dashboard" element={<DashboardView />} />
              <Route path="/cameras" element={<CameraView />} />
              <Route path="/instrumentation" element={<InstrumentationView />} />
              <Route path="/beamline" element={<BeamlineView />} />
              <Route path="/layout" element={<BeamlineLayoutView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/tickets" element={<TicketsView />} />
              <Route path="/k8s" element={<K8sView />} />
              <Route path="/channels" element={<ChannelBrowserView />} />
              <Route path="/softioc" element={<SoftIOCView />} />
              <Route path="/ops/files" element={<OpsFilesView />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </AppShell>
        </SoftIOCProvider>
      </DashboardProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <AppRoutes />
        </AppProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
