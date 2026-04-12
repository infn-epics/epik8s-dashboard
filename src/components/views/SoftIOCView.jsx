/**
 * SoftIOCView — Main view for the SoftIOC Dashboard.
 *
 * Tabs:
 *  - Visualizer: live PV monitoring of running softiocs
 *  - Builder: step-by-step wizard for creating softioc configurations
 *  - Links: visual link connection editor
 *  - Deployment: values-softiocs.yaml management
 */
import { useState, useCallback } from 'react';
import { useSoftIOC } from '../../context/SoftIOCContext.jsx';
import SoftIOCVisualizer from '../softioc/SoftIOCVisualizer.jsx';
import SoftIOCWizard from '../softioc/SoftIOCWizard.jsx';
import LinkEditor from '../softioc/LinkEditor.jsx';
import ValuesEditor from '../softioc/ValuesEditor.jsx';

const TABS = [
  { id: 'visualizer', label: 'Visualizer', icon: '📡' },
  { id: 'builder',    label: 'Builder',    icon: '🛠' },
  { id: 'links',      label: 'Links',      icon: '🔗' },
  { id: 'deployment', label: 'Deployment', icon: '📦' },
];

function SyncButton({ syncStatus, canSync, onSync }) {
  if (!canSync) return null;
  const { state, lastSync, error } = syncStatus;
  const isSyncing = state === 'syncing';

  return (
    <div className="sioc-sync-area">
      {state === 'error' && (
        <span className="sioc-sync-error" title={error}>
          ⚠ {error.length > 60 ? error.slice(0, 60) + '…' : error}
        </span>
      )}
      {state === 'ok' && lastSync && (
        <span className="sioc-sync-ok">
          Synced {lastSync.toLocaleTimeString()}
        </span>
      )}
      {state === 'syncing' && (
        <span className="sioc-sync-busy">Syncing…</span>
      )}
      <button
        className="sioc-btn sioc-btn-secondary sioc-btn-sm"
        onClick={onSync}
        disabled={isSyncing}
        title="Fetch deploy/values-softiocs.yaml from the git repository"
      >
        {isSyncing ? '⟳ Syncing…' : '⟳ Sync'}
      </button>
    </div>
  );
}

export default function SoftIOCView() {
  const [activeTab, setActiveTab] = useState('visualizer');
  const {
    valuesData,
    taskConfigs,
    selectedSoftioc,
    setSelectedSoftioc,
    showWizard,
    openWizard,
    closeWizard,
    dirty,
    syncStatus,
    canSync,
    syncFromGit,
  } = useSoftIOC();

  const softiocCount = valuesData.softiocs?.length || 0;
  const configCount = Object.keys(taskConfigs).length;

  const handleNewTask = useCallback(() => {
    setActiveTab('builder');
    openWizard();
  }, [openWizard]);

  const handleEditLinks = useCallback((name) => {
    setSelectedSoftioc(name);
    setActiveTab('links');
  }, [setSelectedSoftioc]);

  return (
    <div className="sioc-view">
      {/* Header */}
      <div className="sioc-view-header">
        <div className="sioc-view-title">
          <h2>SoftIOC Dashboard</h2>
          <span className="sioc-view-stats">
            {softiocCount} softioc{softiocCount !== 1 ? 's' : ''}
            {configCount > 0 && ` · ${configCount} config${configCount !== 1 ? 's' : ''}`}
            {dirty && <span className="sioc-dirty-badge">unsaved</span>}
          </span>
        </div>
        <div className="sioc-view-actions">
          <SyncButton syncStatus={syncStatus} canSync={canSync} onSync={syncFromGit} />
          <button className="sioc-btn sioc-btn-primary" onClick={handleNewTask}>
            + New SoftIOC
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="sioc-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sioc-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="sioc-tab-icon">{tab.icon}</span>
            <span className="sioc-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="sioc-tab-content">
        {activeTab === 'visualizer' && (
          <SoftIOCVisualizer onEditLinks={handleEditLinks} />
        )}
        {activeTab === 'builder' && (
          <div className="sioc-builder-tab">
            {showWizard ? (
              <SoftIOCWizard onClose={closeWizard} />
            ) : (
              <div className="sioc-builder-empty">
                <div className="sioc-builder-empty-icon">🧩</div>
                <h3>SoftIOC Builder</h3>
                <p>
                  Create a new softioc configuration using step-by-step templates.
                  Choose a template to get started with pre-configured inputs, outputs,
                  and rules.
                </p>
                <button className="sioc-btn sioc-btn-primary" onClick={() => openWizard()}>
                  Start New Configuration
                </button>
              </div>
            )}
          </div>
        )}
        {activeTab === 'links' && (
          selectedSoftioc && taskConfigs[selectedSoftioc] ? (
            <LinkEditor taskName={selectedSoftioc} onClose={() => setSelectedSoftioc(null)} />
          ) : (
            <div className="sioc-builder-empty">
              <h3>🔗 Link Editor</h3>
              <p>Select a softioc to edit its wired input/output link connections.</p>
              <div className="sioc-task-picker">
                {valuesData.softiocs?.map((s) => (
                  <button key={s.name}
                    className={`sioc-btn ${taskConfigs[s.name] ? 'sioc-btn-primary' : 'sioc-btn-secondary'}`}
                    disabled={!taskConfigs[s.name]}
                    onClick={() => setSelectedSoftioc(s.name)}
                    title={taskConfigs[s.name] ? `Edit links for ${s.name}` : 'Config not loaded — sync first'}
                  >
                    {s.name} {!taskConfigs[s.name] && '(no config)'}
                  </button>
                ))}
              </div>
            </div>
          )
        )}
        {activeTab === 'deployment' && (
          <ValuesEditor />
        )}
      </div>
    </div>
  );
}
