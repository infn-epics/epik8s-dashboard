import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import AppShell from './components/layout/AppShell.jsx';
import CameraView from './components/views/CameraView.jsx';
import InstrumentationView from './components/views/InstrumentationView.jsx';
import BeamlineView from './components/views/BeamlineView.jsx';

function AppRoutes() {
  const { loading, error } = useApp();
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
      </div>
    );
  }

  return (
    <AppShell theme={theme} onToggleTheme={toggleTheme}>
      <Routes>
        <Route path="/cameras" element={<CameraView />} />
        <Route path="/instrumentation" element={<InstrumentationView />} />
        <Route path="/beamline" element={<BeamlineView />} />
        <Route path="*" element={<Navigate to="/cameras" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}
