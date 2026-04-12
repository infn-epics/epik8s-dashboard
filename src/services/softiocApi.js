/**
 * SoftIOC API service — manages softioc configuration, code generation,
 * deployment descriptors, and live PV monitoring.
 *
 * This service provides:
 *  - Parsing and generating iocmng declarative config.yaml files
 *  - Parsing and generating values-softiocs.yaml deployment descriptors
 *  - Python skeleton generation for custom tasks
 *  - Task template definitions (declarative, custom, etc.)
 *  - PV name building for live monitoring
 *  - ZIP export of complete task directory
 */

import yaml from 'js-yaml';
import { fetchFileFromGit } from './gitApi.js';

/* ────────────────────────────────────────────
   Constants
   ──────────────────────────────────────────── */

export const SOFTIOC_VALUES_PATH = 'deploy/values-softiocs.yaml';

export const DEFAULT_SOFTIOC_IMAGE = 'ghcr.io/infn-epics/epik8s-softioc-mng';

export const TASK_MODES = ['continuous', 'triggered'];

export const PV_TYPES = ['float', 'int', 'string', 'bool'];

export const STATUS_LABELS = ['INIT', 'RUN', 'PAUSED', 'END', 'ERROR'];
export const STATUS_COLORS = {
  INIT: '#6c757d',
  RUN: '#28a745',
  PAUSED: '#ffc107',
  END: '#17a2b8',
  ERROR: '#dc3545',
};

/**
 * Task templates for the step-by-step wizard.
 */
export const TASK_TEMPLATES = [
  {
    id: 'declarative',
    label: 'Declarative Task',
    icon: '📐',
    description:
      'No Python needed. Define wired inputs/outputs, transforms, rules, and actuators in YAML. ' +
      'The framework handles polling, expression evaluation, and PV updates automatically. ' +
      'Use built-in functions (math, stats, buffer) for transforms and rule conditions.',
    supportsRules: true,
    supportsTransforms: true,
    supportsLinks: true,
    requiresPython: false,
    defaultMode: 'continuous',
  },
  {
    id: 'custom-task',
    label: 'Custom Python Task',
    icon: '🐍',
    description:
      'Write a Python class extending TaskBase with initialize(), execute(), and cleanup(). ' +
      'Runs in continuous mode — execute() is called every interval. ' +
      'You still get wired I/O, PV operations, and Ophyd device access.',
    supportsRules: false,
    supportsTransforms: false,
    supportsLinks: true,
    requiresPython: true,
    defaultMode: 'continuous',
  },
  {
    id: 'custom-job',
    label: 'Custom Python Job',
    icon: '⚡',
    description:
      'A triggered job: write a Python class with triggered() that runs once when ' +
      'the RUN PV is set. Ideal for one-shot procedures, scans, or calibrations. ' +
      'Includes a RUN system PV for on-demand execution.',
    supportsRules: false,
    supportsTransforms: false,
    supportsLinks: true,
    requiresPython: true,
    defaultMode: 'triggered',
  },
];

/* ────────────────────────────────────────────
   Function registry — available in rule conditions and transform expressions.
   Mirrors the Python safe_eval function set from iocmng.core.functions.
   ──────────────────────────────────────────── */

