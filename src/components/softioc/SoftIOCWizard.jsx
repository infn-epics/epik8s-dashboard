/**
 * SoftIOCWizard — Step-by-step builder for declarative softioc configs.
 *
 * Steps:
 *  1. Template — choose task type (declarative, custom, interlock, motor-interlock)
 *  2. Basic Info — name, description, mode, prefix, parameters
 *  3. Inputs — wired inputs with optional link PVs
 *  4. Outputs — outputs with optional link PVs
 *  5. Rules — condition-based rules with actuators (declarative templates)
 *  6. Preview — YAML config + optional Python skeleton + download
 */
import { useState, useCallback, useMemo } from 'react';
import {
  TASK_TEMPLATES,
  TASK_MODES,
  PV_TYPES,
  SAFE_FUNCTIONS,
  groupedFunctions,
  generateConfigYaml,
  generateTaskPython,
  generateTaskZip,
  validateTaskDef,
} from '../../services/softiocApi.js';
import { useSoftIOC } from '../../context/SoftIOCContext.jsx';

const STEPS_DECLARATIVE = [
  { key: 'template', label: '1. Template' },
  { key: 'basic', label: '2. Basic Info' },
  { key: 'inputs', label: '3. Inputs' },
  { key: 'outputs', label: '4. Outputs' },
  { key: 'transforms', label: '5. Transforms' },
  { key: 'rules', label: '6. Rules' },
  { key: 'preview', label: '7. Preview' },
];

const STEPS_CUSTOM = [
  { key: 'template', label: '1. Template' },
  { key: 'basic', label: '2. Basic Info' },
  { key: 'inputs', label: '3. Inputs' },
  { key: 'outputs', label: '4. Outputs' },
  { key: 'preview', label: '5. Preview' },
];

/**
 * Collapsible function reference panel for rule conditions and transform expressions.
 */
