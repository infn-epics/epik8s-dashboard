/**
 * UserMenu — Navbar user avatar/login button with dropdown menu.
 * Uses PAT authentication — directs to Settings for login.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLES } from '../../services/auth.js';

export default function UserMenu() {
  const { user, provider, role, isAuthenticated, logout, authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (authLoading) {
    return <span className="user-menu-loading">Authenticating…</span>;
  }

  if (!isAuthenticated) {
    return (
      <div className="user-menu-login" ref={ref}>
        <button className="user-menu-login-btn" onClick={() => navigate('/settings')}>
          🔑 Login
        </button>
      </div>
    );
  }

  const roleInfo = ROLES[role] || ROLES.viewer;

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-avatar-btn" onClick={() => setOpen(o => !o)} title={`${user.name} (${role})`}>
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.login} className="user-menu-avatar" />
        ) : (
          <span className="user-menu-avatar-placeholder">{user.name?.[0]?.toUpperCase() || '?'}</span>
        )}
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-login-id">
              {provider === 'keycloak' ? '🔐' : provider === 'github' ? '🐙' : '🦊'} @{user.login}
            </div>
            <div className="user-menu-role" style={{ color: roleInfo.color }}>
              {roleInfo.label}
            </div>
          </div>
          <div className="user-menu-divider" />
          {user.profileUrl && (
            <a className="user-menu-dropdown-item"
              href={user.profileUrl} target="_blank" rel="noopener noreferrer">
              <span className="user-menu-icon">👤</span> Profile
            </a>
          )}
          <button className="user-menu-dropdown-item" onClick={() => { logout(); setOpen(false); }}>
            <span className="user-menu-icon">🚪</span> Logout
          </button>
        </div>
      )}
    </div>
  );
}
