/**
 * TaskJobWizard — Step-by-step wizard to create a new beamline controller task.
 *
 * Steps:
 *   1. Basic info — name, mode, description, module
 *   2. Parameters — key-value pairs with types
 *   3. Inputs — PV definitions (name, type, desc, unit)
 *   4. Outputs — PV definitions (name, type, desc, unit)
 *   5. Preview & Save — YAML config + Python skeleton
 */
import { useState, useCallback, useRef } from 'react';
import {
  PV_TYPE_MAP,
  generateTaskPython,
  generateTaskYaml,
  generateFullConfigYaml,
  generateRequirementsTxt,
  generateStartSh,
  generateTaskZip,
  getDefaultTaskPath,
  DEFAULT_TASK_PATH,
  deployPlugin,
  generateSoftIocEntry,
  mergeSoftIocValues,
  SOFTIOC_VALUES_PATH,
} from '../../services/beamlineControllerApi.js';
import { parseGitUrl, commitFiles, getFile, commitFile } from '../../services/gitApi.js';

const STEPS = [
  { key: 'basic', label: '1. Basic Info' },
  { key: 'params', label: '2. Parameters' },
  { key: 'inputs', label: '3. Inputs' },
  { key: 'outputs', label: '4. Outputs' },
  { key: 'preview', label: '5. Preview & Save' },
];

const PV_TYPES = Object.keys(PV_TYPE_MAP);