export const SAFE_FUNCTIONS = [
  // Math
  { name: 'abs',      category: 'Math',       signature: 'abs(x)',                  description: 'Absolute value' },
  { name: 'round',    category: 'Math',       signature: 'round(x)',                description: 'Round to nearest integer' },
  { name: 'sqrt',     category: 'Math',       signature: 'sqrt(x)',                 description: 'Square root' },
  { name: 'log',      category: 'Math',       signature: 'log(x)',                  description: 'Natural logarithm' },
  { name: 'exp',      category: 'Math',       signature: 'exp(x)',                  description: 'e^x exponential' },
  { name: 'pow',      category: 'Math',       signature: 'pow(x, y)',               description: 'x raised to the power y' },
  { name: 'floor',    category: 'Math',       signature: 'floor(x)',                description: 'Floor (round down)' },
  { name: 'ceil',     category: 'Math',       signature: 'ceil(x)',                 description: 'Ceiling (round up)' },
  { name: 'clamp',    category: 'Math',       signature: 'clamp(val, low, high)',   description: 'Clamp value between bounds' },
  // Statistics
  { name: 'mean',     category: 'Statistics',  signature: 'mean(values)',            description: 'Average of array or buffer' },
  { name: 'std',      category: 'Statistics',  signature: 'std(values)',             description: 'Standard deviation' },
  { name: 'variance', category: 'Statistics',  signature: 'variance(values)',        description: 'Population variance' },
  { name: 'median',   category: 'Statistics',  signature: 'median(values)',          description: 'Median value' },
  { name: 'rms',      category: 'Statistics',  signature: 'rms(values)',             description: 'Root mean square' },
  { name: 'min',      category: 'Statistics',  signature: 'min(values)',             description: 'Minimum value' },
  { name: 'max',      category: 'Statistics',  signature: 'max(values)',             description: 'Maximum value' },
  // Logic
  { name: 'any_of',   category: 'Logic',       signature: 'any_of(a, b, ...)',      description: 'True if any argument is truthy' },
  { name: 'all_of',   category: 'Logic',       signature: 'all_of(a, b, ...)',      description: 'True if all arguments are truthy' },
  { name: 'count_true', category: 'Logic',     signature: 'count_true(a, b, ...)',  description: 'Count of truthy arguments' },
  // Array / Buffer
  { name: 'length',   category: 'Buffer',      signature: 'length(values)',          description: 'Count of elements' },
  { name: 'sum_of',   category: 'Buffer',      signature: 'sum_of(values)',          description: 'Sum all elements' },
  { name: 'diff',     category: 'Buffer',      signature: 'diff(values)',            description: 'First-order differences' },
  { name: 'last',     category: 'Buffer',      signature: 'last(values, n=1)',       description: 'Last n elements from buffer' },
  { name: 'moving_avg', category: 'Buffer',    signature: 'moving_avg(values, w)',   description: 'Moving average over window' },
  { name: 'derivative', category: 'Buffer',    signature: 'derivative(values)',      description: 'Alias for diff()' },
];

/** Group functions by category */
export function groupedFunctions() {
  const groups = {};
  for (const fn of SAFE_FUNCTIONS) {
    (groups[fn.category] ||= []).push(fn);
  }
  return groups;
}

/**
 * Operators available in condition/expression strings.
 */
export const SAFE_OPERATORS = [
  '==', '!=', '<', '>', '<=', '>=',
  'and', 'or', 'not',
  '+', '-', '*', '/', '%',
  'if', 'else',
];

/* ────────────────────────────────────────────
   Config.yaml parsing / generation
   ──────────────────────────────────────────── */

/**
 * Parse a raw iocmng config.yaml into normalised task definition.
 * Supports both `pvs:` (legacy) and `arguments:` (current) sections.
 */
export function parseTaskConfig(rawYaml) {
  const raw = typeof rawYaml === 'string' ? yaml.load(rawYaml) : rawYaml;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid config: must be a YAML object');
  }

  const params = raw.parameters || {};
  const argsSection = raw.arguments || raw.pvs || {};
  const inputs = argsSection.inputs || {};
  const outputs = argsSection.outputs || {};

  const mode =
    params.mode === 'triggered' || params.triggered
      ? 'triggered'
      : 'continuous';

  return {
    parameters: params,
    inputs,
    outputs,
    rules: raw.rules || [],
    transforms: raw.transforms || [],
    rule_defaults: raw.rule_defaults || {},
    mode,
  };
}

/**
 * Generate a complete config.yaml from a task definition.
 */
