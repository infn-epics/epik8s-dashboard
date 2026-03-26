/**
 * Beamline Controller API service.
 *
 * The beamline controller is a softioc that exposes EPICS PVs for each task.
 * PV naming: {PREFIX}:{TASK_NAME}:{PV_NAME}
 *
 * Built-in PVs per task:
 *   ENABLE       (boolOut)  — enable/disable
 *   STATUS       (mbbIn)    — INIT=0, RUN=1, PAUSED=2, END=3, ERROR=4
 *   MESSAGE      (stringIn) — status message
 *   CYCLE_COUNT  (longIn)   — continuous-mode cycle counter
 *   RUN          (boolOut)  — triggered-mode trigger button
 *
 * This module provides helpers to:
 *   - Discover the controller config from the beamline values.yaml
 *   - Build PV names for tasks
 *   - Fetch controller config from a URL or parse from mounted NFS
 *   - Generate task skeleton code and YAML config
 */

import yaml from 'js-yaml';

let _configUrl = null;
let _cachedConfig = null;

const STATUS_LABELS = ['INIT', 'RUN', 'PAUSED', 'END', 'ERROR'];
const STATUS_COLORS = {
  INIT: '#6c757d',
  RUN: '#28a745',
  PAUSED: '#ffc107',
  END: '#17a2b8',
  ERROR: '#dc3545',
};

/**
 * Extract beamline controller info from the values.yaml config.
 * Returns { prefix, name } or null if not found.
 */
export function findControllerInConfig(config) {
  const iocs = config?.epicsConfiguration?.iocs || [];
  const bc = iocs.find(
    (ioc) => ioc.name === 'beamline-controller' || ioc.devgroup === 'global'
  );
  if (!bc) return null;
  return {
    name: bc.name,
    prefix: bc.iocprefix || '',
    devtype: bc.devtype || 'softioc',
    devgroup: bc.devgroup || 'global',
  };
}

/**
 * Build the controller config URL.
 * Pattern: https://{namespace}-{iocname}.{domain}/config.yaml
 * Or use ?controllerConfig= query param override.
 */
export function buildControllerConfigUrl(config) {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('controllerConfig');
  if (override) return override;
  return null;
}

/**
 * Build default controller API URL.
 *
 * Priority:
 *  1) ?controllerApi=... query parameter
 *  2) https://{namespace}-beamline-controller.{epik8namespace}
 */
export function buildControllerApiUrl(config) {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('controllerApi');
  if (override) return override;

  const ns = config?.namespace;
  const domain = config?.epik8namespace;
  if (ns && domain) {
    return `${window.location.protocol}//${ns}-beamline-controller.${domain}`;
  }
  return '';
}

export function setControllerConfigUrl(url) {
  _configUrl = url;
  _cachedConfig = null;
}

export function getControllerConfigUrl() {
  return _configUrl;
}

/**
 * Fetch and parse the controller config.yaml.
 * Returns { prefix, tasks: [...] }.
 */
export async function fetchControllerConfig() {
  if (_cachedConfig) return _cachedConfig;
  if (!_configUrl) return null;
  const resp = await fetch(_configUrl);
  if (!resp.ok) throw new Error(`Failed to fetch controller config: ${resp.status}`);
  const text = await resp.text();
  const raw = yaml.load(text);
  _cachedConfig = normalizeControllerConfig(raw);
  return _cachedConfig;
}

/**
 * Set the controller config directly (e.g. from manual input or local file).
 */
export function setControllerConfig(raw) {
  _cachedConfig = normalizeControllerConfig(raw);
  return _cachedConfig;
}

export function getControllerConfig() {
  return _cachedConfig;
}

/**
 * Normalize a raw controller-config.yaml into a standard format.
 */
