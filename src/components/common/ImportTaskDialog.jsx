/**
 * ImportTaskDialog — Import a task from local files, validate, and optionally add to config.
 *
 * Accepts config.yaml + Python files via file picker.
 * Validates structure and displays errors/warnings.
 */
import { useState, useRef, useCallback } from 'react';
import { validateImportedTask } from '../../services/beamlineControllerApi.js';

export default function ImportTaskDialog({ onClose, onImport }) {
  const [configYaml, setConfigYaml] = useState('');
  const [pythonCode, setPythonCode] = useState('');
  const [configFileName, setConfigFileName] = useState('');
  const [pythonFileName, setPythonFileName] = useState('');
  const [validation, setValidation] = useState(null);
  const configRef = useRef(null);
  const pythonRef = useRef(null);

  const readFile = (file) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(file);
    });

  const handleConfigFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfigFileName(file.name);
    setConfigYaml(await readFile(file));
    setValidation(null);
  }, []);

  const handlePythonFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPythonFileName(file.name);
    setPythonCode(await readFile(file));
    setValidation(null);
  }, []);

  const handleValidate = useCallback(() => {
    const result = validateImportedTask({ configYaml, pythonCode });
    setValidation(result);
  }, [configYaml, pythonCode]);

  const handleImport = useCallback(() => {
    if (!validation?.valid || !validation?.taskDef) return;
    onImport(validation.taskDef, validation.parsedConfig, { configYaml, pythonCode });
    onClose();
  }, [validation, onImport, onClose, configYaml, pythonCode]);

  const hasFiles = configYaml || pythonCode;

  return (
    <div className="wiz-overlay" onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="import-dialog-header">
          <h3>📂 Import Task</h3>
          <button className="toolbar-btn" onClick={onClose}>✕</button>
        </div>

        <div className="import-dialog-body">
          <p className="import-hint">
            Select the task's <strong>config.yaml</strong> and optionally the <strong>Python module</strong> to validate and import.
          </p>

          {/* Config YAML picker */}
          <div className="import-file-row">
            <label>📄 Config YAML</label>
            <input
              ref={configRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleConfigFile}
              style={{ display: 'none' }}
            />
            <button className="toolbar-btn" onClick={() => configRef.current?.click()}>
              {configFileName || 'Choose file…'}
            </button>
            {configFileName && <span className="import-file-name">✓ {configFileName}</span>}
          </div>

          {/* Python picker */}
          <div className="import-file-row">
            <label>🐍 Python Module</label>
            <input
              ref={pythonRef}
              type="file"
              accept=".py"
              onChange={handlePythonFile}
              style={{ display: 'none' }}
            />
            <button className="toolbar-btn" onClick={() => pythonRef.current?.click()}>
              {pythonFileName || 'Choose file…'}
            </button>
            {pythonFileName && <span className="import-file-name">✓ {pythonFileName}</span>}
          </div>

          {/* Paste fallback */}
          {!configFileName && (
            <div className="import-paste">
              <label>…or paste YAML config:</label>
              <textarea
                value={configYaml}
                onChange={(e) => { setConfigYaml(e.target.value); setValidation(null); }}
                rows={8}
                placeholder={`prefix: MY:PREFIX\ntasks:\n  - name: my_task\n    module: my_task\n    ...`}
              />
            </div>
          )}

          {/* Validate button */}
          {hasFiles && (
            <button className="toolbar-btn active" onClick={handleValidate}>
              🔍 Validate
            </button>
          )}

          {/* Validation results */}
          {validation && (
            <div className={`import-result ${validation.valid ? 'import-result--ok' : 'import-result--error'}`}>
              {validation.valid ? (
                <>
                  <div className="import-result-title">✅ Valid task definition</div>
                  {validation.taskDef?.displayName && (
                    <div className="import-result-detail">
                      <strong>{validation.taskDef.displayName}</strong>
                    </div>
                  )}
                  {validation.taskDef?.description && (
                    <div className="import-result-detail import-result-desc">
                      {validation.taskDef.description}
                    </div>
                  )}
                  {validation.taskDef && (
                    <div className="import-result-detail">
                      Module: <code>{validation.taskDef.module}</code> — Mode: {validation.taskDef.mode}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="import-result-title">❌ Validation errors</div>
                  <ul className="import-error-list">
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="import-dialog-footer">
          <button className="toolbar-btn" onClick={onClose}>Cancel</button>
          <button
            className="toolbar-btn active"
            disabled={!validation?.valid}
            onClick={handleImport}
          >
            📥 Add to Controller
          </button>
        </div>
      </div>
    </div>
  );
}
