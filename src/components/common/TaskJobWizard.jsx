/**
 * TaskJobWizard — Step-by-step wizard to create a new beamline controller task.
 *
 * Steps:
 *   1. Basic info — name, mode, description, module
 *   2. Parameters — key-value pairs with types
 *   3. Inputs — PV definitions (name, type, desc, unit)
 *   4. Outputs — PV definitions (name, type, desc, unit)
 *   5. Preview & Download — YAML config + Python skeleton
 */
import { useState, useCallback, useRef } from 'react';
import {
  PV_TYPE_MAP,
  generateTaskPython,
  generateTaskYaml,
  generateFullConfigYaml,
  generateRequirementsTxt,
  generateTaskZip,
  getDefaultTaskPath,
  DEFAULT_TASK_PATH,
  deployPlugin,
} from '../../services/beamlineControllerApi.js';

const STEPS = [
  { key: 'basic', label: '1. Basic Info' },
  { key: 'params', label: '2. Parameters' },
  { key: 'inputs', label: '3. Inputs' },
  { key: 'outputs', label: '4. Outputs' },
  { key: 'preview', label: '5. Preview & Download' },
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
    onCreated?.(taskDef);
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

/* ── Step 5: Preview & Download ── */

function StepPreview({ taskDef, prefix, controllerApiUrl, onDownloadPython, onDownloadYaml, onDownloadReqs, onDownloadZip }) {
  const [activeTab, setActiveTab] = useState('python');
  const [projectPath, setProjectPath] = useState(DEFAULT_TASK_PATH);
  const [gitUrl, setGitUrl] = useState(defaultGitUrl || '');
  const [gitBranch, setGitBranch] = useState('main');
  const [gitPat, setGitPat] = useState('');
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);

  const pythonCode = generateTaskPython(taskDef);
  const yamlConfig = generateFullConfigYaml(taskDef, prefix);
  const reqs = generateRequirementsTxt();
  const taskPath = `${projectPath}/${taskDef.module}`;

  const handleDownloadProjectZip = () => onDownloadZip(projectPath);
  const handleDownloadFlatZip = () => onDownloadZip(null);

  // Build a git clone + copy command for the user
  const gitCloneCmd = gitUrl
    ? `git clone${gitBranch !== 'main' ? ` -b ${gitBranch}` : ''} ${gitUrl} beamline-project\nmkdir -p beamline-project/${taskPath}\ncp ${taskDef.module}.py config.yaml requirements.txt beamline-project/${taskPath}/\ncd beamline-project && git add . && git commit -m "Add task ${taskDef.name}" && git push`
    : '';

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
      </div>

      <pre className="wiz-code">
        {activeTab === 'python' && pythonCode}
        {activeTab === 'yaml' && yamlConfig}
        {activeTab === 'reqs' && reqs}
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

      {/* Project integration section */}
      <div className="wiz-section-header">📂 Project Integration</div>
      <div className="wiz-project-panel">
        <div className="wiz-field">
          <label>Project Path</label>
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder={DEFAULT_TASK_PATH}
          />
          <span className="wiz-hint">
            Files will be placed in <code>{taskPath}/</code>
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
                placeholder="https://github.com/org/beamline-project.git"
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
                <label>Task Name</label>
                <input type="text" value={taskDef.name} disabled />
              </div>
              <div className="wiz-field" style={{ flex: 1 }}>
                <label>PAT (optional)</label>
                <input
                  type="password"
                  value={gitPat}
                  onChange={(e) => setGitPat(e.target.value)}
                  placeholder="ghp_xxxx…"
                />
              </div>
            </div>

            {gitUrl && (
              <div className="wiz-git-cmd">
                <label>Quick-start commands:</label>
                <pre className="wiz-code wiz-code--small">{gitCloneCmd}</pre>
              </div>
            )}

            <div className="wiz-download-bar">
              <button className="toolbar-btn active" onClick={handleDownloadProjectZip}>
                📦 Download ZIP (project structure)
              </button>
            </div>

            {/* Deploy to controller */}
            {controllerApiUrl && gitUrl && (
              <div className="wiz-deploy-section">
                <div className="wiz-section-header">🚀 Deploy to Controller</div>
                <button
                  className="toolbar-btn active"
                  onClick={async () => {
                    setDeployStatus('⏳ Deploying...');
                    try {
                      const result = await deployPlugin(controllerApiUrl, {
                        name: taskDef.module,
                        git_url: gitUrl,
                        path: `${projectPath}/${taskDef.module}`,
                        pat: gitPat || undefined,
                        branch: gitBranch || 'main',
                      });
                      setDeployStatus(`✅ ${result.message || 'Deployed'}`);
                    } catch (e) {
                      setDeployStatus(`❌ ${e.message}`);
                    }
                  }}
                >
                  🚀 Deploy
                </button>
                {deployStatus && <div className={`bc-status-msg ${deployStatus.startsWith('✅') ? 'bc-status--ok' : deployStatus.startsWith('❌') ? 'bc-status--error' : ''}`}>{deployStatus}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="wiz-info">
        <h4>How to use</h4>
        <ol>
          <li>Download the <strong>Project ZIP</strong> — files are pre-structured in <code>{taskPath}/</code></li>
          <li>Extract into your beamline project git repository</li>
          <li>Merge the task entry from <code>config.yaml</code> into the controller's main <code>controller-config.yaml</code></li>
          <li>Commit, push, and restart the beamline controller</li>
          <li>PVs will be available as <code>{prefix}:{(taskDef.name || 'TASK').toUpperCase()}:*</code></li>
        </ol>
      </div>
    </div>
  );
}
