import { NavLink } from 'react-router-dom';
import { usePvwsStatus } from '../../hooks/usePv.js';
import { useApp } from '../../context/AppContext.jsx';

/**
 * AppShell - Top navigation bar with view switching and status indicators.
 */
export default function AppShell({ children, theme, onToggleTheme }) {
  const { pvwsClient, devices } = useApp();
  const connected = usePvwsStatus(pvwsClient);

  return (
    <div className="app-shell">
      <header className="app-navbar">
        <div className="navbar-brand">
          <span className="navbar-logo">⚛</span>
          <span className="navbar-title">EPIK8s Dashboard</span>
        </div>

        <nav className="navbar-nav">
          <NavLink to="/cameras" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            📷 Cameras
          </NavLink>
          <NavLink to="/instrumentation" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            🔧 Instrumentation
          </NavLink>
          <NavLink to="/beamline" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            🔬 Beamline
          </NavLink>
        </nav>

        <div className="navbar-status">
          <span className="device-count">{devices.length} devices</span>
          <span className={`conn-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● PVWS' : '○ PVWS'}
          </span>
          <button className="theme-toggle" onClick={onToggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
        </div>
      </header>

      <main className="app-content">{children}</main>
    </div>
  );
}