export default function TaskJobWizard({ prefix, controllerApiUrl, defaultGitUrl, onClose, onCreated }) {
  const [step, setStep] = useState(0);

  // Step 1: Basic
  const [name, setName] = useState('');
  const [mode, setMode] = useState('continuous');
  const [description, setDescription] = useState('');
  const [taskPrefix, setTaskPrefix] = useState('');

  // Step 2: Parameters
  const [parameters, setParameters] = useState([]);

  // Step 3: Inputs
  const [inputs, setInputs] = useState([]);

  // Step 4: Outputs
  const [outputs, setOutputs] = useState([]);

  // Git info (lifted from StepPreview so we can pass it back with onCreated)
  const [wizGitUrl, setWizGitUrl] = useState(defaultGitUrl || '');
  const [wizGitBranch, setWizGitBranch] = useState('main');
  const [wizGitPat, setWizGitPat] = useState('');
  const [wizProjectPath, setWizProjectPath] = useState('');

  // Validation
  const [validationError, setValidationError] = useState('');

  const moduleName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const validateStep = () => {
    setValidationError('');
    switch (step) {
      case 0: // Basic
        if (!name.trim()) {
          setValidationError('Task name is required');
          return false;
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim())) {
          setValidationError('Task name must be a valid Python identifier (letters, digits, underscores)');
          return false;
        }
        return true;
      case 1: // Parameters
        for (const p of parameters) {
          if (!p.key.trim()) {
            setValidationError('All parameters must have a name');
            return false;
          }
        }
        return true;
      case 2: // Inputs
        for (const inp of inputs) {
          if (!inp.name.trim()) {
            setValidationError('All inputs must have a name');
            return false;
          }
          if (!/^[A-Z][A-Z0-9_]*$/.test(inp.name.trim())) {
            setValidationError(`Input PV name "${inp.name}" must be UPPER_CASE (e.g., INPUT1, SENSOR_VALUE)`);
            return false;
          }
        }
        return true;
      case 3: // Outputs
        for (const out of outputs) {
          if (!out.name.trim()) {
            setValidationError('All outputs must have a name');
            return false;
          }
          if (!/^[A-Z][A-Z0-9_]*$/.test(out.name.trim())) {
            setValidationError(`Output PV name "${out.name}" must be UPPER_CASE (e.g., RESULT, STATUS_VAL)`);
            return false;
          }
        }
        return true;
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (validateStep()) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const prevStep = () => setStep((s) => Math.max(s - 1, 0));

  // Build task definition from wizard state
  const buildTaskDef = useCallback(() => {
    const paramObj = {};
    for (const p of parameters) {
      if (p.key.trim()) {
        let val = p.value;
        if (p.type === 'list') {
          // Parse newline/comma-separated items into an array
          val = String(val).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        } else if (p.type === 'float') val = parseFloat(val) || 0;
        else if (p.type === 'int') val = parseInt(val, 10) || 0;
        else if (p.type === 'bool') val = val === 'true' || val === '1' || val === true;
        paramObj[p.key] = { value: val, default: val, type: p.type };
      }
    }

    const inputObj = {};
    for (const inp of inputs) {
      if (inp.name.trim()) {
        inputObj[inp.name] = {
          type: inp.type,
          desc: inp.desc,
          unit: inp.unit,
          default: inp.default ?? 0,
          value: inp.default ?? 0,
        };
      }
    }

    const outputObj = {};
    for (const out of outputs) {
      if (out.name.trim()) {
        outputObj[out.name] = {
          type: out.type,
          desc: out.desc,
          unit: out.unit,
          default: out.default ?? 0,
          value: out.default ?? 0,
        };
      }
    }

    return {
      name: name.trim(),
      mode,
      description,
      module: moduleName,
      prefix: taskPrefix.trim().toUpperCase() || null,
      parameters: paramObj,
      inputs: inputObj,
      outputs: outputObj,
    };
  }, [name, mode, description, moduleName, taskPrefix, parameters, inputs, outputs]);

  // Download helpers
  const downloadFile = (filename, content, mimeType = 'text/plain') => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPython = () => {
    const taskDef = buildTaskDef();
    downloadFile(`${moduleName}.py`, generateTaskPython(taskDef));
  };

  const handleDownloadYaml = () => {
    const taskDef = buildTaskDef();
    downloadFile('config.yaml', generateFullConfigYaml(taskDef, prefix));
  };

  const handleDownloadRequirements = () => {
    downloadFile('requirements.txt', generateRequirementsTxt());
  };

  const handleDownloadZip = async (basePath) => {
    const taskDef = buildTaskDef();
    const blob = await generateTaskZip(taskDef, prefix, basePath || null);
    downloadBlob(`${moduleName}.zip`, blob);
  };

  const handleCreate = () => {
    const taskDef = buildTaskDef();
    const effectivePath = wizProjectPath || `${DEFAULT_TASK_PATH}/${taskDef.module || taskDef.name || 'my_task'}`;
    const gitInfo = {
      url: wizGitUrl || '',
      branch: wizGitBranch || 'main',
      path: effectivePath,
      pat: wizGitPat || '',
    };
    onCreated?.(taskDef, gitInfo);
  };

  // Render the active step content
  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepBasic {...{ name, setName, mode, setMode, description, setDescription, taskPrefix, setTaskPrefix, moduleName }} />;
      case 1:
        return <StepParameters parameters={parameters} setParameters={setParameters} />;
      case 2:
        return <StepPvDefs items={inputs} setItems={setInputs} label="Input" />;
      case 3:
        return <StepPvDefs items={outputs} setItems={setOutputs} label="Output" />;
      case 4:
        return (
          <StepPreview
            taskDef={buildTaskDef()}
            prefix={prefix}
            controllerApiUrl={controllerApiUrl}
            defaultGitUrl={defaultGitUrl}
            gitUrl={wizGitUrl}
            setGitUrl={setWizGitUrl}
            gitBranch={wizGitBranch}
            setGitBranch={setWizGitBranch}
            gitPat={wizGitPat}
            setGitPat={setWizGitPat}
            projectPath={wizProjectPath}
            setProjectPath={setWizProjectPath}
            onDownloadPython={handleDownloadPython}
            onDownloadYaml={handleDownloadYaml}
            onDownloadReqs={handleDownloadRequirements}
            onDownloadZip={handleDownloadZip}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="wiz-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wiz-dialog">
        <div className="wiz-header">
          <h2>✨ New Task / Job</h2>
          <button className="wiz-close" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div className="wiz-steps">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`wiz-step ${i === step ? 'wiz-step--active' : ''} ${i < step ? 'wiz-step--done' : ''}`}
              onClick={() => i < step && setStep(i)}
            >
              <span className="wiz-step-num">{i < step ? '✓' : i + 1}</span>
              <span className="wiz-step-label">{s.label}</span>
            </div>
          ))}
        </div>

        {validationError && <div className="wiz-error">{validationError}</div>}

        <div className="wiz-body">{renderStep()}</div>

        <div className="wiz-footer">
          {step > 0 && (
            <button className="toolbar-btn" onClick={prevStep}>
              ◀ Back
            </button>
          )}
          <div className="wiz-spacer" />
          {step < STEPS.length - 1 ? (
            <button className="toolbar-btn active" onClick={nextStep}>
              Next ▶
            </button>
          ) : (
            <button className="toolbar-btn active" onClick={handleCreate}>
              ✅ Add to Controller
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Step 1: Basic Info ── */

function StepBasic({ name, setName, mode, setMode, description, setDescription, taskPrefix, setTaskPrefix, moduleName }) {
  return (
    <div className="wiz-step-content">
      <div className="wiz-field">
        <label>Task Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my_task"
        />
        <span className="wiz-hint">
          Python identifier — letters, digits, underscores. Module: <code>{moduleName || '…'}</code>
        </span>
      </div>

      <div className="wiz-field">
        <label>Execution Mode</label>
        <div className="wiz-radio-group">
          <label className={`wiz-radio ${mode === 'continuous' ? 'active' : ''}`}>
            <input
              type="radio"
              name="mode"
              value="continuous"
              checked={mode === 'continuous'}
              onChange={() => setMode('continuous')}
            />
            🔄 Continuous
            <span className="wiz-radio-desc">Runs in a loop with cycle counter</span>
          </label>
          <label className={`wiz-radio ${mode === 'triggered' ? 'active' : ''}`}>
            <input
              type="radio"
              name="mode"
              value="triggered"
              checked={mode === 'triggered'}
              onChange={() => setMode('triggered')}
            />
            ⚡ Triggered
            <span className="wiz-radio-desc">Executes on RUN PV trigger</span>
          </label>
        </div>
      </div>

      <div className="wiz-field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Brief description of what this task does…"
        />
      </div>

      <div className="wiz-field">
        <label>PV Prefix <span className="wiz-optional">(optional)</span></label>
        <input
          type="text"
          value={taskPrefix}
          onChange={(e) => setTaskPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9_:-]/g, ''))}
          placeholder="CMM"
          style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}
        />
        <span className="wiz-hint">
          Override the PV segment: <code>{taskPrefix || name.toUpperCase() || 'TASK_NAME'}:{'{PV}'}</code>.{' '}
          Full name: <code>{'{CTRL_PREFIX}'}:{taskPrefix || name.toUpperCase() || 'TASK_NAME'}:{'{PV}'}</code>
        </span>
      </div>

      <div className="wiz-info">
        <h4>Built-in PVs (auto-created)</h4>
        <ul>
          <li><strong>ENABLE</strong> — Enable/disable task execution</li>
          <li><strong>STATUS</strong> — INIT / RUN / PAUSED / END / ERROR</li>
          <li><strong>MESSAGE</strong> — Status message string</li>
          {mode === 'continuous' ? (
            <li><strong>CYCLE_COUNT</strong> — Loop iteration counter</li>
          ) : (
            <li><strong>RUN</strong> — Trigger button for execution</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ── Step 2: Parameters ── */

function StepParameters({ parameters, setParameters }) {
  const addParam = () => {
    setParameters([...parameters, { key: '', value: '', type: 'float' }]);
  };

  const updateParam = (index, field, value) => {
    setParameters(parameters.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const removeParam = (index) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  return (
    <div className="wiz-step-content">
      <p className="wiz-desc">
        Parameters are configuration values passed to the task at startup (e.g., update_rate, thresholds).
      </p>

      {parameters.length === 0 && (
        <div className="wiz-empty">No parameters defined yet.</div>
      )}

      {parameters.map((p, i) => (
        <div key={i} className={`wiz-item-row ${p.type === 'list' ? 'wiz-item-row--list' : ''}`}>
          <input
            type="text"
            value={p.key}
            onChange={(e) => updateParam(i, 'key', e.target.value)}
            placeholder="parameter_name"
            className="wiz-item-name"
          />
          <select
            value={p.type}
            onChange={(e) => updateParam(i, 'type', e.target.value)}
            className="wiz-item-type"
          >
            <option value="float">float</option>
            <option value="int">int</option>
            <option value="string">string</option>
            <option value="bool">bool</option>
            <option value="list">list (array)</option>
          </select>
          {p.type === 'list' ? (
            <textarea
              value={p.value}
              onChange={(e) => updateParam(i, 'value', e.target.value)}
              placeholder={'One item per line, e.g.:\nGUNFLG01\nAC1FLG01\nAC2FLG01'}
              className="wiz-item-list"
              rows={4}
            />
          ) : (
            <input
              type="text"
              value={p.value}
              onChange={(e) => updateParam(i, 'value', e.target.value)}
              placeholder="default value"
              className="wiz-item-value"
            />
          )}
          <button className="wiz-item-remove" onClick={() => removeParam(i)}>
            ✕
          </button>
        </div>
      ))}

      <button className="toolbar-btn" onClick={addParam}>
        + Add Parameter
      </button>
    </div>
  );
}

/* ── Step 3 / 4: PV Definitions (Inputs or Outputs) ── */

function StepPvDefs({ items, setItems, label }) {
  const addItem = () => {
    setItems([...items, { name: '', type: 'float', desc: '', unit: '', default: 0 }]);
  };

  const updateItem = (index, field, value) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const removeItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    <div className="wiz-step-content">
      <p className="wiz-desc">
        {label === 'Input'
          ? 'Inputs are writable PVs — external systems can set values that your task reads.'
          : 'Outputs are read-only PVs — your task publishes values for external systems to monitor.'}
      </p>

      {items.length === 0 && (
        <div className="wiz-empty">No {label.toLowerCase()}s defined yet.</div>
      )}

      {items.map((item, i) => (
        <div key={i} className="wiz-pv-row">
          <div className="wiz-pv-row-top">
            <input
              type="text"
              value={item.name}
              onChange={(e) => updateItem(i, 'name', e.target.value.toUpperCase())}
              placeholder="PV_NAME"
              className="wiz-pv-name"
            />
            <select
              value={item.type}
              onChange={(e) => updateItem(i, 'type', e.target.value)}
              className="wiz-pv-type"
            >
              {PV_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={item.unit}
              onChange={(e) => updateItem(i, 'unit', e.target.value)}
              placeholder="unit"
              className="wiz-pv-unit"
            />
            <input
              type="text"
              value={item.default ?? ''}
              onChange={(e) => updateItem(i, 'default', e.target.value)}
              placeholder="default"
              className="wiz-pv-default"
            />
            <button className="wiz-item-remove" onClick={() => removeItem(i)}>
              ✕
            </button>
          </div>
          <input
            type="text"
            value={item.desc}
            onChange={(e) => updateItem(i, 'desc', e.target.value)}
            placeholder="Description…"
            className="wiz-pv-desc"
          />
        </div>
      ))}

      <button className="toolbar-btn" onClick={addItem}>
        + Add {label}
      </button>
    </div>
  );
}

/* ── Step 5: Preview & Save ── */

function StepPreview({ taskDef, prefix, controllerApiUrl, defaultGitUrl, gitUrl, setGitUrl, gitBranch, setGitBranch, gitPat, setGitPat, projectPath: liftedPath, setProjectPath: setLiftedPath, onDownloadPython, onDownloadYaml, onDownloadReqs, onDownloadZip }) {
  const [activeTab, setActiveTab] = useState('python');
  const defaultPath = `${DEFAULT_TASK_PATH}/${taskDef.module || taskDef.name || 'my_task'}`;
  const projectPath = liftedPath || defaultPath;
  const setProjectPath = (v) => setLiftedPath(v);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [gitCommitStatus, setGitCommitStatus] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [registerArgo, setRegisterArgo] = useState(true);
  const gitStatusRef = useRef(null);

  const pythonCode = generateTaskPython(taskDef);
  const yamlConfig = generateFullConfigYaml(taskDef, prefix);
  const reqs = generateRequirementsTxt();
  const startSh = generateStartSh(taskDef.module || taskDef.name || 'task');

  const handleDownloadProjectZip = () => onDownloadZip(projectPath);
  const handleDownloadFlatZip = () => onDownloadZip(null);

  const scrollToStatus = () => {
    setTimeout(() => {
      gitStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const handleAddToRepo = async () => {
    if (!gitUrl.trim()) { setGitCommitStatus('❌ Git URL is required'); scrollToStatus(); return; }
    if (!gitPat.trim()) { setGitCommitStatus('❌ PAT is required to push files'); scrollToStatus(); return; }
    const repoInfo = parseGitUrl(gitUrl.trim());
    if (!repoInfo) { setGitCommitStatus('❌ Could not parse Git URL — use https://host/org/repo.git or git@host:org/repo.git'); scrollToStatus(); return; }

    const dir = projectPath.replace(/\/+$/, '');
    const moduleName = taskDef.module || taskDef.name || 'task';
    const files = [
      { path: `${dir}/${moduleName}.py`, content: pythonCode },
      { path: `${dir}/config.yaml`, content: yamlConfig },
      { path: `${dir}/requirements.txt`, content: reqs },
      { path: `${dir}/start.sh`, content: startSh },
    ];

    setCommitting(true);
    setGitCommitStatus(`⏳ Committing ${files.length} files to ${repoInfo.projectPath}…`);
    scrollToStatus();
    try {
      // Step 1: Commit task files (Python, config.yaml, requirements.txt, start.sh)
      const result = await commitFiles(repoInfo, files, gitBranch || 'main', `Add soft IOC task ${taskDef.name}`, gitPat.trim());

      // Step 2: Register as ArgoCD application in values-softiocs.yaml
      if (registerArgo) {
        setGitCommitStatus('⏳ Registering soft IOC in ArgoCD values…');
        scrollToStatus();

        // Read existing values-softiocs.yaml (or start fresh)
        let existingYaml = '';
        try {
          const existing = await getFile(repoInfo, SOFTIOC_VALUES_PATH, gitBranch || 'main', gitPat.trim());
          existingYaml = existing.content;
        } catch {
          // File doesn't exist yet — will create
        }

        const entry = generateSoftIocEntry(taskDef, dir, prefix);
        const newYaml = mergeSoftIocValues(existingYaml, entry);

        await commitFile(
          repoInfo,
          SOFTIOC_VALUES_PATH,
          gitBranch || 'main',
          newYaml,
          `Register soft IOC "${taskDef.name}" in ArgoCD values`,
          gitPat.trim(),
        );
      }

      const commitId = result?.id?.substring(0, 8) || result?.content?.sha?.substring(0, 8) || '';
      setGitCommitStatus(
        `✅ Committed ${files.length} files to ${dir}/` +
        (commitId ? ` (${commitId})` : '') +
        (registerArgo ? ' — registered as ArgoCD soft IOC application' : ''),
      );
    } catch (e) {
      console.error('[Add to Beamline Repo]', e);
      const msg = e.message || String(e);
      if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('CORS')) {
        setGitCommitStatus('❌ Network error — the Git server may block browser requests (CORS). Try using the Download ZIP option instead, or check that your PAT is valid.');
      } else {
        setGitCommitStatus(`❌ ${msg}`);
      }
    } finally {
      setCommitting(false);
      scrollToStatus();
    }
  };

  return (
    <div className="wiz-step-content">
      <div className="wiz-preview-tabs">
        <button
          className={`wiz-tab ${activeTab === 'python' ? 'active' : ''}`}
          onClick={() => setActiveTab('python')}
        >
          🐍 Python
        </button>
        <button
          className={`wiz-tab ${activeTab === 'yaml' ? 'active' : ''}`}
          onClick={() => setActiveTab('yaml')}
        >
          📄 config.yaml
        </button>
        <button
          className={`wiz-tab ${activeTab === 'reqs' ? 'active' : ''}`}
          onClick={() => setActiveTab('reqs')}
        >
          📦 requirements.txt
        </button>
        <button
          className={`wiz-tab ${activeTab === 'startsh' ? 'active' : ''}`}
          onClick={() => setActiveTab('startsh')}
        >
          🚀 start.sh
        </button>
      </div>

      <pre className="wiz-code">
        {activeTab === 'python' && pythonCode}
        {activeTab === 'yaml' && yamlConfig}
        {activeTab === 'reqs' && reqs}
        {activeTab === 'startsh' && startSh}
      </pre>

      {/* Download section */}
      <div className="wiz-section-header">📥 Download</div>
      <div className="wiz-download-bar">
        <button className="toolbar-btn" onClick={onDownloadPython}>
          🐍 {taskDef.module || 'task'}.py
        </button>
        <button className="toolbar-btn" onClick={onDownloadYaml}>
          📄 config.yaml
        </button>
        <button className="toolbar-btn" onClick={onDownloadReqs}>
          📦 requirements.txt
        </button>
        <button className="toolbar-btn active" onClick={handleDownloadFlatZip}>
          📦 Download ZIP
        </button>
      </div>

      {/* Save to Beamline Repo & ArgoCD section */}
      <div className="wiz-section-header">📂 Save to Beamline Repo &amp; Deploy via ArgoCD</div>
      <div className="wiz-project-panel">
        <div className="wiz-field">
          <label>Directory in repo</label>
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder={`${DEFAULT_TASK_PATH}/${taskDef.module || 'my_task'}`}
          />
          <span className="wiz-hint">
            Files: <code>{projectPath}/{taskDef.module || 'task'}.py</code>, <code>config.yaml</code>, <code>requirements.txt</code>, <code>start.sh</code>
          </span>
        </div>

        <button className="toolbar-btn active" onClick={handleDownloadProjectZip}>
          📦 Download Project ZIP
        </button>

        <div className="wiz-git-toggle">
          <button
            className={`toolbar-btn ${showGitPanel ? 'active' : ''}`}
            onClick={() => setShowGitPanel((s) => !s)}
          >
            🔗 Git Repository
          </button>
        </div>

        {showGitPanel && (
          <div className="wiz-git-panel">
            <div className="wiz-field">
              <label>Git URL</label>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://gitlab.infn.it/org/beamline-project.git"
              />
            </div>
            <div className="wiz-git-row">
              <div className="wiz-field" style={{ flex: 1 }}>
                <label>Branch</label>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
              <div className="wiz-field" style={{ flex: 1 }}>
                <label>PAT</label>
                <input
                  type="password"
                  value={gitPat}
                  onChange={(e) => setGitPat(e.target.value)}
                  placeholder="glpat-xxxx…"
                />
              </div>
            </div>

            {/* ArgoCD registration toggle */}
            <label className="wiz-checkbox-row">
              <input
                type="checkbox"
                checked={registerArgo}
                onChange={(e) => setRegisterArgo(e.target.checked)}
              />
              <span>Register as ArgoCD soft IOC application</span>
              <span className="wiz-hint" style={{ marginLeft: 8 }}>
                Updates <code>{SOFTIOC_VALUES_PATH}</code> — creates an ArgoCD Application that deploys this task as a standalone pod
              </span>
            </label>

            <div className="wiz-download-bar">
              <button className="toolbar-btn active" onClick={handleAddToRepo} disabled={!gitUrl || !gitPat || committing}>
                {committing ? '⏳ Committing…' : registerArgo ? '🚀 Add to Repo & Register ArgoCD App' : '📂 Add to Beamline Repo'}
              </button>
            </div>

            <div ref={gitStatusRef}>
              {gitCommitStatus && (
                <div className={`wiz-git-status ${gitCommitStatus.startsWith('✅') ? 'wiz-git-status--ok' : gitCommitStatus.startsWith('❌') ? 'wiz-git-status--err' : 'wiz-git-status--busy'}`}>
                  {gitCommitStatus}
                </div>
              )}
            </div>

            {/* Deploy to controller (hot-load into running instance) */}
            {controllerApiUrl && gitUrl && (
              <div className="wiz-deploy-section">
                <div className="wiz-section-header">🔄 Hot-deploy to Running Controller</div>
                <span className="wiz-hint">Load this task into the currently running beamline controller (does not create a standalone pod).</span>
                <button
                  className="toolbar-btn"
                  onClick={async () => {
                    setDeployStatus('⏳ Deploying...');
                    try {
                      const result = await deployPlugin(controllerApiUrl, {
                        name: taskDef.module,
                        git_url: gitUrl,
                        path: projectPath,
                        pat: gitPat || undefined,
                        branch: gitBranch || 'main',
                      });
                      setDeployStatus(`✅ ${result.message || 'Deployed'}`);
                    } catch (e) {
                      setDeployStatus(`❌ ${e.message}`);
                    }
                  }}
                >
                  🔄 Hot-deploy to Controller
                </button>
                {deployStatus && <div className={`bc-status-msg ${deployStatus.startsWith('✅') ? 'bc-status--ok' : deployStatus.startsWith('❌') ? 'bc-status--error' : ''}`}>{deployStatus}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="wiz-info">
        <h4>How it works</h4>
        <ol>
          <li><strong>Add to Repo &amp; Register ArgoCD App</strong> — commits task files + a <code>start.sh</code> launcher to the beamline git repo, then updates <code>{SOFTIOC_VALUES_PATH}</code> to register the soft IOC as an ArgoCD Application</li>
          <li>ArgoCD detects the change and automatically deploys a new pod running your task via <code>iocmng-server</code></li>
          <li>The pod clones the task code from git, installs dependencies, and starts the soft IOC</li>
          <li>PVs will be available as <code>{prefix}:{(taskDef.name || 'TASK').toUpperCase()}:*</code></li>
        </ol>
        <p className="wiz-hint">Use <strong>🔄 Hot-deploy</strong> to load the task into an existing controller without creating a separate pod.</p>
      </div>
    </div>
  );
}
