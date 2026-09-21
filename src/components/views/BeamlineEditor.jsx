import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import yaml from 'js-yaml';
import { useApp } from '../../context/AppContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { parseGitUrl, getFile, commitFile } from '../../services/gitApi.js';
import { IOC_TEMPLATES, getTemplateKeys, resolveTemplate } from '../../models/iocTemplates.js';
import { iocsToList, iocsToMap, replaceIoc, insertIocAfter, uniqueCopyName } from '../../models/iocs.js';

/**
 * BeamlineEditor — edit IOCs and services from the values.yaml,
 * validate, and commit/push to the beamline git repository.
 *
 * Uses the PAT token from AuthContext for all git operations.
 */
export default function BeamlineEditor() {
  const { config } = useApp();
  const { token, isAuthenticated, user, hasRole, provider } = useAuth();

  // Git repo info derived from config
  const repoInfo = useMemo(() => parseGitUrl(config?.giturl), [config?.giturl]);
  const branch = config?.gitrev || 'main';
  const valuesPath = 'deploy/values.yaml';

  // Editor state
  const [rawYaml, setRawYaml] = useState('');
  const [parsedConfig, setParsedConfig] = useState(null);
  const [fileRef, setFileRef] = useState(null); // sha (GitHub) or blob_id (GitLab)
  const [fetchError, setFetchError] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [dirty, setDirty] = useState(false);

  // View mode: 'visual' | 'yaml'
  const [viewMode, setViewMode] = useState('visual');

  // Commit dialog
  const [showCommit, setShowCommit] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  // IOC/Service editing
  const [editingItem, setEditingItem] = useState(null); // { section, index, data }
  const [addingSection, setAddingSection] = useState(null); // 'ioc' | 'service' | null
  const [sidebarOpen, setSidebarOpen] = useState(true); // template sidebar

  // ─── Fetch values.yaml from repo ─────────────────────────────
  const fetchYaml = useCallback(async () => {
    if (!repoInfo || !token) return;
    setFetching(true);
    setFetchError(null);
    try {
      const result = await getFile(repoInfo, valuesPath, branch, token);
      setRawYaml(result.content);
      setFileRef(result.sha || result.blob_id || null);
      tryParse(result.content);
      setDirty(false);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetching(false);
    }
  }, [repoInfo, branch, token, valuesPath]);

  // Auto-fetch when token becomes available
  useEffect(() => {
    if (isAuthenticated && repoInfo && !rawYaml) {
      fetchYaml();
    }
  }, [isAuthenticated, repoInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── YAML parsing & validation ────────────────────────────────
  const tryParse = useCallback((text) => {
    const errors = [];
    try {
      const parsed = yaml.load(text);
      setParsedConfig(parsed);

      // Structural validation
      if (!parsed || typeof parsed !== 'object') {
        errors.push('Root must be a YAML mapping');
      } else {
        if (!parsed.beamline) errors.push('Missing required field: beamline');
        if (!parsed.namespace) errors.push('Missing required field: namespace');
        if (!parsed.epicsConfiguration) errors.push('Missing epicsConfiguration section');
        const iocs = parsed.epicsConfiguration?.iocs;
        if (iocs != null && typeof iocs !== 'object') {
          errors.push('epicsConfiguration.iocs must be a mapping keyed by IOC name');
        } else if (Array.isArray(iocs)) {
          // Legacy list form: still readable, converted to a map on first edit
          const seen = new Set();
          iocs.forEach((ioc, i) => {
            if (!ioc?.name) errors.push(`IOC #${i + 1}: missing name`);
            else if (seen.has(ioc.name)) errors.push(`IOC "${ioc.name}": duplicate name`);
            else seen.add(ioc.name);
          });
        } else if (iocs) {
          Object.entries(iocs).forEach(([key, ioc]) => {
            if (!ioc || typeof ioc !== 'object') errors.push(`IOC "${key}": must be a mapping`);
            else if (ioc.name && ioc.name !== key) errors.push(`IOC "${key}": name "${ioc.name}" differs from its key`);
          });
        }
        const services = parsed.epicsConfiguration?.services;
        if (services && typeof services !== 'object') errors.push('epicsConfiguration.services must be a mapping');
      }
    } catch (e) {
      errors.push(`YAML syntax error: ${e.message}`);
      setParsedConfig(null);
    }
    setValidationErrors(errors);
    return errors;
  }, []);

  // ─── Rebuild YAML from parsed config ──────────────────────────
  const rebuildYaml = useCallback((cfg) => {
    const text = yaml.dump(cfg, { lineWidth: 120, noRefs: true, quotingType: '"', forceQuotes: false });
    setRawYaml(text);
    tryParse(text);
    setDirty(true);
  }, [tryParse]);

  // ─── IOC Operations ───────────────────────────────────────────
  // `iocs` is a list view (index-based UI) over the name-keyed map in the config
  const rawIocs = parsedConfig?.epicsConfiguration?.iocs;
  const iocs = useMemo(() => iocsToList(rawIocs), [rawIocs]);
  const services = parsedConfig?.epicsConfiguration?.services || {};

  // Clone the config with `iocs` as a map (converts the legacy list form)
  const cloneWithIocMap = () => {
    const cfg = structuredClone(parsedConfig);
    if (!cfg.epicsConfiguration) cfg.epicsConfiguration = {};
    cfg.epicsConfiguration.iocs = iocsToMap(cfg.epicsConfiguration.iocs);
    return cfg;
  };

  const updateIoc = (index, newData) => {
    const key = iocs[index].name;
    const newKey = newData.name;
    const cfg = cloneWithIocMap();
    const map = cfg.epicsConfiguration.iocs;
    if (!newKey) { alert('IOC name is required'); return; }
    if (newKey !== key && Object.hasOwn(map, newKey)) {
      alert(`IOC "${newKey}" already exists`);
      return;
    }
    cfg.epicsConfiguration.iocs = replaceIoc(map, key, newKey, newData);
    rebuildYaml(cfg);
    setEditingItem(null);
  };

  const removeIoc = (index) => {
    const cfg = cloneWithIocMap();
    delete cfg.epicsConfiguration.iocs[iocs[index].name];
    rebuildYaml(cfg);
  };

  const addIoc = (newIoc) => {
    const cfg = cloneWithIocMap();
    if (!newIoc.name) { alert('IOC name is required'); return; }
    if (Object.hasOwn(cfg.epicsConfiguration.iocs, newIoc.name)) {
      alert(`IOC "${newIoc.name}" already exists`);
      return;
    }
    cfg.epicsConfiguration.iocs[newIoc.name] = newIoc;
    rebuildYaml(cfg);
    setAddingSection(null);
  };

  const cloneIoc = (index) => {
    const source = iocs[index];
    const cfg = cloneWithIocMap();
    const clone = structuredClone(source);
    clone.name = uniqueCopyName(cfg.epicsConfiguration.iocs, source.name);
    cfg.epicsConfiguration.iocs = insertIocAfter(cfg.epicsConfiguration.iocs, source.name, clone.name, clone);
    rebuildYaml(cfg);
    // Open the clone for editing
    setEditingItem({ section: 'ioc', index: index + 1, data: structuredClone(clone) });
  };

  // ─── Service Operations ───────────────────────────────────────
  const updateService = (key, newData) => {
    const cfg = structuredClone(parsedConfig);
    cfg.epicsConfiguration.services[key] = newData;
    rebuildYaml(cfg);
    setEditingItem(null);
  };

  const removeService = (key) => {
    const cfg = structuredClone(parsedConfig);
    delete cfg.epicsConfiguration.services[key];
    rebuildYaml(cfg);
  };

  const addService = (key, newData) => {
    const cfg = structuredClone(parsedConfig);
    if (!cfg.epicsConfiguration) cfg.epicsConfiguration = {};
    if (!cfg.epicsConfiguration.services) cfg.epicsConfiguration.services = {};
    cfg.epicsConfiguration.services[key] = newData;
    rebuildYaml(cfg);
    setAddingSection(null);
  };

  // ─── Raw YAML edits ──────────────────────────────────────────
  const handleRawChange = (text) => {
    setRawYaml(text);
    tryParse(text);
    setDirty(true);
  };

  // ─── Commit & Push ───────────────────────────────────────────
  const handleCommit = async () => {
    if (!repoInfo || !token || validationErrors.length > 0) return;
    if (!hasRole('operator')) return;
    setCommitting(true);
    setCommitResult(null);
    try {
      const defaultMsg = `Update values.yaml via EPIK8s Dashboard (${user?.login || 'unknown'})`;
      const result = await commitFile(
        repoInfo, valuesPath, branch, rawYaml,
        commitMsg || defaultMsg,
        token, fileRef,
      );
      setCommitResult({ success: true, message: 'Committed successfully!' });
      setDirty(false);
      setShowCommit(false);
      setCommitMsg('');
      // Re-fetch to get new sha/blob_id
      fetchYaml();
    } catch (err) {
      setCommitResult({ success: false, message: err.message });
    } finally {
      setCommitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="bl-editor">
      {/* Header */}
      <div className="bl-editor-header">
        <h3 className="bl-editor-title">📝 Beamline Configuration Editor</h3>
        {repoInfo && (
          <span className="bl-editor-repo">
            {repoInfo.platform === 'gitlab' ? '🦊' : '🐙'} {repoInfo.projectPath} ({branch})
          </span>
        )}
      </div>

      {/* Auth status */}
      {!repoInfo ? (
        <div className="bl-editor-notice">
          No git repository URL found in configuration (<code>giturl</code>).
        </div>
      ) : isAuthenticated ? (
        <div className="bl-editor-pat-bar">
          <span className="bl-editor-auth-status">
            ✓ Authenticated as <strong>{user?.name}</strong> ({provider === 'github' ? '🐙' : '🦊'} @{user?.login})
          </span>
          {!parsedConfig && (
            <button className="bl-btn bl-btn--primary bl-btn--sm" onClick={fetchYaml} disabled={fetching}>
              {fetching ? '⟳ Loading…' : '🔄 Fetch'}
            </button>
          )}
          {fetchError && <span className="bl-editor-error">{fetchError}</span>}
        </div>
      ) : (
        <div className="bl-editor-pat-bar">
          <span className="bl-editor-hint">
            🔑 Please login with a PAT in <a href="#/settings">Settings → Authentication</a> to edit
          </span>
        </div>
      )}

      {/* Only show editor when we have data */}
      {parsedConfig && (
        <>
          {/* Validation bar */}
          <ValidationBar errors={validationErrors} dirty={dirty} />

          {/* Mode toggle + commit button */}
          <div className="bl-editor-toolbar">
            <div className="toolbar-toggle-group">
              <button className={`toolbar-btn ${viewMode === 'visual' ? 'active' : ''}`} onClick={() => setViewMode('visual')}>
                📋 Visual
              </button>
              <button className={`toolbar-btn ${viewMode === 'yaml' ? 'active' : ''}`} onClick={() => setViewMode('yaml')}>
                📄 YAML
              </button>
            </div>
            <div className="bl-editor-toolbar-actions">
              <button className="bl-btn" onClick={fetchYaml} disabled={fetching}>↻ Reload</button>
              <button
                className="bl-btn bl-btn--primary"
                onClick={() => { setCommitMsg(''); setCommitResult(null); setShowCommit(true); }}
                disabled={!dirty || validationErrors.length > 0}
              >
                💾 Commit &amp; Push
              </button>
            </div>
          </div>

          {/* Commit result flash */}
          {commitResult && (
            <div className={`bl-editor-flash ${commitResult.success ? 'bl-editor-flash--ok' : 'bl-editor-flash--err'}`}>
              {commitResult.message}
              <button className="bl-btn bl-btn--sm" onClick={() => setCommitResult(null)}>✕</button>
            </div>
          )}

          {/* Visual editor */}
          {viewMode === 'visual' ? (
            <div className="bl-editor-visual-layout">
              {/* Main content area */}
              <div className="bl-editor-main">
                {/* Services — compact inline chips */}
                <section className="bl-section">
                  <div className="bl-section-header">
                    <h4 className="bl-section-title">🔌 Services ({Object.keys(services).length})</h4>
                  </div>
                  {editingItem?.section === 'service' ? (
                    <ServiceRow
                      name={editingItem.index}
                      data={services[editingItem.index]}
                      isEditing
                      onSave={(newData) => updateService(editingItem.index, newData)}
                      onCancel={() => setEditingItem(null)}
                      onRemove={() => removeService(editingItem.index)}
                    />
                  ) : (
                    <div className="bl-chip-grid">
                      {Object.entries(services).map(([key, svc]) => (
                        <ServiceChip
                          key={key}
                          name={key}
                          data={svc}
                          onEdit={() => setEditingItem({ section: 'service', index: key, data: structuredClone(svc) })}
                          onRemove={() => removeService(key)}
                        />
                      ))}
                    </div>
                  )}
                  {addingSection === 'service' && (
                    <AddServiceForm onSave={addService} onCancel={() => setAddingSection(null)} />
                  )}
                </section>

                {/* IOCs — hierarchical tree grouped by template → devtype → zone */}
                <section className="bl-section">
                  <div className="bl-section-header">
                    <h4 className="bl-section-title">⚙ IOCs ({iocs.length})</h4>
                  </div>
                  {editingItem?.section === 'ioc' ? (
                    <IocRow
                      data={iocs[editingItem.index]}
                      index={editingItem.index}
                      defaults={parsedConfig.iocDefaults || {}}
                      isEditing
                      onSave={(newData) => updateIoc(editingItem.index, newData)}
                      onCancel={() => setEditingItem(null)}
                      onRemove={() => removeIoc(editingItem.index)}
                    />
                  ) : (
                    <IocTree
                      iocs={iocs}
                      onEdit={(idx) => setEditingItem({ section: 'ioc', index: idx, data: structuredClone(iocs[idx]) })}
                      onClone={cloneIoc}
                      onRemove={removeIoc}
                    />
                  )}
                  {addingSection === 'ioc' && (
                    <AddIocForm
                      defaults={parsedConfig.iocDefaults || {}}
                      beamlinePrefix={parsedConfig.namespace?.toUpperCase() || 'BEAMLINE'}
                      onSave={addIoc}
                      onCancel={() => setAddingSection(null)}
                    />
                  )}
                </section>
              </div>

              {/* Template sidebar */}
              <TemplateSidebar
                open={sidebarOpen}
                onToggle={() => setSidebarOpen((s) => !s)}
                onAddIoc={(tplKey) => { setAddingSection('ioc'); setEditingItem(null); }}
                onAddService={() => { setAddingSection('service'); setEditingItem(null); }}
                addingSection={addingSection}
                setAddingSection={setAddingSection}
                defaults={parsedConfig.iocDefaults || {}}
                beamlinePrefix={parsedConfig.namespace?.toUpperCase() || 'BEAMLINE'}
                onSaveIoc={addIoc}
                onSaveService={addService}
              />
            </div>
          ) : (
            /* YAML editor with line numbers, auto-indent, and live validation */
            <SmartYamlEditor value={rawYaml} onChange={handleRawChange} errors={validationErrors} />
          )}
        </>
      )}

      {/* Commit dialog */}
      {showCommit && (
        <div className="widget-modal-overlay" onClick={() => setShowCommit(false)}>
          <div className="widget-modal bl-commit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="widget-modal-header">
              <span className="widget-title">💾 Commit &amp; Push</span>
              <button className="widget-btn" onClick={() => setShowCommit(false)}>✕</button>
            </div>
            <div className="widget-modal-body">
              <div className="bl-commit-info">
                <span>{repoInfo.platform === 'gitlab' ? '🦊' : '🐙'} {repoInfo.projectPath}</span>
                <span>Branch: <strong>{branch}</strong></span>
                <span>File: <code>{valuesPath}</code></span>
              </div>
              <label className="settings-label">Commit message:</label>
              <textarea
                className="bl-commit-msg"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="Update values.yaml via EPIK8s Beamline Editor"
                rows={3}
              />
              {commitResult && !commitResult.success && (
                <div className="bl-editor-flash bl-editor-flash--err">{commitResult.message}</div>
              )}
              <div className="bl-commit-actions">
                <button className="bl-btn" onClick={() => setShowCommit(false)}>Cancel</button>
                <button
                  className="bl-btn bl-btn--primary"
                  onClick={handleCommit}
                  disabled={committing}
                >
                  {committing ? '⟳ Pushing…' : '🚀 Commit & Push'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validation Bar ─────────────────────────────────────────────────────

function ValidationBar({ errors, dirty }) {
  if (errors.length === 0) {
    return (
      <div className="bl-validation bl-validation--ok">
        ✅ YAML is valid{dirty ? ' (unsaved changes)' : ''}
      </div>
    );
  }
  return (
    <div className="bl-validation bl-validation--err">
      <strong>⚠ {errors.length} validation error(s):</strong>
      <ul className="bl-validation-list">
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  );
}

// ─── IOC Row ────────────────────────────────────────────────────────────

function IocRow({ data, index, defaults, isEditing, onEdit, onSave, onCancel, onRemove }) {
  const devCount = data.devices?.length || 0;
  const template = data.template || '';
  const tplDef = resolveTemplate(data);
  const [editMode, setEditMode] = useState('form'); // 'form' | 'yaml'
  const [formData, setFormData] = useState({});
  const [devices, setDevices] = useState([]);

  // Populate form state when entering edit mode
  useEffect(() => {
    if (isEditing && tplDef) {
      setFormData({
        name: data.name || '',
        iocprefix: data.iocprefix || '',
        zones: Array.isArray(data.zones) ? data.zones.join(', ') : (data.zones || ''),
        asset: data.asset || '',
        _server: data.iocparam?.find?.((p) => p.key === 'SERVER')?.value || '',
        _port: data.iocparam?.find?.((p) => p.key === 'PORT')?.value || '',
        _devtype: data.devtype || tplDef.defaultDevtype || '',
        // Camera extras
        ...Object.fromEntries((tplDef.iocExtras || []).map((f) => [f.key, data[f.key] ?? f.default])),
      });
      setDevices(data.devices ? structuredClone(data.devices) : []);
      setEditMode('form');
    }
  }, [isEditing]);

  if (isEditing) {
    // Template-aware structured editing
    if (tplDef && editMode === 'form') {
      const handleFormSave = () => {
        const ioc = tplDef.scaffold(formData.name, formData._devtype || tplDef.defaultDevtype, formData.iocprefix);
        if (formData.zones) ioc.zones = formData.zones.split(',').map((z) => z.trim()).filter(Boolean);
        if (formData.asset) ioc.asset = formData.asset;
        const iocparam = [];
        if (formData._server) iocparam.push({ key: 'SERVER', value: formData._server });
        if (formData._port) iocparam.push({ key: 'PORT', value: formData._port });
        if (iocparam.length) ioc.iocparam = iocparam;
        for (const ext of (tplDef.iocExtras || [])) {
          if (formData[ext.key] !== undefined) ioc[ext.key] = formData[ext.key];
        }
        ioc.devices = devices.filter((d) => d.name).map((d) => {
          const cleaned = {};
          for (const [k, v] of Object.entries(d)) {
            if (v !== '' && v !== undefined) cleaned[k] = v;
          }
          return cleaned;
        });
        // Preserve any extra fields from original data
        for (const [k, v] of Object.entries(data)) {
          if (!(k in ioc)) ioc[k] = v;
        }
        onSave(ioc);
      };

      return (
        <div className="bl-row bl-row--editing">
          <div className="bl-row-edit-header">
            <span className="bl-row-edit-label">{tplDef.icon} {data.name}</span>
            <div className="bl-row-edit-actions">
              <button className="bl-btn bl-btn--sm" onClick={() => setEditMode('yaml')}>📄 YAML</button>
              <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleFormSave}>✓ Save</button>
              <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
            </div>
          </div>
          <IocFormFields
            tplDef={tplDef}
            formData={formData}
            setFormData={setFormData}
            devices={devices}
            setDevices={setDevices}
            beamlinePrefix={formData.iocprefix?.split(':')[0] || ''}
          />
        </div>
      );
    }

    // Fall back to YAML editor (unknown template or user chose YAML)
    return (
      <ItemYamlEditor
        initialData={data}
        onSave={onSave}
        onCancel={onCancel}
        label={`IOC: ${data.name}`}
        extraActions={tplDef ? <button className="bl-btn bl-btn--sm" onClick={() => setEditMode('form')}>📋 Form</button> : null}
      />
    );
  }

  return (
    <div className="bl-row">
      <div className="bl-row-main">
        <span className="bl-row-icon">{tplDef?.icon || '⚙'}</span>
        <span className="bl-row-name">{data.name}</span>
        <span className="bl-row-badge">{template}</span>
        {data.devtype && <span className="bl-row-badge bl-row-badge--dim">{data.devtype}</span>}
        <span className="bl-row-meta">{devCount} device(s)</span>
        {data.zones && <span className="bl-row-badge bl-row-badge--zone">{Array.isArray(data.zones) ? data.zones.join(', ') : data.zones}</span>}
      </div>
      <div className="bl-row-devices">
        {(data.devices || []).slice(0, 6).map((d, i) => (
          <span key={i} className="bl-device-chip">{d.name}</span>
        ))}
        {devCount > 6 && <span className="bl-device-chip bl-device-chip--more">+{devCount - 6}</span>}
      </div>
      <div className="bl-row-actions">
        <button className="bl-btn bl-btn--sm" onClick={onEdit} title="Edit">✏️</button>
        <button className="bl-btn bl-btn--sm bl-btn--danger" onClick={() => {
          if (confirm(`Remove IOC "${data.name}"?`)) onRemove();
        }} title="Remove">🗑</button>
      </div>
    </div>
  );
}

// ─── Service Chip (compact) ─────────────────────────────────────────────

function ServiceChip({ name, data, onEdit, onRemove }) {
  return (
    <div className="bl-chip" title={data.asset || name}>
      <span className="bl-chip-icon">🔌</span>
      <span className="bl-chip-name">{name}</span>
      {data.enable_ingress && <span className="bl-chip-tag">ingress</span>}
      {data.autosync && <span className="bl-chip-tag bl-chip-tag--sync">sync</span>}
      <button className="bl-chip-action" onClick={onEdit} title="Edit">✏️</button>
      <button className="bl-chip-action bl-chip-action--danger" onClick={() => { if (confirm(`Remove "${name}"?`)) onRemove(); }} title="Remove">✕</button>
    </div>
  );
}

// ─── Service Row (for editing) ──────────────────────────────────────────

function ServiceRow({ name, data, isEditing, onSave, onCancel, onRemove }) {
  if (isEditing) {
    return <ItemYamlEditor initialData={data} onSave={onSave} onCancel={onCancel} label={`Service: ${name}`} />;
  }
  return null;
}

// ─── IOC Tree (hierarchical: template → devtype → iocs) ────────────────

function IocTree({ iocs, onEdit, onClone, onRemove }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (key) => setCollapsed((p) => ({ ...p, [key]: !p[key] }));

  // Build hierarchy: template → devtype → [{ioc, originalIndex}]
  const tree = useMemo(() => {
    const m = {};
    iocs.forEach((ioc, idx) => {
      const tpl = ioc.template || 'custom';
      const dt = ioc.devtype || 'default';
      if (!m[tpl]) m[tpl] = {};
      if (!m[tpl][dt]) m[tpl][dt] = [];
      m[tpl][dt].push({ ioc, idx });
    });
    return m;
  }, [iocs]);

  return (
    <div className="bl-tree">
      {Object.entries(tree).map(([tpl, devtypes]) => {
        const tplDef = IOC_TEMPLATES[tpl];
        const icon = tplDef?.icon || '📦';
        const tplKey = `tpl:${tpl}`;
        const tplCount = Object.values(devtypes).reduce((s, arr) => s + arr.length, 0);
        const isTplCollapsed = collapsed[tplKey];
        return (
          <div key={tpl} className="bl-tree-group">
            <div className="bl-tree-header" onClick={() => toggle(tplKey)}>
              <span className="bl-tree-toggle">{isTplCollapsed ? '▸' : '▾'}</span>
              <span className="bl-tree-icon">{icon}</span>
              <span className="bl-tree-label">{tplDef?.label || tpl}</span>
              <span className="bl-tree-count">{tplCount}</span>
            </div>
            {!isTplCollapsed && Object.entries(devtypes).map(([dt, items]) => {
              const dtKey = `dt:${tpl}:${dt}`;
              const isDtCollapsed = collapsed[dtKey];
              const showDtLevel = Object.keys(devtypes).length > 1 || dt !== 'default';
              return (
                <div key={dt} className="bl-tree-subgroup">
                  {showDtLevel && (
                    <div className="bl-tree-subheader" onClick={() => toggle(dtKey)}>
                      <span className="bl-tree-toggle">{isDtCollapsed ? '▸' : '▾'}</span>
                      <span className="bl-tree-sublabel">{dt}</span>
                      <span className="bl-tree-count">{items.length}</span>
                    </div>
                  )}
                  {(!showDtLevel || !isDtCollapsed) && items.map(({ ioc, idx }) => (
                    <IocChip key={idx} data={ioc} onEdit={() => onEdit(idx)} onClone={() => onClone(idx)} onRemove={() => onRemove(idx)} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── IOC Chip (compact) ─────────────────────────────────────────────────

function IocChip({ data, onEdit, onClone, onRemove }) {
  const tplDef = resolveTemplate(data);
  const devCount = data.devices?.length || 0;
  const zones = Array.isArray(data.zones) ? data.zones : (data.zones ? [data.zones] : []);

  return (
    <div className="bl-ioc-chip" title={`${data.name} — ${devCount} device(s)`}>
      <span className="bl-ioc-chip-name">{data.name}</span>
      <span className="bl-ioc-chip-devs">{devCount}d</span>
      {zones.map((z) => <span key={z} className="bl-chip-tag bl-chip-tag--zone">{z}</span>)}
      <button className="bl-chip-action" onClick={onEdit} title="Edit">✏️</button>
      <button className="bl-chip-action" onClick={onClone} title="Clone">📋</button>
      <button className="bl-chip-action bl-chip-action--danger" onClick={() => { if (confirm(`Remove IOC "${data.name}"?`)) onRemove(); }} title="Remove">✕</button>
    </div>
  );
}

// ─── Smart YAML Editor (with line numbers, auto-indent, Tab) ────────────

function SmartYamlEditor({ value, onChange, errors }) {
  const taRef = useRef(null);
  const lineCount = value.split('\n').length;

  const handleKeyDown = (e) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;

    // Tab → insert 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const newVal = before + '  ' + after;
      onChange(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = selectionStart + 2; });
      return;
    }

    // Enter → auto-indent (carry forward leading spaces of current line)
    if (e.key === 'Enter') {
      e.preventDefault();
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const currentLine = before.split('\n').pop();
      const indent = currentLine.match(/^(\s*)/)[1];
      // If line ends with ':', add 2 extra spaces
      const extra = currentLine.trimEnd().endsWith(':') ? '  ' : '';
      const newVal = before + '\n' + indent + extra + after;
      const cursor = selectionStart + 1 + indent.length + extra.length;
      onChange(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = cursor; });
    }
  };

  return (
    <div className="bl-smart-yaml">
      <div className="bl-smart-yaml-gutter" aria-hidden>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="bl-smart-yaml-line-no">{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="bl-smart-yaml-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      {errors.length > 0 && (
        <div className="bl-smart-yaml-errors">
          {errors.map((e, i) => <div key={i} className="bl-smart-yaml-err">{e}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── Template-aware IOC Form (inline YAML or structured) ────────────────

function IocFormFields({ tplDef, formData, setFormData, devices, setDevices, beamlinePrefix }) {
  const updateField = (key, val) => setFormData((prev) => ({ ...prev, [key]: val }));
  const allFields = [...(tplDef.iocFields || []), ...(tplDef.iocExtras || [])];

  const addDevice = () => {
    const defaults = {};
    (tplDef.deviceFields || []).forEach((f) => {
      if (f.default !== undefined) defaults[f.key] = f.default;
    });
    setDevices((prev) => [...prev, defaults]);
  };

  const updateDevice = (idx, key, val) => {
    setDevices((prev) => {
      const next = prev.map((d, i) => i === idx ? { ...d, [key]: val } : d);
      return next;
    });
  };

  const removeDevice = (idx) => setDevices((prev) => prev.filter((_, i) => i !== idx));

  return (
    <>
      {/* IOC-level fields */}
      <div className="bl-tpl-fields">
        {allFields.map((f) => (
          <TemplateField key={f.key} def={f} value={formData[f.key]} onChange={(v) => updateField(f.key, v)} />
        ))}

        {/* Devtype selector */}
        {tplDef.devtypes.length > 1 && (
          <div className="bl-tpl-field">
            <label className="bl-tpl-field-label">Device Type</label>
            <select className="settings-input" value={formData._devtype || tplDef.defaultDevtype || ''} onChange={(e) => updateField('_devtype', e.target.value)}>
              {tplDef.devtypes.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Devices */}
      <div className="bl-tpl-devices">
        <div className="bl-tpl-devices-header">
          <strong>Devices ({devices.length})</strong>
          <button className="bl-btn bl-btn--sm" onClick={addDevice}>+ Device</button>
        </div>
        {devices.map((dev, idx) => (
          <div key={idx} className="bl-tpl-device-row">
            <span className="bl-tpl-device-num">#{idx + 1}</span>
            <div className="bl-tpl-device-fields">
              {(tplDef.deviceFields || []).map((f) => (
                <TemplateField key={f.key} def={f} value={dev[f.key]} onChange={(v) => updateDevice(idx, f.key, v)} compact />
              ))}
            </div>
            <button className="bl-btn bl-btn--sm bl-btn--danger" onClick={() => removeDevice(idx)} title="Remove device">✕</button>
          </div>
        ))}
      </div>
    </>
  );
}

/** Single field renderer for template forms */
function TemplateField({ def, value, onChange, compact }) {
  const { key, label, type, placeholder, options, help, required } = def;
  const val = value ?? def.default ?? '';

  const cls = compact ? 'bl-tpl-field bl-tpl-field--compact' : 'bl-tpl-field';

  if (type === 'boolean') {
    return (
      <label className={`${cls} bl-tpl-field--check`}>
        <input type="checkbox" checked={!!val} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }

  if (type === 'select') {
    return (
      <div className={cls}>
        {!compact && <label className="bl-tpl-field-label">{label}{required && ' *'}</label>}
        <select className="settings-input" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {compact && <span className="bl-tpl-field-hint">{label}</span>}
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <div className={cls}>
        <label className="bl-tpl-field-label">{label}{required && ' *'}</label>
        <textarea
          className="bl-yaml-textarea bl-yaml-textarea--inline"
          value={String(val)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>
    );
  }

  if (type === 'keyvalue') {
    const kvArr = Array.isArray(val) ? val : [];
    return (
      <div className={cls}>
        <label className="bl-tpl-field-label">{label}{required && ' *'}</label>
        <KeyValueEditor value={kvArr} onChange={onChange} />
      </div>
    );
  }

  // text / number
  return (
    <div className={cls}>
      {!compact && <label className="bl-tpl-field-label">{label}{required && ' *'}</label>}
      <input
        className="settings-input"
        type={type === 'number' ? 'number' : 'text'}
        value={val}
        onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        placeholder={placeholder}
        required={required}
        step={type === 'number' ? 'any' : undefined}
      />
      {compact && <span className="bl-tpl-field-hint">{label}</span>}
      {help && !compact && <span className="bl-tpl-field-help">{help}</span>}
    </div>
  );
}

// ─── Item YAML Editor (inline, with smart editing) ──────────────────────

function ItemYamlEditor({ initialData, onSave, onCancel, label, extraActions }) {
  const [text, setText] = useState(() => yaml.dump(initialData, { lineWidth: 120, noRefs: true }));
  const [error, setError] = useState(null);
  const taRef = useRef(null);

  const handleKeyDown = (e) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;

    if (e.key === 'Tab') {
      e.preventDefault();
      const before = text.slice(0, selectionStart);
      const after = text.slice(selectionEnd);
      const newVal = before + '  ' + after;
      setText(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = selectionStart + 2; });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const before = text.slice(0, selectionStart);
      const after = text.slice(selectionEnd);
      const currentLine = before.split('\n').pop();
      const indent = currentLine.match(/^(\s*)/)[1];
      const extra = currentLine.trimEnd().endsWith(':') ? '  ' : '';
      const listPrefix = currentLine.match(/^(\s*)-\s/) ? '- ' : '';
      const newVal = before + '\n' + indent + extra + listPrefix + after;
      const cursor = selectionStart + 1 + indent.length + extra.length + listPrefix.length;
      setText(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = cursor; });
    }
  };

  const handleSave = () => {
    try {
      const parsed = yaml.load(text);
      if (!parsed || typeof parsed !== 'object') {
        setError('Must be a YAML mapping');
        return;
      }
      setError(null);
      onSave(parsed);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="bl-row bl-row--editing">
      <div className="bl-row-edit-header">
        <span className="bl-row-edit-label">{label}</span>
        <div className="bl-row-edit-actions">
          {extraActions}
          <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleSave}>✓ Save</button>
          <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
        </div>
      </div>
      {error && <div className="bl-editor-error">{error}</div>}
      <textarea
        ref={taRef}
        className="bl-yaml-textarea bl-yaml-textarea--inline"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        rows={Math.min(30, text.split('\n').length + 2)}
      />
    </div>
  );
}

// ─── Add IOC Form (template-aware wizard) ───────────────────────────────

function AddIocForm({ defaults, beamlinePrefix, onSave, onCancel }) {
  const [step, setStep] = useState('select'); // 'select' | 'configure' | 'yaml'
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [formData, setFormData] = useState({});
  const [devices, setDevices] = useState([]);
  const [yamlText, setYamlText] = useState('');
  const [error, setError] = useState(null);

  const tplKeys = getTemplateKeys();

  const selectTemplate = (key) => {
    const tpl = IOC_TEMPLATES[key];
    setSelectedTpl(key);
    setFormData({
      name: '',
      iocprefix: `${beamlinePrefix}:`,
      zones: '',
      asset: '',
      _server: '',
      _port: '',
      _devtype: tpl.defaultDevtype || tpl.devtypes[0] || '',
    });
    setDevices([]);
    setStep('configure');
    setError(null);
  };

  const buildIocObject = () => {
    const tpl = IOC_TEMPLATES[selectedTpl];
    const ioc = tpl.scaffold(formData.name, formData._devtype || tpl.defaultDevtype, formData.iocprefix);

    // Apply form fields
    if (formData.zones) ioc.zones = formData.zones.split(',').map((z) => z.trim()).filter(Boolean);
    if (formData.asset) ioc.asset = formData.asset;

    // Connection fields → iocparam entries
    const iocparam = [];
    if (formData._server) iocparam.push({ key: 'SERVER', value: formData._server });
    if (formData._port) iocparam.push({ key: 'PORT', value: formData._port });
    if (iocparam.length) ioc.iocparam = iocparam;

    // IOC extras (camera plugins etc.)
    for (const ext of (tpl.iocExtras || [])) {
      if (formData[ext.key] !== undefined && formData[ext.key] !== ext.default) {
        ioc[ext.key] = formData[ext.key];
      }
    }

    // Devices — filter out empty default-only entries
    ioc.devices = devices.filter((d) => d.name).map((d) => {
      const cleaned = {};
      for (const [k, v] of Object.entries(d)) {
        if (v !== '' && v !== undefined) cleaned[k] = v;
      }
      return cleaned;
    });

    return ioc;
  };

  const handleFormSave = () => {
    if (!formData.name?.trim()) { setError('IOC name is required'); return; }
    try {
      const ioc = buildIocObject();
      onSave(ioc);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleYamlSave = () => {
    try {
      const parsed = yaml.load(yamlText);
      if (!parsed?.name) { setError('IOC must have a name field'); return; }
      onSave(parsed);
    } catch (e) { setError(e.message); }
  };

  const showYamlPreview = () => {
    try {
      const ioc = buildIocObject();
      setYamlText(yaml.dump(ioc, { lineWidth: 120, noRefs: true }));
      setStep('yaml');
    } catch (e) {
      setError(e.message);
    }
  };

  // ─── Template selector ─────────────────────────────────────
  if (step === 'select') {
    return (
      <div className="bl-row bl-row--editing">
        <div className="bl-row-edit-header">
          <span className="bl-row-edit-label">Add IOC — Select Template</span>
          <div className="bl-row-edit-actions">
            <button className="bl-btn bl-btn--sm" onClick={() => { setStep('yaml'); setYamlText('name: "my-ioc"\ntemplate: "motor"\ndevices: []'); }}>
              📄 Raw YAML
            </button>
            <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
          </div>
        </div>
        <div className="bl-tpl-grid">
          {tplKeys.map((key) => {
            const t = IOC_TEMPLATES[key];
            return (
              <button key={key} className="bl-tpl-card" onClick={() => selectTemplate(key)}>
                <span className="bl-tpl-card-icon">{t.icon}</span>
                <span className="bl-tpl-card-label">{t.label}</span>
                <span className="bl-tpl-card-help">{t.devtypes.length} type(s)</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Raw YAML mode ─────────────────────────────────────────
  if (step === 'yaml') {
    return (
      <div className="bl-row bl-row--editing">
        <div className="bl-row-edit-header">
          <span className="bl-row-edit-label">Add IOC — YAML</span>
          <div className="bl-row-edit-actions">
            {selectedTpl && <button className="bl-btn bl-btn--sm" onClick={() => setStep('configure')}>📋 Form</button>}
            <button className="bl-btn bl-btn--sm" onClick={() => setStep('select')}>← Templates</button>
            <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleYamlSave}>✓ Add</button>
            <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
          </div>
        </div>
        {error && <div className="bl-editor-error">{error}</div>}
        <SmartYamlEditor
          value={yamlText}
          onChange={setYamlText}
          errors={(() => { try { yaml.load(yamlText); return []; } catch (e) { return [e.message]; } })()}
        />
      </div>
    );
  }

  // ─── Structured form mode ──────────────────────────────────
  const tplDef = IOC_TEMPLATES[selectedTpl];
  return (
    <div className="bl-row bl-row--editing">
      <div className="bl-row-edit-header">
        <span className="bl-row-edit-label">{tplDef.icon} Add {tplDef.label} IOC</span>
        <div className="bl-row-edit-actions">
          <button className="bl-btn bl-btn--sm" onClick={() => setStep('select')}>← Templates</button>
          <button className="bl-btn bl-btn--sm" onClick={showYamlPreview}>📄 Preview YAML</button>
          <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleFormSave}>✓ Add</button>
          <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
        </div>
      </div>
      {tplDef.help && <div className="bl-tpl-help">{tplDef.help}</div>}
      {error && <div className="bl-editor-error">{error}</div>}
      <IocFormFields
        tplDef={tplDef}
        formData={formData}
        setFormData={setFormData}
        devices={devices}
        setDevices={setDevices}
        beamlinePrefix={beamlinePrefix}
      />
    </div>
  );
}

// ─── Add Service Form ───────────────────────────────────────────────────

function AddServiceForm({ onSave, onCancel }) {
  const [key, setKey] = useState('');
  const [useYaml, setUseYaml] = useState(false);
  const [yamlText, setYamlText] = useState('');
  const [error, setError] = useState(null);

  const handleSave = () => {
    if (useYaml) {
      try {
        const parsed = yaml.load(yamlText);
        if (!key.trim()) { setError('Service key is required'); return; }
        if (!parsed || typeof parsed !== 'object') { setError('Must be a YAML mapping'); return; }
        onSave(key.trim(), parsed);
      } catch (e) { setError(e.message); }
    } else {
      if (!key.trim()) { setError('Service key is required'); return; }
      onSave(key.trim(), { asset: '', enable_ingress: false, autosync: false });
    }
  };

  return (
    <div className="bl-row bl-row--editing">
      <div className="bl-row-edit-header">
        <span className="bl-row-edit-label">Add new Service</span>
        <div className="bl-row-edit-actions">
          <button className="bl-btn bl-btn--sm" onClick={() => setUseYaml((u) => !u)}>
            {useYaml ? '📋 Form' : '📄 YAML'}
          </button>
          <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleSave}>✓ Add</button>
          <button className="bl-btn bl-btn--sm" onClick={onCancel}>✕ Cancel</button>
        </div>
      </div>
      {error && <div className="bl-editor-error">{error}</div>}
      <div className="settings-field">
        <label className="settings-label">Service key (e.g. archiver, pvws)</label>
        <input className="settings-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="my-service" />
      </div>
      {useYaml && (
        <textarea
          className="bl-yaml-textarea bl-yaml-textarea--inline"
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          placeholder={'asset: "My Service"\nenable_ingress: true\nautosync: false'}
          spellCheck={false}
          rows={8}
        />
      )}
    </div>
  );
}

// ─── Key-Value Editor with +/- buttons ──────────────────────────────────

function KeyValueEditor({ value, onChange }) {
  const items = Array.isArray(value) ? value : [];

  const addItem = () => onChange([...items, { key: '', value: '' }]);
  const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx, field, val) => {
    onChange(items.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  };

  return (
    <div className="bl-kv-editor">
      {items.map((item, idx) => (
        <div key={idx} className="bl-kv-row">
          <input
            className="settings-input bl-kv-input"
            value={item.key || item.name || ''}
            onChange={(e) => updateItem(idx, 'key', e.target.value)}
            placeholder="Name"
          />
          <input
            className="settings-input bl-kv-input"
            value={item.value || item.val || ''}
            onChange={(e) => updateItem(idx, 'value', e.target.value)}
            placeholder="Value"
          />
          <button className="bl-btn bl-btn--sm bl-btn--danger bl-kv-remove" onClick={() => removeItem(idx)} title="Remove">−</button>
        </div>
      ))}
      <button className="bl-btn bl-btn--sm bl-kv-add" onClick={addItem}>+ Add parameter</button>
    </div>
  );
}

// ─── Template Sidebar (vertical bar with IOC + service templates) ───────

const SERVICE_TEMPLATES = [
  { key: 'pvagateway', label: 'PVA Gateway', icon: '🌐' },
  { key: 'gateway', label: 'CA Gateway', icon: '🔗' },
  { key: 'archiver', label: 'Archiver', icon: '💾' },
  { key: 'pvws', label: 'PVWS', icon: '📡' },
  { key: 'dbwr', label: 'Display Builder WR', icon: '🖥' },
  { key: 'alarm', label: 'Alarm Server', icon: '🔔' },
  { key: 'console', label: 'IOC Console', icon: '📟' },
];

function TemplateSidebar({ open, onToggle, addingSection, setAddingSection, defaults, beamlinePrefix, onSaveIoc, onSaveService }) {
  const tplKeys = getTemplateKeys();
  const [activeTab, setActiveTab] = useState('ioc'); // 'ioc' | 'service'

  // For IOC add flow
  const [selectedTpl, setSelectedTpl] = useState(null);
  const [formData, setFormData] = useState({});
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);

  // For service add flow
  const [svcKey, setSvcKey] = useState('');
  const [svcError, setSvcError] = useState(null);

  const selectIocTemplate = (key) => {
    const tpl = IOC_TEMPLATES[key];
    setSelectedTpl(key);
    setFormData({
      name: '',
      iocprefix: `${beamlinePrefix}:`,
      zones: '',
      asset: '',
      _server: '',
      _port: '',
      _devtype: tpl.defaultDevtype || tpl.devtypes[0] || '',
    });
    setDevices([]);
    setError(null);
  };

  const handleSaveIoc = () => {
    if (!selectedTpl) return;
    const tpl = IOC_TEMPLATES[selectedTpl];
    if (!formData.name?.trim()) { setError('IOC name is required'); return; }
    try {
      const ioc = tpl.scaffold(formData.name, formData._devtype || tpl.defaultDevtype, formData.iocprefix);
      if (formData.zones) ioc.zones = formData.zones.split(',').map((z) => z.trim()).filter(Boolean);
      if (formData.asset) ioc.asset = formData.asset;
      const iocparam = [];
      if (formData._server) iocparam.push({ key: 'SERVER', value: formData._server });
      if (formData._port) iocparam.push({ key: 'PORT', value: formData._port });
      if (iocparam.length) ioc.iocparam = iocparam;
      for (const ext of (tpl.iocExtras || [])) {
        if (formData[ext.key] !== undefined && formData[ext.key] !== ext.default) ioc[ext.key] = formData[ext.key];
      }
      ioc.devices = devices.filter((d) => d.name).map((d) => {
        const cleaned = {};
        for (const [k, v] of Object.entries(d)) { if (v !== '' && v !== undefined) cleaned[k] = v; }
        return cleaned;
      });
      onSaveIoc(ioc);
      setSelectedTpl(null);
      setFormData({});
      setDevices([]);
    } catch (e) { setError(e.message); }
  };

  const handleAddService = (key) => {
    onSaveService(key, { charturl: '', enable_ingress: false, autosync: false });
  };

  const handleAddCustomService = () => {
    if (!svcKey.trim()) { setSvcError('Service key is required'); return; }
    onSaveService(svcKey.trim(), { charturl: '', enable_ingress: false, autosync: false });
    setSvcKey('');
    setSvcError(null);
  };

  if (!open) {
    return (
      <div className="bl-sidebar bl-sidebar--collapsed">
        <button className="bl-sidebar-toggle" onClick={onToggle} title="Open template panel">◀</button>
      </div>
    );
  }

  return (
    <div className="bl-sidebar">
      <div className="bl-sidebar-header">
        <span className="bl-sidebar-title">Templates</span>
        <button className="bl-sidebar-toggle" onClick={onToggle} title="Close template panel">▶</button>
      </div>

      {/* Tab toggle */}
      <div className="bl-sidebar-tabs">
        <button className={`bl-sidebar-tab ${activeTab === 'ioc' ? 'active' : ''}`} onClick={() => setActiveTab('ioc')}>
          ⚙ IOCs
        </button>
        <button className={`bl-sidebar-tab ${activeTab === 'service' ? 'active' : ''}`} onClick={() => setActiveTab('service')}>
          🔌 Services
        </button>
      </div>

      <div className="bl-sidebar-content">
        {activeTab === 'ioc' && !selectedTpl && (
          <div className="bl-sidebar-list">
            {tplKeys.map((key) => {
              const t = IOC_TEMPLATES[key];
              return (
                <button key={key} className="bl-sidebar-item" onClick={() => selectIocTemplate(key)}>
                  <span className="bl-sidebar-item-icon">{t.icon}</span>
                  <span className="bl-sidebar-item-label">{t.label}</span>
                  <span className="bl-sidebar-item-count">{t.devtypes.length} type(s)</span>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'ioc' && selectedTpl && (
          <div className="bl-sidebar-form">
            <div className="bl-sidebar-form-header">
              <button className="bl-btn bl-btn--sm" onClick={() => setSelectedTpl(null)}>← Back</button>
              <span>{IOC_TEMPLATES[selectedTpl].icon} {IOC_TEMPLATES[selectedTpl].label}</span>
            </div>
            {error && <div className="bl-editor-error">{error}</div>}
            <IocFormFields
              tplDef={IOC_TEMPLATES[selectedTpl]}
              formData={formData}
              setFormData={setFormData}
              devices={devices}
              setDevices={setDevices}
              beamlinePrefix={beamlinePrefix}
            />
            <div className="bl-sidebar-form-actions">
              <button className="bl-btn bl-btn--sm" onClick={() => setSelectedTpl(null)}>Cancel</button>
              <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleSaveIoc}>✓ Add IOC</button>
            </div>
          </div>
        )}

        {activeTab === 'service' && (
          <div className="bl-sidebar-list">
            {SERVICE_TEMPLATES.map((svc) => (
              <button key={svc.key} className="bl-sidebar-item" onClick={() => handleAddService(svc.key)}>
                <span className="bl-sidebar-item-icon">{svc.icon}</span>
                <span className="bl-sidebar-item-label">{svc.label}</span>
              </button>
            ))}
            <div className="bl-sidebar-custom-svc">
              <span className="bl-tpl-field-label">Custom service</span>
              <div className="bl-sidebar-custom-svc-row">
                <input
                  className="settings-input"
                  value={svcKey}
                  onChange={(e) => setSvcKey(e.target.value)}
                  placeholder="service-key"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustomService()}
                />
                <button className="bl-btn bl-btn--sm bl-btn--primary" onClick={handleAddCustomService}>+</button>
              </div>
              {svcError && <div className="bl-editor-error">{svcError}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