export function generateConfigYaml(taskDef) {
  const {
    name,
    mode,
    parameters = {},
    inputs = {},
    outputs = {},
    rules = [],
    transforms = [],
    rule_defaults = {},
  } = taskDef;

  const lines = [];
  lines.push('# config.yaml — iocmng task configuration');
  lines.push(`# Task: ${name || 'unnamed'}`);
  lines.push('# Auto-generated by EPIK8s SoftIOC Dashboard.');
  lines.push('');

  // Parameters
  lines.push('parameters:');
  lines.push(`  mode: ${mode || 'continuous'}`);
  const interval = parameters.interval || (mode === 'continuous' ? 1.0 : undefined);
  if (interval !== undefined) lines.push(`  interval: ${interval}`);
  const timeout = parameters.timeout;
  if (timeout !== undefined) lines.push(`  timeout: ${timeout}`);
  if (parameters.pva !== undefined) lines.push(`  pva: ${parameters.pva}`);
  // Extra parameters
  for (const [k, v] of Object.entries(parameters)) {
    if (['mode', 'interval', 'timeout', 'pva'].includes(k)) continue;
    lines.push(`  ${k}: ${JSON.stringify(v)}`);
  }
  lines.push('');

  // Arguments
  const hasInputs = Object.keys(inputs).length > 0;
  const hasOutputs = Object.keys(outputs).length > 0;
  if (hasInputs || hasOutputs) {
    lines.push('arguments:');
    if (hasInputs) {
      lines.push('  inputs:');
      for (const [k, v] of Object.entries(inputs)) {
        lines.push(`    ${k}:`);
        lines.push(`      type: ${v.type || 'float'}`);
        lines.push(`      value: ${v.value ?? 0}`);
        if (v.link) lines.push(`      link: "${v.link}"`);
        if (v.trigger) lines.push(`      trigger: true`);
        if (v.buffer_size) lines.push(`      buffer_size: ${v.buffer_size}`);
        if (v.unit) lines.push(`      unit: "${v.unit}"`);
        if (v.znam) lines.push(`      znam: "${v.znam}"`);
        if (v.onam) lines.push(`      onam: "${v.onam}"`);
      }
    }
    if (hasOutputs) {
      lines.push('  outputs:');
      for (const [k, v] of Object.entries(outputs)) {
        lines.push(`    ${k}:`);
        lines.push(`      type: ${v.type || 'float'}`);
        lines.push(`      value: ${v.value ?? 0}`);
        if (v.link) lines.push(`      link: "${v.link}"`);
        if (v.unit) lines.push(`      unit: "${v.unit}"`);
        if (v.znam) lines.push(`      znam: "${v.znam}"`);
        if (v.onam) lines.push(`      onam: "${v.onam}"`);
      }
    }
    lines.push('');
  }

  // Rule defaults
  if (Object.keys(rule_defaults).length > 0) {
    lines.push('rule_defaults:');
    for (const [k, v] of Object.entries(rule_defaults)) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push('');
  }

  // Rules
  if (rules.length > 0) {
    lines.push('rules:');
    for (const rule of rules) {
      lines.push(`  - id: ${rule.id || 'RULE'}`);
      lines.push(`    condition: >-`);
      lines.push(`      ${rule.condition || 'true'}`);
      if (rule.message) lines.push(`    message: "${rule.message}"`);
      if (rule.message_pv) lines.push(`    message_pv: ${rule.message_pv}`);
      if (rule.outputs && Object.keys(rule.outputs).length > 0) {
        lines.push('    outputs:');
        for (const [k, v] of Object.entries(rule.outputs)) {
          lines.push(`      ${k}: ${v}`);
        }
      }
      if (rule.actuators && Object.keys(rule.actuators).length > 0) {
        lines.push('    actuators:');
        for (const [k, v] of Object.entries(rule.actuators)) {
          lines.push(`      ${k}: ${v}`);
        }
      }
    }
    lines.push('');
  }

  // Transforms
  if (transforms.length > 0) {
    lines.push('transforms:');
    for (const tr of transforms) {
      lines.push(`  - output: ${tr.output}`);
      lines.push(`    expression: "${tr.expression}"`);
      if (tr.inputs) {
        lines.push('    inputs:');
        for (const inp of tr.inputs) {
          lines.push(`      - ${inp}`);
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Generate Python TaskBase skeleton.
 */
export function generateTaskPython(taskDef) {
  const { name, mode, description, inputs = {}, outputs = {}, parameters = {} } = taskDef;
  const className = (name || 'my_task')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  const inputLines = Object.entries(inputs)
    .map(([k]) => `        # ${k} = self.get_pv("${k}")`)
    .join('\n');

  const outputLines = Object.entries(outputs)
    .map(([k, v]) => `        self.set_pv("${k}", ${v.value ?? 0})`)
    .join('\n');

  return `#!/usr/bin/env python3
"""
${description || `${className} — iocmng task.`}

Auto-generated by EPIK8s SoftIOC Dashboard.
"""

from iocmng import TaskBase


class ${className}(TaskBase):
    """${description || className}"""

    def initialize(self):
        """Called once at startup."""
        self.logger.info("Initializing ${className}")

    def execute(self):
        """${mode === 'triggered' ? 'Called on each RUN trigger.' : 'Called each cycle.'}"""
${inputLines ? inputLines + '\n' : ''}${outputLines ? outputLines + '\n' : '        pass\n'}
    def cleanup(self):
        """Called at shutdown."""
        self.logger.info("Cleaning up ${className}")
`;
}

/**
 * Generate start.sh for standalone deployment.
 */
export function generateStartSh(moduleName) {
  return `#!/bin/bash
# start.sh — Launch iocmng task as standalone soft IOC
set -e
cd /epics/ioc/config
if [ -f requirements.txt ]; then
    pip install --quiet -r requirements.txt 2>/dev/null || true
fi
exec iocmng-run --config config.yaml
`;
}

/**
 * Generate requirements.txt.
 */
export function generateRequirementsTxt() {
  return `# IOC Manager Task Dependencies
iocmng>=2.5.0
pyyaml>=6.0
`;
}

/* ────────────────────────────────────────────
   values-softiocs.yaml parsing / generation
   ──────────────────────────────────────────── */

/**
 * Parse values-softiocs.yaml into structured data.
 */
export function parseValuesSoftiocs(rawYaml) {
  const doc = typeof rawYaml === 'string' ? yaml.load(rawYaml) : rawYaml;
  if (!doc || typeof doc !== 'object') return { defaults: {}, softiocs: [] };

  const defaults = doc.softiocDefaults || {};
  const softiocs = (doc.softiocs || []).map((s) => ({
    name: s.name || '',
    iocprefix: s.iocprefix || '',
    module: s.module || '',
    className: s.className || '',
    description: s.description || '',
    softiocType: s.softiocType || defaults.softiocType || 'task',
    image: s.image || defaults.image || DEFAULT_SOFTIOC_IMAGE,
    usegateway: s.usegateway ?? defaults.usegateway ?? true,
    devgroup: s.devgroup || defaults.devgroup || 'global',
    gitRepoConfig: s.gitRepoConfig || {},
    // Preserve all extra keys
    _raw: s,
  }));

  return { defaults, softiocs, _doc: doc };
}

/**
 * Serialize softioc data back to values-softiocs.yaml string.
 */
export function serializeValuesSoftiocs(data) {
  const doc = {
    softiocDefaults: data.defaults || {},
    softiocs: data.softiocs.map((s) => {
      const entry = { ...s._raw, ...s };
      delete entry._raw;
      return entry;
    }),
  };
  return (
    '# values-softiocs.yaml — standalone soft IOCs deployed via ArgoCD + ioc-chart\n' +
    yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
  );
}

/**
 * Create a new softioc entry from a task definition.
 */
export function createSoftiocEntry(taskDef, gitConfig) {
  const name = taskDef.name || taskDef.module || 'new-softioc';
  const className = (name || 'task')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return {
    name,
    iocprefix: taskDef.iocprefix || '',
    module: taskDef.module || name.replace(/-/g, '_'),
    className: taskDef.className || className,
    description: taskDef.description || '',
    softiocType: taskDef.mode === 'triggered' ? 'job' : 'task',
    gitRepoConfig: gitConfig || {},
    _raw: {},
  };
}

/* ────────────────────────────────────────────
   PV name building for live monitoring
   ──────────────────────────────────────────── */

/**
 * Build a PV name for a softioc task.
 */
export function buildPvName(prefix, pvKey) {
  return `${prefix}:${pvKey}`;
}

/**
 * Get system PV names for a softioc task.
 */
export function getSystemPvs(prefix, mode) {
  const pvs = [
    { key: 'ENABLE', name: `${prefix}:ENABLE`, type: 'bool', writable: true },
    { key: 'STATUS', name: `${prefix}:STATUS`, type: 'mbb', writable: false },
    { key: 'MESSAGE', name: `${prefix}:MESSAGE`, type: 'string', writable: false },
    { key: 'VERSION', name: `${prefix}:VERSION`, type: 'string', writable: false },
  ];
  if (mode === 'triggered') {
    pvs.push({ key: 'RUN', name: `${prefix}:RUN`, type: 'bool', writable: true });
  } else {
    pvs.push({ key: 'CYCLE_COUNT', name: `${prefix}:CYCLE_COUNT`, type: 'int', writable: false });
  }
  return pvs;
}

export function statusLabel(value) {
  return STATUS_LABELS[value] || `UNKNOWN(${value})`;
}

export function statusColor(value) {
  const label = STATUS_LABELS[value] || 'ERROR';
  return STATUS_COLORS[label] || '#6c757d';
}

/* ────────────────────────────────────────────
   ZIP export
   ──────────────────────────────────────────── */

/**
 * Generate a ZIP with all task files.
 */
export async function generateTaskZip(taskDef) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const dir = taskDef.module || taskDef.name || 'task';
  const folder = zip.folder(dir);
  folder.file('config.yaml', generateConfigYaml(taskDef));
  if (taskDef.requiresPython !== false && taskDef.template !== 'declarative') {
    folder.file(`${dir}.py`, generateTaskPython(taskDef));
  }
  folder.file('requirements.txt', generateRequirementsTxt());
  folder.file('start.sh', generateStartSh(dir));
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Validate a task definition.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateTaskDef(taskDef) {
  const errors = [];

  if (!taskDef.name || !taskDef.name.trim()) {
    errors.push('Task name is required');
  } else if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(taskDef.name)) {
    errors.push('Task name must start with a letter and contain only letters, digits, hyphens, underscores');
  }

  if (taskDef.rules && taskDef.rules.length > 0) {
    for (const rule of taskDef.rules) {
      if (!rule.id || !rule.id.trim()) errors.push('All rules must have an id');
      if (!rule.condition || !rule.condition.trim()) errors.push(`Rule "${rule.id}": condition is required`);
    }
  }

  // Check for duplicate PV names
  const allPvs = [
    ...Object.keys(taskDef.inputs || {}),
    ...Object.keys(taskDef.outputs || {}),
  ];
  const seen = new Set();
  for (const pv of allPvs) {
    if (seen.has(pv)) errors.push(`Duplicate PV name: ${pv}`);
    seen.add(pv);
  }

  return { valid: errors.length === 0, errors };
}

/* ────────────────────────────────────────────
   Git sync
   ──────────────────────────────────────────── */

/**
 * Fetch values-softiocs.yaml from the configured git repository.
 * Delegates to the shared fetchFileFromGit utility in gitApi.js.
 */
export async function fetchValuesFromGit(repoInfo, branch = 'main', token = null) {
  return fetchFileFromGit(repoInfo, SOFTIOC_VALUES_PATH, branch, token);
}