function normalizeControllerConfig(raw) {
  const prefix = raw.prefix || 'BEAMLINE:CONTROL';
  const rawTasks = raw.tasks || [];
  const tasks = rawTasks.map((t) => {
    const params = t.parameters || {};
    const pvs = t.pvs || {};
    const mode =
      params.mode === 'triggered' || params.triggered
        ? 'triggered'
        : 'continuous';
    return {
      name: t.name || '',
      module: t.module || '',
      prefix: t.prefix || null,  // optional task-level PV prefix segment
      mode,
      parameters: params,
      inputs: pvs.inputs || {},
      outputs: pvs.outputs || {},
    };
  });
  return { prefix, tasks, raw };
}

/**
 * Build a full PV name for a task's PV.
 */
export function buildTaskPvName(prefix, taskName, pvName) {
  return `${prefix}:${taskName.toUpperCase()}:${pvName}`;
}

/**
 * Get the list of built-in PV names for a task.
 */
export function getBuiltinPvNames(prefix, taskName, mode) {
  const base = [
    { key: 'ENABLE', name: buildTaskPvName(prefix, taskName, 'ENABLE'), type: 'bool', writable: true },
    { key: 'STATUS', name: buildTaskPvName(prefix, taskName, 'STATUS'), type: 'mbb', writable: false },
    { key: 'MESSAGE', name: buildTaskPvName(prefix, taskName, 'MESSAGE'), type: 'string', writable: false },
  ];
  if (mode === 'triggered') {
    base.push({ key: 'RUN', name: buildTaskPvName(prefix, taskName, 'RUN'), type: 'bool', writable: true });
  } else {
    base.push({ key: 'CYCLE_COUNT', name: buildTaskPvName(prefix, taskName, 'CYCLE_COUNT'), type: 'int', writable: false });
  }
  return base;
}

export function statusLabel(value) {
  return STATUS_LABELS[value] || `UNKNOWN(${value})`;
}

export function statusColor(value) {
  const label = STATUS_LABELS[value] || 'ERROR';
  return STATUS_COLORS[label] || '#6c757d';
}

/* ────────────────────────────────────────────
   Code generation for task wizard
   ──────────────────────────────────────────── */

const PV_TYPE_MAP = {
  float: { python: 'float', default: '0.0', builder_in: 'aIn', builder_out: 'aOut' },
  int: { python: 'int', default: '0', builder_in: 'longIn', builder_out: 'longOut' },
  string: { python: 'str', default: '""', builder_in: 'stringIn', builder_out: 'stringOut' },
  bool: { python: 'bool', default: '0', builder_in: 'boolIn', builder_out: 'boolOut' },
};

/**
 * Generate the Python task skeleton.
 */
export function generateTaskPython(taskDef) {
  const { name, mode, parameters, inputs, outputs, description } = taskDef;
  const className = name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  const paramLines = Object.entries(parameters || {})
    .map(([k, v]) => {
      const val = v.default ?? v.value ?? '';
      const pyVal = Array.isArray(val)
        ? `[${val.map(i => JSON.stringify(i)).join(', ')}]`
        : JSON.stringify(val);
      return `        self.${k} = self.parameters.get("${k}", ${pyVal})`;
    })
    .join('\n');

  const inputPvLines = Object.entries(inputs || {})
    .map(([k, v]) => `        #   ${k} (${v.type}) → read with self.get_pv("${k}")`)
    .join('\n');

  const outputSetLines = Object.entries(outputs || {})
    .map(([k, v]) => `        self.set_pv("${k}", 0)  # TODO: set ${v.type} value`)
    .join('\n');

  const modeComment = mode === 'triggered'
    ? 'Called each time the RUN PV is triggered.'
    : "Called repeatedly by the framework. Control interval via parameters['interval'].";

  return `#!/usr/bin/env python3
"""
${description || `${className} — IOC Manager task.`}

Auto-generated by EPIK8s Dashboard Task Wizard.
"""

from iocmng import TaskBase


class ${className}(TaskBase):
    """${description || className + ' task.'}"""

    def initialize(self):
        """Called once at startup. Set up devices and initial state."""
        self.logger.info("Initializing ${className}")
${paramLines ? paramLines + '\n' : ''}
        # Access ophyd devices if needed:
        # device = self.get_device("device_name")

    def execute(self):
        """${modeComment}

        Read inputs:  self.get_pv("PV_NAME")
        Write outputs: self.set_pv("PV_NAME", value)
        """
${inputPvLines ? inputPvLines + '\n' : ''}        # TODO: implement task logic
${outputSetLines ? outputSetLines + '\n' : '        pass\n'}
    def cleanup(self):
        """Called at shutdown."""
        self.logger.info("Cleaning up ${className}")
`;
}