function FunctionReference({ contextVars }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupedFunctions(), []);

  return (
    <div className={`sioc-fn-ref ${open ? 'open' : ''}`}>
      <button className="sioc-fn-ref-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Available functions &amp; variables
      </button>
      {open && (
        <div className="sioc-fn-ref-body">
          {/* Context variables */}
          {contextVars.length > 0 && (
            <div className="sioc-fn-ref-group">
              <h5>Variables (from inputs/outputs)</h5>
              <div className="sioc-fn-ref-vars">
                {contextVars.map((v) => (
                  <span key={v.name} className={`sioc-fn-var sioc-fn-var--${v.source}`}
                    title={`${v.source} — ${v.type}`}>
                    {v.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Function groups */}
          {Object.entries(groups).map(([cat, fns]) => (
            <div key={cat} className="sioc-fn-ref-group">
              <h5>{cat}</h5>
              <div className="sioc-fn-ref-list">
                {fns.map((fn) => (
                  <div key={fn.name} className="sioc-fn-item" title={fn.description}>
                    <code>{fn.signature}</code>
                    <span className="sioc-fn-desc">{fn.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="sioc-fn-ref-group">
            <h5>Operators</h5>
            <p className="sioc-dim" style={{ margin: '4px 0' }}>
              <code>== != &lt; &gt; &lt;= &gt;= and or not + - * / % if/else</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SoftIOCWizard({ onClose, onCreated, editingTask }) {
  const { addSoftioc } = useSoftIOC();

  // Template selection
  const [templateId, setTemplateId] = useState(editingTask?.template || null);
  const template = TASK_TEMPLATES.find((t) => t.id === templateId);

  // Step tracking
  const [step, setStep] = useState(editingTask ? 1 : 0);

  // Basic info
  const [name, setName] = useState(editingTask?.name || '');
  const [description, setDescription] = useState(editingTask?.description || '');
  const [mode, setMode] = useState(editingTask?.mode || 'continuous');
  const [iocprefix, setIocprefix] = useState(editingTask?.iocprefix || '');
  const [interval, setInterval] = useState(editingTask?.parameters?.interval ?? 1.0);
  const [timeout, setTimeout_] = useState(editingTask?.parameters?.timeout ?? 2.0);
  const [usePva, setUsePva] = useState(editingTask?.parameters?.pva ?? false);

  // Inputs
  const [inputs, setInputs] = useState(() => {
    if (editingTask?.inputs) {
      return Object.entries(editingTask.inputs).map(([k, v]) => ({
        name: k, type: v.type || 'float', value: v.value ?? 0,
        link: v.link || '', trigger: v.trigger || false, unit: v.unit || '',
      }));
    }
    return [];
  });

  // Outputs
  const [outputs, setOutputs] = useState(() => {
    if (editingTask?.outputs) {
      return Object.entries(editingTask.outputs).map(([k, v]) => ({
        name: k, type: v.type || 'float', value: v.value ?? 0,
        link: v.link || '', unit: v.unit || '',
        znam: v.znam || '', onam: v.onam || '',
      }));
    }
    return [];
  });

  // Transforms (declarative only)
  const [transforms, setTransforms] = useState(() => {
    if (editingTask?.transforms) {
      return editingTask.transforms.map((t) => ({ ...t }));
    }
    return [];
  });

  // Rules
  const [rules, setRules] = useState(() => {
    if (editingTask?.rules) {
      return editingTask.rules.map((r) => ({ ...r }));
    }
    return [];
  });

  // Rule defaults
  const [ruleDefaults, setRuleDefaults] = useState(() => {
    return editingTask?.rule_defaults || {};
  });

  // Git config
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [gitPath, setGitPath] = useState('');

  // Errors
  const [error, setError] = useState('');

  const steps = template?.supportsRules ? STEPS_DECLARATIVE : STEPS_CUSTOM;

  const moduleName = useMemo(
    () => name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    [name]
  );

  // Apply template presets when selected
  const selectTemplate = useCallback((id) => {
    setTemplateId(id);
    const tmpl = TASK_TEMPLATES.find((t) => t.id === id);
    if (tmpl?.defaultMode) setMode(tmpl.defaultMode);
    if (tmpl?.presets) {
      if (tmpl.presets.outputs) {
        setOutputs(
          Object.entries(tmpl.presets.outputs).map(([k, v]) => ({
            name: k, type: v.type || 'float', value: v.value ?? 0,
            link: v.link || '', unit: v.unit || '',
            znam: v.znam || '', onam: v.onam || '',
          }))
        );
      }
      if (tmpl.presets.rule_defaults) {
        setRuleDefaults(tmpl.presets.rule_defaults);
      }
    }
    setStep(1);
  }, []);

  // Validation
  const validateStep = useCallback(() => {
    setError('');
    if (step === 1) {
      if (!name.trim()) { setError('Task name is required'); return false; }
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name.trim())) {
        setError('Name must start with a letter — letters, digits, hyphens, underscores only');
        return false;
      }
    }
    if (steps[step]?.key === 'inputs') {
      for (const inp of inputs) {
        if (!inp.name.trim()) { setError('All inputs must have a name'); return false; }
      }
    }
    if (steps[step]?.key === 'outputs') {
      for (const out of outputs) {
        if (!out.name.trim()) { setError('All outputs must have a name'); return false; }
      }
    }
    if (steps[step]?.key === 'rules') {
      for (const rule of rules) {
        if (!rule.id?.trim()) { setError('All rules must have an ID'); return false; }
        if (!rule.condition?.trim()) { setError(`Rule "${rule.id}": condition required`); return false; }
      }
    }
    return true;
  }, [step, steps, name, inputs, outputs, rules]);

  const next = useCallback(() => {
    if (validateStep()) setStep((s) => Math.min(s + 1, steps.length - 1));
  }, [validateStep, steps]);

  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // Build task definition
  const buildTaskDef = useCallback(() => {
    const inputsObj = {};
    for (const inp of inputs) {
      inputsObj[inp.name] = {
        type: inp.type, value: inp.value,
        ...(inp.link ? { link: inp.link } : {}),
        ...(inp.trigger ? { trigger: true } : {}),
        ...(inp.unit ? { unit: inp.unit } : {}),
        ...(inp.bufferSize ? { buffer_size: inp.bufferSize } : {}),
      };
    }
    const outputsObj = {};
    for (const out of outputs) {
      outputsObj[out.name] = {
        type: out.type, value: out.value,
        ...(out.link ? { link: out.link } : {}),
        ...(out.unit ? { unit: out.unit } : {}),
        ...(out.znam ? { znam: out.znam } : {}),
        ...(out.onam ? { onam: out.onam } : {}),
      };
    }
    return {
      name: moduleName,
      module: moduleName,
      description,
      mode,
      iocprefix,
      template: templateId,
      requiresPython: template?.requiresPython ?? false,
      parameters: { mode, interval: parseFloat(interval), timeout: parseFloat(timeout), pva: usePva },
      inputs: inputsObj,
      outputs: outputsObj,
      rules,
      rule_defaults: ruleDefaults,
      transforms,
    };
  }, [moduleName, description, mode, iocprefix, templateId, template, interval, timeout, usePva, inputs, outputs, rules, ruleDefaults, transforms]);

  // Save/create
  const handleSave = useCallback(() => {
    const taskDef = buildTaskDef();
    const { valid, errors } = validateTaskDef(taskDef);
    if (!valid) { setError(errors.join('; ')); return; }

    const gitConfig = gitUrl ? { url: gitUrl, branch: gitBranch, path: gitPath || `config/iocs/${moduleName}` } : {};
    addSoftioc(taskDef, gitConfig);
    onCreated?.(taskDef);
    onClose?.();
  }, [buildTaskDef, addSoftioc, onCreated, onClose, gitUrl, gitBranch, gitPath, moduleName]);

  // Download ZIP
  const handleDownload = useCallback(async () => {
    const taskDef = buildTaskDef();
    const blob = await generateTaskZip(taskDef);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${moduleName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildTaskDef, moduleName]);

  // ── Render ──

  const renderTemplateStep = () => (
    <div className="sioc-wizard-templates">
      <h3>Choose a template</h3>
      <div className="sioc-template-grid">
        {TASK_TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.id}
            className={`sioc-template-card ${templateId === tmpl.id ? 'selected' : ''}`}
            onClick={() => selectTemplate(tmpl.id)}
          >
            <span className="sioc-template-icon">{tmpl.icon}</span>
            <strong>{tmpl.label}</strong>
            <p>{tmpl.description}</p>
          </button>
        ))}
      </div>
    </div>
  );

  const renderBasicStep = () => (
    <div className="sioc-wizard-basic">
      <h3>Basic Information</h3>
      <div className="sioc-form-grid">
        <label>
          Task Name *
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="my_task" />
        </label>
        <label>
          IOC Prefix (PV prefix)
          <input type="text" value={iocprefix} onChange={(e) => setIocprefix(e.target.value)}
            placeholder="SPARC:MY_TASK" />
        </label>
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {TASK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          Interval (s)
          <input type="number" value={interval} step="0.1" min="0.1"
            onChange={(e) => setInterval(e.target.value)} />
        </label>
        <label>
          Timeout (s)
          <input type="number" value={timeout} step="0.1" min="0.5"
            onChange={(e) => setTimeout_(e.target.value)} />
        </label>
        <label className="sioc-checkbox">
          <input type="checkbox" checked={usePva} onChange={(e) => setUsePva(e.target.checked)} />
          PVA protocol
        </label>
        <label className="sioc-full-width">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of this task" rows={2} />
        </label>
      </div>
    </div>
  );

  const renderPvSection = (items, setItems, direction) => {
    const isInput = direction === 'input';
    return (
      <div className="sioc-wizard-pvs">
        <div className="sioc-pv-header">
          <h3>{isInput ? 'Inputs' : 'Outputs'}</h3>
          <button className="btn btn-sm btn-accent" onClick={() => {
            setItems([...items, {
              name: '', type: 'float', value: 0, link: '', trigger: false, unit: '',
              znam: '', onam: '',
            }]);
          }}>+ Add {isInput ? 'Input' : 'Output'}</button>
        </div>
        {items.length === 0 && <p className="sioc-empty">No {isInput ? 'inputs' : 'outputs'} defined yet.</p>}
        {items.map((item, idx) => (
          <div key={idx} className="sioc-pv-row">
            <input type="text" value={item.name} placeholder="PV_NAME"
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') };
                setItems(next);
              }} />
            <select value={item.type} onChange={(e) => {
              const next = [...items];
              next[idx] = { ...next[idx], type: e.target.value };
              setItems(next);
            }}>
              {PV_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="text" value={item.value} placeholder="default"
              className="sioc-pv-value"
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], value: e.target.value };
                setItems(next);
              }} />
            <input type="text" value={item.link} placeholder="Linked PV (external)"
              className="sioc-pv-link"
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...next[idx], link: e.target.value };
                setItems(next);
              }} />
            {isInput && (
              <label className="sioc-checkbox sioc-trigger-check" title="Trigger on change">
                <input type="checkbox" checked={item.trigger}
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], trigger: e.target.checked };
                    setItems(next);
                  }} /> trig
              </label>
            )}
            {isInput && template?.supportsTransforms && (
              <input type="number" value={item.bufferSize || ''} placeholder="buf"
                className="sioc-pv-buffer" title="Ring buffer size → exposes NAME_buf for transforms"
                min="0" step="1"
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], bufferSize: e.target.value ? parseInt(e.target.value, 10) : 0 };
                  setItems(next);
                }} />
            )}
            {item.type === 'bool' && (
              <>
                <input type="text" value={item.znam} placeholder="Off label"
                  className="sioc-pv-label"
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], znam: e.target.value };
                    setItems(next);
                  }} />
                <input type="text" value={item.onam} placeholder="On label"
                  className="sioc-pv-label"
                  onChange={(e) => {
                    const next = [...items];
                    next[idx] = { ...next[idx], onam: e.target.value };
                    setItems(next);
                  }} />
              </>
            )}
            <button className="btn btn-sm btn-danger" onClick={() => {
              setItems(items.filter((_, i) => i !== idx));
            }}>✕</button>
          </div>
        ))}
      </div>
    );
  };

  const renderRulesStep = () => {
    // Build context variables from inputs/outputs/parameters
    const contextVars = [
      ...inputs.map((i) => ({ name: i.name, source: 'input', type: i.type })),
      ...outputs.map((o) => ({ name: o.name, source: 'output', type: o.type })),
      ...inputs.filter((i) => i.bufferSize).map((i) => ({ name: `${i.name}_buf`, source: 'buffer', type: 'array' })),
    ];

    return (
    <div className="sioc-wizard-rules">
      <div className="sioc-pv-header">
        <h3>Rules</h3>
        <button className="btn btn-sm btn-accent" onClick={() => {
          setRules([...rules, { id: '', condition: '', message: '', message_pv: 'MESSAGE', outputs: {}, actuators: {} }]);
        }}>+ Add Rule</button>
      </div>

      {/* Context help */}
      <FunctionReference contextVars={contextVars} />

      <p className="sioc-dim">
        Rules are evaluated each cycle after transforms. When a condition is true,
        its outputs are set and actuators write to linked external PVs.
      </p>
      {rules.length === 0 && <p className="sioc-empty">No rules defined. Rules evaluate conditions and fire actuators.</p>}
      {rules.map((rule, idx) => (
        <div key={idx} className="sioc-rule-card">
          <div className="sioc-rule-header">
            <input type="text" value={rule.id} placeholder="RULE_ID"
              onChange={(e) => {
                const next = [...rules];
                next[idx] = { ...next[idx], id: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') };
                setRules(next);
              }} />
            <button className="btn btn-sm btn-danger" onClick={() => setRules(rules.filter((_, i) => i !== idx))}>✕</button>
          </div>
          <label>
            Condition
            <textarea value={rule.condition} rows={2} placeholder="llrf1 == 0 and klyloop1 == 1"
              onChange={(e) => {
                const next = [...rules];
                next[idx] = { ...next[idx], condition: e.target.value };
                setRules(next);
              }} />
          </label>
          <label>
            Message
            <input type="text" value={rule.message} placeholder="Description when rule fires"
              onChange={(e) => {
                const next = [...rules];
                next[idx] = { ...next[idx], message: e.target.value };
                setRules(next);
              }} />
          </label>
          <div className="sioc-rule-kv-section">
            <div className="sioc-rule-kv">
              <strong>Outputs</strong>
              {Object.entries(rule.outputs || {}).map(([k, v], ki) => (
                <div key={ki} className="sioc-kv-row">
                  <input type="text" value={k} readOnly className="sioc-kv-key" />
                  <input type="text" value={v}
                    onChange={(e) => {
                      const next = [...rules];
                      const outs = { ...next[idx].outputs };
                      outs[k] = isNaN(e.target.value) ? e.target.value : Number(e.target.value);
                      next[idx] = { ...next[idx], outputs: outs };
                      setRules(next);
                    }} />
                </div>
              ))}
              <button className="btn btn-xs btn-ghost" onClick={() => {
                const key = prompt('Output PV name (must match a defined output):');
                if (!key) return;
                const val = prompt('Value when rule fires:', '0');
                const next = [...rules];
                next[idx] = { ...next[idx], outputs: { ...next[idx].outputs, [key]: isNaN(val) ? val : Number(val) } };
                setRules(next);
              }}>+ output</button>
            </div>
            <div className="sioc-rule-kv">
              <strong>Actuators</strong>
              {Object.entries(rule.actuators || {}).map(([k, v], ki) => (
                <div key={ki} className="sioc-kv-row">
                  <input type="text" value={k} readOnly className="sioc-kv-key" />
                  <input type="text" value={v}
                    onChange={(e) => {
                      const next = [...rules];
                      const acts = { ...next[idx].actuators };
                      acts[k] = isNaN(e.target.value) ? e.target.value : Number(e.target.value);
                      next[idx] = { ...next[idx], actuators: acts };
                      setRules(next);
                    }} />
                </div>
              ))}
              <button className="btn btn-xs btn-ghost" onClick={() => {
                const key = prompt('Input/output PV name to actuate:');
                if (!key) return;
                const val = prompt('Value to write:', '0');
                const next = [...rules];
                next[idx] = { ...next[idx], actuators: { ...next[idx].actuators, [key]: isNaN(val) ? val : Number(val) } };
                setRules(next);
              }}>+ actuator</button>
            </div>
          </div>
        </div>
      ))}

      {Object.keys(ruleDefaults).length > 0 && (
        <div className="sioc-rule-defaults">
          <strong>Rule Defaults</strong>
          <p className="sioc-dim">Applied before rule evaluation each cycle:</p>
          {Object.entries(ruleDefaults).map(([k, v]) => (
            <span key={k} className="sioc-default-tag">{k} = {String(v)}</span>
          ))}
        </div>
      )}
    </div>
  );
  };

  const renderTransformsStep = () => {
    const contextVars = [
      ...inputs.map((i) => ({ name: i.name, source: 'input', type: i.type })),
      ...outputs.map((o) => ({ name: o.name, source: 'output', type: o.type })),
      ...inputs.filter((i) => i.bufferSize).map((i) => ({ name: `${i.name}_buf`, source: 'buffer', type: 'array' })),
    ];

    return (
      <div className="sioc-wizard-transforms">
        <div className="sioc-pv-header">
          <h3>Transforms</h3>
          <button className="btn btn-sm btn-accent" onClick={() => {
            setTransforms([...transforms, { output: '', expression: '' }]);
          }}>+ Add Transform</button>
        </div>

        <FunctionReference contextVars={contextVars} />

        <p className="sioc-dim">
          Transforms compute derived values each cycle <em>before</em> rules.
          Each transform writes its result to an output PV. Later transforms can
          reference earlier transforms&apos; outputs.
        </p>

        {transforms.length === 0 && (
          <p className="sioc-empty">
            No transforms defined. Add one to compute values from inputs using built-in functions.
          </p>
        )}
        {transforms.map((t, idx) => (
          <div key={idx} className="sioc-transform-card">
            <div className="sioc-transform-row">
              <label>
                Output PV
                <select value={t.output} onChange={(e) => {
                  const next = [...transforms];
                  next[idx] = { ...next[idx], output: e.target.value };
                  setTransforms(next);
                }}>
                  <option value="">— select output —</option>
                  {outputs.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                </select>
              </label>
              <label className="sioc-full-width">
                Expression
                <input type="text" value={t.expression}
                  placeholder='e.g. mean(TEMP_buf) or clamp(VAL * 2, 0, 100)'
                  onChange={(e) => {
                    const next = [...transforms];
                    next[idx] = { ...next[idx], expression: e.target.value };
                    setTransforms(next);
                  }} />
              </label>
              <button className="btn btn-sm btn-danger" onClick={() => {
                setTransforms(transforms.filter((_, i) => i !== idx));
              }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPreviewStep = () => {
    const taskDef = buildTaskDef();
    const configYaml = generateConfigYaml(taskDef);
    const pythonCode = template?.requiresPython ? generateTaskPython(taskDef) : null;
    const { valid, errors: validErrors } = validateTaskDef(taskDef);

    return (
      <div className="sioc-wizard-preview">
        <h3>Preview & Save</h3>

        {!valid && (
          <div className="sioc-validation-errors">
            {validErrors.map((e, i) => <p key={i}>⚠ {e}</p>)}
          </div>
        )}

        <div className="sioc-preview-files">
          <div className="sioc-preview-file">
            <h4>config.yaml</h4>
            <pre>{configYaml}</pre>
          </div>
          {pythonCode && (
            <div className="sioc-preview-file">
              <h4>{moduleName}.py</h4>
              <pre>{pythonCode}</pre>
            </div>
          )}
        </div>

        <div className="sioc-git-section">
          <h4>Git Repository (optional)</h4>
          <div className="sioc-form-grid">
            <label>
              Git URL
              <input type="text" value={gitUrl} onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git" />
            </label>
            <label>
              Branch
              <input type="text" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
            </label>
            <label>
              Path
              <input type="text" value={gitPath || `config/iocs/${moduleName}`}
                onChange={(e) => setGitPath(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="sioc-preview-actions">
          <button className="btn btn-accent" onClick={handleSave} disabled={!valid}>
            💾 Save to Dashboard
          </button>
          <button className="btn btn-secondary" onClick={handleDownload}>
            📦 Download ZIP
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="sioc-wizard-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="sioc-wizard">
        <div className="sioc-wizard-header">
          <h2>{editingTask ? 'Edit SoftIOC Task' : 'New SoftIOC Task'}</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="sioc-wizard-steps">
          {steps.map((s, i) => (
            <button
              key={s.key}
              className={`sioc-step-btn ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
              onClick={() => { if (i < step) setStep(i); }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {error && <div className="sioc-wizard-error">{error}</div>}

        <div className="sioc-wizard-body">
          {steps[step]?.key === 'template' && renderTemplateStep()}
          {steps[step]?.key === 'basic' && renderBasicStep()}
          {steps[step]?.key === 'inputs' && renderPvSection(inputs, setInputs, 'input')}
          {steps[step]?.key === 'outputs' && renderPvSection(outputs, setOutputs, 'output')}
          {steps[step]?.key === 'transforms' && renderTransformsStep()}
          {steps[step]?.key === 'rules' && renderRulesStep()}
          {steps[step]?.key === 'preview' && renderPreviewStep()}
        </div>

        <div className="sioc-wizard-footer">
          {step > 0 && (
            <button className="btn btn-secondary" onClick={prev}>← Back</button>
          )}
          <div style={{ flex: 1 }} />
          {step < steps.length - 1 && step > 0 && (
            <button className="btn btn-accent" onClick={next}>Next →</button>
          )}
        </div>
      </div>
    </div>
  );
}
