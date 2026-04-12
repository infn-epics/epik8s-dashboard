/**
 * ValuesEditor — Editor for values-softiocs.yaml deployment descriptors.
 *
 * Features:
 *  - Import/export values-softiocs.yaml
 *  - Table view of all softiocs with inline editing
 *  - Add/remove softiocs
 *  - Edit defaults section
 *  - YAML preview with copy/download
 */
import { useState, useCallback, useRef } from 'react';
import yaml from 'js-yaml';
import { useSoftIOC } from '../../context/SoftIOCContext.jsx';

export default function ValuesEditor() {
  const {
    valuesData,
    valuesLoaded,
    importValues,
    importTaskConfig,
    updateSoftioc,
    removeSoftioc,
    getValuesYaml,
    dirty,
  } = useSoftIOC();

  const [showYaml, setShowYaml] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importText, setImportText] = useState('');
  const fileRef = useRef(null);

  const softiocs = valuesData.softiocs || [];
  const defaults = valuesData.defaults || {};

  // Import from text
  const handleImport = useCallback(() => {
    if (!importText.trim()) return;
    importValues(importText);
    setImportMode(false);
    setImportText('');
  }, [importText, importValues]);

  // Import from file
  const handleFileImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importValues(reader.result);
      setImportMode(false);
    };
    reader.readAsText(file);
  }, [importValues]);

  // Import config.yaml for a softioc
  const handleConfigImport = useCallback((name) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        importTaskConfig(name, reader.result);
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importTaskConfig]);

  // Copy YAML to clipboard
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(getValuesYaml());
  }, [getValuesYaml]);

  // Download YAML
  const handleDownload = useCallback(() => {
    const blob = new Blob([getValuesYaml()], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'values-softiocs.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }, [getValuesYaml]);

  // Inline edit field
  const editField = useCallback((name, field, value) => {
    updateSoftioc(name, { [field]: value });
  }, [updateSoftioc]);

  return (
    <div className="sioc-values-editor">
      <div className="sioc-values-toolbar">
        <h3>📋 Deployment Descriptors</h3>
        <div className="sioc-values-actions">
          <button className="btn btn-sm btn-secondary" onClick={() => setImportMode(!importMode)}>
            📥 Import
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowYaml(!showYaml)}>
            {showYaml ? '📊 Table' : '📝 YAML'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={!valuesLoaded}>
            📋 Copy
          </button>
          <button className="btn btn-sm btn-accent" onClick={handleDownload} disabled={!valuesLoaded}>
            💾 Download
          </button>
          {dirty && <span className="sioc-dirty-badge">unsaved</span>}
        </div>
      </div>

      {/* Import panel */}
      {importMode && (
        <div className="sioc-import-panel">
          <p>Paste values-softiocs.yaml content or load from file:</p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder="Paste values-softiocs.yaml content here..."
          />
          <div className="sioc-import-actions">
            <button className="btn btn-accent" onClick={handleImport}>Import Text</button>
            <label className="btn btn-secondary">
              📁 From File
              <input type="file" ref={fileRef} accept=".yaml,.yml"
                onChange={handleFileImport} style={{ display: 'none' }} />
            </label>
            <button className="btn btn-ghost" onClick={() => setImportMode(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Defaults */}
      {Object.keys(defaults).length > 0 && (
        <div className="sioc-defaults-section">
          <h4>Defaults</h4>
          <div className="sioc-defaults-tags">
            {Object.entries(defaults).map(([k, v]) => (
              <span key={k} className="sioc-default-tag">{k}: {String(v)}</span>
            ))}
          </div>
        </div>
      )}

      {/* YAML view */}
      {showYaml ? (
        <div className="sioc-yaml-preview">
          <pre>{getValuesYaml()}</pre>
        </div>
      ) : (
        /* Table view */
        <div className="sioc-values-table-wrap">
          {softiocs.length === 0 ? (
            <p className="sioc-empty">No softiocs defined. Import a YAML or create one with the wizard.</p>
          ) : (
            <table className="sioc-values-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>IOC Prefix</th>
                  <th>Module</th>
                  <th>Description</th>
                  <th>Git Path</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {softiocs.map((s) => (
                  <tr key={s.name}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>
                      <input type="text" value={s.iocprefix}
                        className="sioc-inline-edit"
                        onChange={(e) => editField(s.name, 'iocprefix', e.target.value)} />
                    </td>
                    <td>{s.module}</td>
                    <td>
                      <input type="text" value={s.description}
                        className="sioc-inline-edit sioc-wide"
                        onChange={(e) => editField(s.name, 'description', e.target.value)} />
                    </td>
                    <td>
                      <span className="sioc-git-path" title={s.gitRepoConfig?.url}>
                        {s.gitRepoConfig?.path || '—'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-xs btn-secondary"
                        onClick={() => handleConfigImport(s.name)}
                        title="Import config.yaml for this task">
                        📄
                      </button>
                      <button className="btn btn-xs btn-danger"
                        onClick={() => {
                          if (confirm(`Remove "${s.name}"?`)) removeSoftioc(s.name);
                        }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
