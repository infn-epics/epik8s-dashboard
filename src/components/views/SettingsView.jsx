import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLES } from '../../services/auth.js';

/**
 * SettingsView — Application settings page.
 *
 * Sections:
 *  - Beamline Repository: git URL as primary entry point
 *  - DataSources: PVWS and Archiver URL management
 *  - Authentication: PAT configuration for GitHub/GitLab
 */
export default function SettingsView() {
  const { dataSources, updateDataSources, resetDataSources, gitConfig, updateGitConfig, resetGitConfig } = useApp();
  const {
    user, provider, role, isAuthenticated, repoInfo,
    login, logout, authError, authLoading,
  } = useAuth();

  const [pvwsUrl, setPvwsUrl] = useState(dataSources.pvwsUrl);
  const [archiverUrl, setArchiverUrl] = useState(dataSources.archiverUrl);
  const [saved, setSaved] = useState(false);

  // Git URL config
  const [giturl, setGiturl] = useState(gitConfig?.giturl || '');
  const [gitbranch, setGitbranch] = useState(gitConfig?.gitbranch || 'main');
  const [gitSaved, setGitSaved] = useState(false);

  // PAT input
  const [patInput, setPatInput] = useState('');
  const [showPat, setShowPat] = useState(false);

  const isModified =
    pvwsUrl !== dataSources.pvwsUrl || archiverUrl !== dataSources.archiverUrl;
  const isOverridden =
    dataSources.pvwsUrl !== dataSources.pvwsDefault ||
    dataSources.archiverUrl !== dataSources.archiverDefault;

  const handleSave = () => {
    updateDataSources(pvwsUrl, archiverUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    resetDataSources();
    setPvwsUrl(dataSources.pvwsDefault);
    setArchiverUrl(dataSources.archiverDefault);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleGitSave = () => {
    if (!giturl.trim()) return;
    updateGitConfig(giturl.trim(), gitbranch.trim() || 'main', null);
    setGitSaved(true); // page reloads so this is just a visual flash
  };

  const handleGitReset = () => {
    resetGitConfig();
    // page also reloads
  };

  return (
    <div className="settings-view">
      <h2 className="settings-heading">⚙ Settings</h2>

      {/* Beamline Repository */}
      <section className="settings-section">
        <h3 className="settings-section-title">🦊 Beamline Repository</h3>
        <p className="settings-section-desc">
          Set the beamline git repository URL as the primary configuration source.
          The dashboard will load <code>values.yaml</code> (and all <code>deploy/values-*.yaml</code>)
          directly from git. Leave blank to fall back to the local <code>/values.yaml</code>.
        </p>
        <div className="settings-field">
          <label className="settings-label" htmlFor="git-url">Repository URL</label>
          <input
            id="git-url"
            className="settings-input"
            type="text"
            value={giturl}
            onChange={(e) => setGiturl(e.target.value)}
            placeholder="https://gitlab.example.com/beamline/epik8-mybeamline.git"
          />
          <span className="settings-hint">
            Supports https://github.com/… and https://gitlab.../… URLs.
            Public repos work without a token; private repos require the PAT below.
          </span>
        </div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="git-branch">Branch</label>
          <input
            id="git-branch"
            className="settings-input"
            type="text"
            value={gitbranch}
            onChange={(e) => setGitbranch(e.target.value)}
            placeholder="main"
            style={{ maxWidth: 180 }}
          />
        </div>
        <div className="settings-actions">
          <button
            className="settings-btn settings-btn--primary"
            onClick={handleGitSave}
            disabled={!giturl.trim()}
          >
            Save &amp; Reload
          </button>
          {gitConfig?.giturl && (
            <button className="settings-btn" onClick={handleGitReset}>
              Clear (use local values.yaml)
            </button>
          )}
          {gitSaved && <span className="settings-saved">Reloading…</span>}
        </div>
      </section>

      {/* DataSources Section */}
      <section className="settings-section">
        <h3 className="settings-section-title">Data Sources</h3>
        <p className="settings-section-desc">
          Configure connections to PVWS (Process Variable Web Socket) and the EPICS Archiver Appliance.
          Defaults are loaded from the YAML configuration file.
        </p>

        <div className="settings-field">
          <label className="settings-label" htmlFor="ds-pvws">PVWS URL</label>
          <input
            id="ds-pvws"
            className="settings-input"
            type="text"
            value={pvwsUrl}
            onChange={(e) => setPvwsUrl(e.target.value)}
            placeholder="ws://host/pvws/pv"
          />
          {dataSources.pvwsDefault && (
            <span className="settings-hint">Default: {dataSources.pvwsDefault}</span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-label" htmlFor="ds-archiver">Archiver URL</label>
          <input
            id="ds-archiver"
            className="settings-input"
            type="text"
            value={archiverUrl}
            onChange={(e) => setArchiverUrl(e.target.value)}
            placeholder="http://host (optional)"
          />
          {dataSources.archiverDefault && (
            <span className="settings-hint">Default: {dataSources.archiverDefault}</span>
          )}
        </div>

        <div className="settings-actions">
          <button
            className="settings-btn settings-btn--primary"
            onClick={handleSave}
            disabled={!isModified}
          >
            Save &amp; Reconnect
          </button>
          <button
            className="settings-btn"
            onClick={handleReset}
            disabled={!isOverridden}
            title="Restore URLs from YAML configuration"
          >
            Reset to Defaults
          </button>
          {saved && <span className="settings-saved">✓ Saved</span>}
        </div>
      </section>

      {/* Authentication Section */}
      <section className="settings-section">
        <h3 className="settings-section-title">🔑 Authentication</h3>
        <p className="settings-section-desc">
          Provide a Personal Access Token (PAT) for your git platform to enable
          configuration editing, ticket creation, and role-based access.
          {repoInfo && (
            <> Repository: <strong>{repoInfo.platform === 'github' ? '🐙 GitHub' : '🦊 GitLab'}</strong> — <code>{repoInfo.projectPath}</code> on <code>{repoInfo.host}</code></>
          )}
        </p>

        {/* Current auth status */}
        {isAuthenticated ? (
          <div className="settings-auth-status">
            <div className="settings-auth-user">
              {user.avatarUrl && <img src={user.avatarUrl} alt={user.login} className="settings-auth-avatar" />}
              <div className="settings-auth-info">
                <span className="settings-auth-name">{user.name}</span>
                <span className="settings-auth-login">
                  {provider === 'github' ? '🐙' : '🦊'} @{user.login}
                </span>
                <span className="settings-auth-role" style={{ color: ROLES[role]?.color }}>
                  Role: {ROLES[role]?.label} — {ROLES[role]?.description}
                </span>
              </div>
            </div>
            <button className="settings-btn" onClick={logout}>🚪 Logout</button>
          </div>
        ) : (
          <div className="settings-auth-status">
            <span className="settings-auth-anon">Not authenticated — using viewer mode</span>
          </div>
        )}

        {/* PAT login form (when not authenticated) */}
        {!isAuthenticated && (
          <div className="settings-field" style={{ marginTop: 12 }}>
            <label className="settings-label" htmlFor="auth-pat">
              {repoInfo?.platform === 'github' ? 'GitHub' : 'GitLab'} Personal Access Token
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="auth-pat"
                className="settings-input"
                type={showPat ? 'text' : 'password'}
                value={patInput}
                onChange={e => setPatInput(e.target.value)}
                placeholder={repoInfo?.platform === 'github' ? 'ghp_...' : 'glpat-...'}
                onKeyDown={e => { if (e.key === 'Enter' && patInput.trim()) login(patInput.trim()); }}
              />
              <button className="settings-btn" onClick={() => setShowPat(s => !s)} title="Toggle visibility">
                {showPat ? '🙈' : '👁'}
              </button>
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => login(patInput.trim())}
                disabled={!patInput.trim() || authLoading}
              >
                {authLoading ? '⟳ Validating…' : '🔑 Login'}
              </button>
            </div>
            <span className="settings-hint">
              {repoInfo?.platform === 'github'
                ? 'Create a PAT at github.com → Settings → Developer settings → Personal access tokens (scopes: repo)'
                : `Create a PAT at ${repoInfo?.host || 'gitlab'} → Preferences → Access Tokens (scopes: api, read_api)`}
            </span>
          </div>
        )}
        {authError && <div className="settings-auth-error">{authError}</div>}
      </section>
    </div>
  );
}
