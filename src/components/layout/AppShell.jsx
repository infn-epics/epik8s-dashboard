import { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { usePvwsStatus } from '../../hooks/usePv.js';
import { useApp } from '../../context/AppContext.jsx';
import UserMenu from '../common/UserMenu.jsx';
import HelpPanel from '../common/HelpPanel.jsx';
import Sidebar from './Sidebar.jsx';
import ChatConsole from '../consoles/ChatConsole.jsx';
import SystemConsole from '../consoles/SystemConsole.jsx';

/**
 * AppShell — professional layout with grouped navbar, console panels, sidebar.
 *
 * Navigation groups:
 *   Controls  — Dashboards, Beamline, Layout
 *   Monitor   — Cameras, Instrumentation
 *   Ops       — K8s, Tickets
 *   (global)  — Settings
 *
 * Console panels dock at the bottom and can be popped out.
 */
export default function AppShell({ children, theme, onToggleTheme }) {
  const { pvwsClient, devices, config } = useApp();
  const connected = usePvwsStatus(pvwsClient);
  const location = useLocation();
  const isDashboard = location.pathname === '/dashboard';
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Configurable title from config.dashboard.title or beamline name
  const dashboardTitle = config?.dashboard?.title
    || (config?.beamline ? `${config.beamline.toUpperCase()} — EPIK8s` : 'EPIK8s');

  // Sync browser tab title
  useEffect(() => { document.title = dashboardTitle; }, [dashboardTitle]);

  // Dropdown menus
  const [openGroup, setOpenGroup] = useState(null);
  const dropdownRef = useRef(null);

  // Console panels
  const [chatOpen, setChatOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [chatDetached, setChatDetached] = useState(false);
  const [systemDetached, setSystemDetached] = useState(false);

  // Help panel
  const [helpOpen, setHelpOpen] = useState(false);

  // Keyboard shortcut: F1 or ? toggle help
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F1') { e.preventDefault(); setHelpOpen(h => !h); }
      if (e.key === '?' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !e.target.isContentEditable) {
        setHelpOpen(h => !h);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close dropdown on navigation
  useEffect(() => { setOpenGroup(null); }, [location.pathname]);

  const toggleGroup = useCallback((name) => {
    setOpenGroup(prev => prev === name ? null : name);
  }, []);

  // Check if any route in a group is active
  const groupActive = (paths) => paths.some(p => location.pathname === p);

  const NAV_GROUPS = [
    {
      label: 'Controls',
      icon: '🎛',
      paths: ['/dashboard', '/beamline', '/layout'],
      items: [
        { to: '/dashboard', icon: '📊', label: 'Dashboards' },
        { to: '/beamline',  icon: '🔬', label: 'Beamline' },
        { to: '/layout',    icon: '🗺', label: 'Layout' },
      ],
    },
    {
      label: 'Monitor',
      icon: '📡',
      paths: ['/cameras', '/instrumentation'],
      items: [
        { to: '/cameras',         icon: '📷', label: 'Cameras' },
        { to: '/instrumentation', icon: '🔧', label: 'Instrumentation' },
      ],
    },
    {
      label: 'Ops',
      icon: '⚙',
      paths: ['/k8s', '/tickets'],
      items: [
        { to: '/k8s',     icon: '☸', label: 'K8s' },
        { to: '/tickets', icon: '🎫', label: 'Tickets' },
      ],
    },
  ];

  return (
    <div className="app-shell">
      <header className="app-navbar">
        <div className="navbar-brand">
          <span className="navbar-logo">⚛</span>
          <span className="navbar-title">{dashboardTitle}</span>
        </div>

        <nav className="navbar-nav" ref={dropdownRef}>
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="nav-group">
              <button
                className={`nav-group-btn ${groupActive(group.paths) ? 'active' : ''} ${openGroup === group.label ? 'open' : ''}`}
                onClick={() => toggleGroup(group.label)}
              >
                <span className="nav-group-icon">{group.icon}</span>
                {group.label}
                <span className="nav-caret">▾</span>
              </button>
              {openGroup === group.label && (
                <div className="nav-dropdown">
                  {group.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `nav-dropdown-item ${isActive ? 'active' : ''}`}
                    >
                      <span>{item.icon}</span> {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}

          <span className="nav-divider" />

          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            ⚙ Settings
          </NavLink>
        </nav>

        <div className="navbar-status">
          <button
            className={`console-toggle-btn ${chatOpen ? 'active' : ''}`}
            onClick={() => { setChatOpen(o => !o); setChatDetached(false); }}
            title="Chat"
          >
            💬
          </button>
          <button
            className={`console-toggle-btn ${systemOpen ? 'active' : ''}`}
            onClick={() => { setSystemOpen(o => !o); setSystemDetached(false); }}
            title="System Console"
          >
            🖥
          </button>
          <button
            className={`console-toggle-btn ${helpOpen ? 'active' : ''}`}
            onClick={() => setHelpOpen(h => !h)}
            title="Help (F1)"
          >
            ❓
          </button>
          <span className="nav-divider" />
          <span className="device-count">{devices.length} devices</span>
          <span className={`conn-badge ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? '● PVWS' : '○ PVWS'}
          </span>
          <button className="theme-toggle" onClick={onToggleTheme} title="Toggle theme">
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
          <UserMenu />
        </div>
      </header>

      <div className="app-body">
        {isDashboard && (
          <Sidebar
            collapsed={!sidebarOpen}
            onToggle={() => setSidebarOpen((o) => !o)}
          />
        )}
        <main className={`app-content ${isDashboard ? 'with-sidebar' : ''}`}>
          {children}
        </main>
      </div>

      {/* Console panels — docked at bottom or detached (floating) */}
      {chatOpen && (
        <ChatConsole
          detached={chatDetached}
          onDetach={() => setChatDetached(true)}
          onClose={() => { setChatOpen(false); setChatDetached(false); }}
        />
      )}
      {systemOpen && (
        <SystemConsole
          detached={systemDetached}
          onDetach={() => setSystemDetached(true)}
          onClose={() => { setSystemOpen(false); setSystemDetached(false); }}
        />
      )}

      {/* Help panel overlay */}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