/**
 * Generate the YAML config block for a task.
 */
export function generateTaskYaml(taskDef) {
  const { name, mode, parameters, inputs, outputs } = taskDef;
  const moduleName = name.toLowerCase().replace(/\s+/g, '_');

  const lines = [];
  lines.push(`  - name: "${name}"`);
  lines.push(`    module: "${moduleName}"`);

  // Parameters
  lines.push('    parameters:');
  if (mode === 'triggered') {
    lines.push('      triggered: true');
  }
  for (const [k, v] of Object.entries(parameters || {})) {
    const val = v.default ?? v.value ?? '';
    if (Array.isArray(val)) {
      lines.push(`      ${k}:`);
      for (const item of val) {
        lines.push(`        - ${JSON.stringify(item)}`);
      }
    } else {
      lines.push(`      ${k}: ${JSON.stringify(val)}`);
    }
  }

  // PVs
  lines.push('    pvs:');

  if (Object.keys(inputs || {}).length > 0) {
    lines.push('      inputs:');
    for (const [k, v] of Object.entries(inputs)) {
      lines.push(`        ${k}:`);
      lines.push(`          type: ${v.type || 'float'}`);
      lines.push(`          value: ${v.default ?? v.value ?? 0}`);
      if (v.unit) lines.push(`          unit: "${v.unit}"`);
      if (v.desc) lines.push(`          # ${v.desc}`);
    }
  }

  if (Object.keys(outputs || {}).length > 0) {
    lines.push('      outputs:');
    for (const [k, v] of Object.entries(outputs)) {
      lines.push(`        ${k}:`);
      lines.push(`          type: ${v.type || 'float'}`);
      lines.push(`          value: ${v.default ?? v.value ?? 0}`);
      if (v.unit) lines.push(`          unit: "${v.unit}"`);
      if (v.desc) lines.push(`          # ${v.desc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a plugin config.yaml (iocmng format: parameters + pvs, optional prefix).
 * @param {Object} taskDef
 * @param {string} [controllerPrefix] — beamline controller global prefix (for header comments only)
 */
export function generateFullConfigYaml(taskDef, controllerPrefix) {
  const { name, mode, prefix, parameters, inputs, outputs } = taskDef;
  const pvSegment = (prefix || name.toUpperCase().replace(/\s+/g, '_'));

  const lines = [];
  lines.push('# yaml-language-server: $schema=https://epik8s.infn.it/schemas/iocmng-config.json');
  lines.push('#');
  lines.push(`# config.yaml — ${name}`);
  lines.push('# Auto-generated by EPIK8s Dashboard Task Wizard.');
  lines.push('# Place alongside the Python module in the plugin git repository.');
  if (controllerPrefix) {
    lines.push('#');
    lines.push(`# PVs: ${controllerPrefix}:${pvSegment}:{PV_NAME}`);
  }
  lines.push('');

  if (prefix) {
    lines.push(`prefix: ${prefix}`);
    lines.push('');
  }

  lines.push('parameters:');
  lines.push(`  mode: ${mode}`);
  lines.push('  interval: 1.0');
  for (const [k, v] of Object.entries(parameters || {})) {
    if (k === 'mode' || k === 'interval') continue;
    const val = v.default ?? v.value ?? '';
    if (Array.isArray(val)) {
      lines.push(`  ${k}:`);
      for (const item of val) lines.push(`    - ${JSON.stringify(item)}`);
    } else {
      lines.push(`  ${k}: ${JSON.stringify(val)}`);
    }
  }
  lines.push('');

  const hasInputs = Object.keys(inputs || {}).length > 0;
  const hasOutputs = Object.keys(outputs || {}).length > 0;

  if (hasInputs || hasOutputs) {
    lines.push('pvs:');
    if (hasInputs) {
      lines.push('  inputs:');
      for (const [k, v] of Object.entries(inputs)) {
        lines.push(`    ${k}:`);
        lines.push(`      type: ${v.type || 'float'}`);
        lines.push(`      value: ${v.default ?? v.value ?? 0}`);
        if (v.unit) lines.push(`      unit: "${v.unit}"`);
        if (v.desc) lines.push(`      # ${v.desc}`);
      }
    }
    if (hasOutputs) {
      lines.push('  outputs:');
      for (const [k, v] of Object.entries(outputs)) {
        lines.push(`    ${k}:`);
        lines.push(`      type: ${v.type || 'float'}`);
        lines.push(`      value: ${v.default ?? v.value ?? 0}`);
        if (v.unit) lines.push(`      unit: "${v.unit}"`);
        if (v.desc) lines.push(`      # ${v.desc}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Generate a requirements.txt for the task.
 */
export function generateRequirementsTxt() {
  return `# IOC Manager Task Dependencies
iocmng>=0.1.0
softioc>=4.5.0
cothread>=2.19
pyyaml>=6.0
ophyd>=1.7.0
`;
}

/* ────────────────────────────────────────────
   ZIP generation
   ──────────────────────────────────────────── */

/**
 * Generate a ZIP containing all task files, structured into taskname/ directory.
 * @param {Object} taskDef
 * @param {string} prefix
 * @param {string} [basePath] — optional base path inside the zip (e.g. "config/iocs/beamline-controller")
 * @returns {Promise<Blob>}
 */
export async function generateTaskZip(taskDef, prefix, basePath) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const dirName = basePath
    ? `${basePath}/${taskDef.module}`
    : taskDef.module;
  const folder = zip.folder(dirName);
  folder.file(`${taskDef.module}.py`, generateTaskPython(taskDef));
  folder.file('config.yaml', generateFullConfigYaml(taskDef, prefix));
  folder.file('requirements.txt', generateRequirementsTxt());
  return zip.generateAsync({ type: 'blob' });
}

/* ────────────────────────────────────────────
   Task import / validation
   ──────────────────────────────────────────── */

/**
 * Parse and validate a task from imported files.
 * Accepts an object: { configYaml?: string, pythonCode?: string }
 * Returns { valid, errors, taskDef?, taskNames? }
 */
export function validateImportedTask(files) {
  const errors = [];
  let taskDef = null;
  let parsedConfig = null;

  // ── Validate YAML config ──
  if (files.configYaml) {
    try {
      parsedConfig = yaml.load(files.configYaml);
      if (!parsedConfig || typeof parsedConfig !== 'object') {
        errors.push('Config YAML is empty or not a valid object');
      } else {
        // Detect legacy multi-task controller format
        if (parsedConfig.tasks || parsedConfig.name || parsedConfig.tasksrepo) {
          errors.push(
            'This looks like a legacy controller config (with "tasks:" list), not a plugin config.yaml. ' +
            'A plugin config.yaml should have top-level keys: prefix (optional), parameters, pvs.'
          );
        } else {
          // Unknown top-level keys
          const validKeys = new Set(['prefix', 'parameters', 'pvs']);
          const unknownKeys = Object.keys(parsedConfig).filter(k => !validKeys.has(k));
          if (unknownKeys.length > 0) {
            errors.push(`Unknown top-level key(s): ${unknownKeys.join(', ')} — valid keys are: prefix, parameters, pvs`);
          }

          // Validate optional prefix
          if (parsedConfig.prefix !== undefined) {
            if (typeof parsedConfig.prefix !== 'string' || !parsedConfig.prefix.trim()) {
              errors.push('"prefix" must be a non-empty string (e.g. "CMM")');
            } else if (!/^[A-Z0-9][A-Z0-9_:-]*$/.test(parsedConfig.prefix)) {
              errors.push(`"prefix" "${parsedConfig.prefix}" must be uppercase alphanumeric (A-Z, 0-9, _, :, -)`);
            }
          }

          // Validate parameters
          const params = parsedConfig.parameters || {};
          if (params.mode !== undefined && !['continuous', 'triggered'].includes(params.mode)) {
            errors.push(`"parameters.mode" must be "continuous" or "triggered", got "${params.mode}"`);
          }

          // Validate pvs
          const pvs = parsedConfig.pvs || {};
          const validPvTypes = ['float', 'int', 'string', 'bool'];
          for (const [section, pvMap] of Object.entries(pvs)) {
            if (!['inputs', 'outputs'].includes(section)) {
              errors.push(`Unknown pvs section "${section}" (expected: inputs, outputs)`);
              continue;
            }
            if (typeof pvMap !== 'object' || pvMap === null) continue;
            for (const [pvName, pvDef] of Object.entries(pvMap)) {
              if (!pvDef || typeof pvDef !== 'object') {
                errors.push(`PV "${pvName}" definition must be an object`);
                continue;
              }
              if (!pvDef.type) {
                errors.push(`PV "${pvName}" missing required "type" field`);
              } else if (!validPvTypes.includes(pvDef.type)) {
                errors.push(`PV "${pvName}" has invalid type "${pvDef.type}" (must be: ${validPvTypes.join(', ')})`);
              }
              if (pvDef.value === undefined) {
                errors.push(`PV "${pvName}" missing required "value" field`);
              }
            }
          }

          // Build taskDef from config
          if (errors.length === 0) {
            const mode = params.mode === 'triggered' || params.triggered ? 'triggered' : 'continuous';
            const rawName = files.moduleName || params.name || parsedConfig.prefix || 'imported_task';
            const moduleName = rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '_');
            taskDef = {
              name: moduleName,
              displayName: params.name || null,
              description: params.description || '',
              module: moduleName,
              prefix: parsedConfig.prefix || null,
              mode,
              parameters: {},
              inputs: pvs.inputs || {},
              outputs: pvs.outputs || {},
            };
            for (const [k, v] of Object.entries(params)) {
              if (k === 'mode' || k === 'triggered') continue;
              const isArr = Array.isArray(v);
              taskDef.parameters[k] = {
                value: v, default: v,
                type: isArr ? 'list' : typeof v === 'number'
                  ? (Number.isInteger(v) ? 'int' : 'float')
                  : typeof v === 'boolean' ? 'bool' : 'string',
              };
            }
          }
        }
      }
    } catch (e) {
      errors.push(`YAML parse error: ${e.message}`);
    }
  }

  // ── Validate Python ──
  if (files.pythonCode) {
    const code = files.pythonCode;
    if (!code.includes('TaskBase') && !code.includes('JobBase')) {
      errors.push('Python file does not import or extend TaskBase or JobBase (from iocmng)');
    }
    if (!code.includes('def initialize')) {
      errors.push('Python file missing initialize() method');
    }
    if (!code.includes('def execute')) {
      errors.push('Python file missing execute() method');
    }
    if (!code.includes('def cleanup') && !code.includes('JobBase')) {
      errors.push('Python file missing cleanup() method (required for TaskBase)');
    }
  }

  return { valid: errors.length === 0, errors, taskDef, parsedConfig };
}

/* ────────────────────────────────────────────
   Git project integration helpers
   ──────────────────────────────────────────── */

const DEFAULT_TASK_PATH = 'config/iocs/beamline-controller';

/**
 * Get the default project path for a task.
 */
export function getDefaultTaskPath(taskName) {
  return `${DEFAULT_TASK_PATH}/${taskName}`;
}

/* ────────────────────────────────────────────
   Controller REST API helpers
   ──────────────────────────────────────────── */

/**
 * Deploy a plugin to the running iocmng controller.
 * Tries POST /api/v1/plugins first (v2+); falls back to /api/v1/tasks for older containers.
 */
export async function deployPlugin(controllerApiUrl, { name, git_url, path, pat, branch, auto_start = true }) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const body = JSON.stringify({
    name,
    git_url,
    path: path || '',
    pat: pat || undefined,
    branch: branch || 'main',
    auto_start,
  });
  const headers = { 'Content-Type': 'application/json' };

  // Try unified /api/v1/plugins endpoint (iocmng v2+)
  let resp = await fetch(`${base}/api/v1/plugins`, { method: 'POST', headers, body });
  if (resp.status === 404) {
    // Fall back to /api/v1/tasks for older controller images
    resp = await fetch(`${base}/api/v1/tasks`, { method: 'POST', headers, body });
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || data?.message || `Deploy failed (${resp.status})`);
  if (data?.ok === false) throw new Error(data?.message || 'Deploy was rejected by the controller');
  return data;
}

/**
 * Restart (hot-reload) a plugin on the controller.
 */
export async function restartPlugin(controllerApiUrl, name) {
  const url = `${controllerApiUrl.replace(/\/+$/, '')}/api/v1/plugins/${encodeURIComponent(name)}/restart`;
  const resp = await fetch(url, { method: 'POST' });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || data?.message || `Restart failed (${resp.status})`);
  if (data?.ok === false) throw new Error(data?.message || 'Restart was rejected by the controller');
  return data;
}

/**
 * Fetch beamline-controller health from /api/v1/health.
 */
export async function fetchControllerHealth(controllerApiUrl) {
  const url = `${controllerApiUrl.replace(/\/+$/, '')}/api/v1/health`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Health check failed (${resp.status})`);
  return data;
}

/**
 * Fetch loaded tasks from /api/v1/tasks.
 */
export async function listControllerTasks(controllerApiUrl) {
  const url = `${controllerApiUrl.replace(/\/+$/, '')}/api/v1/tasks`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Task listing failed (${resp.status})`);
  return data;
}

/**
 * Fetch loaded jobs from /api/v1/jobs.
 */
export async function listControllerJobs(controllerApiUrl) {
  const url = `${controllerApiUrl.replace(/\/+$/, '')}/api/v1/jobs`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Job listing failed (${resp.status})`);
  return data;
}

/**
 * Fetch startup/config metadata for a loaded task.
 */
export async function fetchControllerTaskStartup(controllerApiUrl, name) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/tasks/${encodeURIComponent(name)}/startup`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Task startup lookup failed (${resp.status})`);
  return data;
}

/**
 * Fetch startup/config metadata for a loaded job.
 */
export async function fetchControllerJobStartup(controllerApiUrl, name) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/jobs/${encodeURIComponent(name)}/startup`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Job startup lookup failed (${resp.status})`);
  return data;
}

/**
 * Run a loaded job from the controller.
 */
export async function runControllerJob(controllerApiUrl, name) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/jobs/${encodeURIComponent(name)}/run`;
  const resp = await fetch(url, { method: 'POST' });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Job run failed (${resp.status})`);
  return data;
}

/**
 * Get details of a loaded plugin/task/job.
 */
export async function getControllerPlugin(controllerApiUrl, name) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/plugins/${encodeURIComponent(name)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || `Plugin lookup failed (${resp.status})`);
  return data;
}

/**
 * Remove (unload) a plugin from the controller.
 */
export async function removeControllerPlugin(controllerApiUrl, name) {
  const base = controllerApiUrl.replace(/\/+$/, '');
  const url = `${base}/api/v1/plugins/${encodeURIComponent(name)}`;
  const resp = await fetch(url, { method: 'DELETE' });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(data?.detail || data?.message || `Remove failed (${resp.status})`);
  return data;
}

export { STATUS_LABELS, STATUS_COLORS, PV_TYPE_MAP, DEFAULT_TASK_PATH };
