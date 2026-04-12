/**
 * SoftIOCContext — state management for the SoftIOC Dashboard.
 *
 * Manages:
 *  - values-softiocs.yaml content (deployment descriptors)
 *  - Individual task configs (parsed config.yaml per softioc)
 *  - Active softioc selection
 *  - Wizard state
 *  - Live PV subscriptions for running softiocs
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import yaml from 'js-yaml';
import {
  SOFTIOC_VALUES_PATH,
  parseValuesSoftiocs,
  serializeValuesSoftiocs,
  parseTaskConfig,
  createSoftiocEntry,
  generateConfigYaml,
  validateTaskDef,
} from '../services/softiocApi.js';
import { useGitFetch } from '../hooks/useGitFetch.js';
import { useAuth } from './AuthContext.jsx';
import { parseGitUrl, fetchFileFromGit } from '../services/gitApi.js';

const SoftIOCContext = createContext(null);

const LS_VALUES_KEY = 'epik8s-softioc-values';
const LS_CONFIGS_KEY = 'epik8s-softioc-configs';

export function SoftIOCProvider({ children }) {
  const { fetchFromGit, canFetch: canSync, repoInfo, branch: gitBranch } = useGitFetch();
  const { token } = useAuth();

  // Sync status
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', lastSync: null, error: null });

  // values-softiocs.yaml data
  const [valuesData, setValuesData] = useState({ defaults: {}, softiocs: [] });
  const [valuesYaml, setValuesYaml] = useState('');
  const [valuesLoaded, setValuesLoaded] = useState(false);

  // Per-task configs (map: name → parsed config)
  const [taskConfigs, setTaskConfigs] = useState({});

  // UI state
  const [selectedSoftioc, setSelectedSoftioc] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState(null);
  const [editingTask, setEditingTask] = useState(null); // task being edited
  const [dirty, setDirty] = useState(false);

  // Load persisted state
  useEffect(() => {
    try {
      const savedYaml = localStorage.getItem(LS_VALUES_KEY);
      if (savedYaml) {
        setValuesYaml(savedYaml);
        setValuesData(parseValuesSoftiocs(savedYaml));
        setValuesLoaded(true);
      }
      const savedConfigs = localStorage.getItem(LS_CONFIGS_KEY);
      if (savedConfigs) {
        setTaskConfigs(JSON.parse(savedConfigs));
      }
    } catch { /* ignore */ }
  }, []);

  // Persist on change
  useEffect(() => {
    if (valuesYaml) localStorage.setItem(LS_VALUES_KEY, valuesYaml);
  }, [valuesYaml]);

  useEffect(() => {
    if (Object.keys(taskConfigs).length > 0) {
      localStorage.setItem(LS_CONFIGS_KEY, JSON.stringify(taskConfigs));
    }
  }, [taskConfigs]);

  /**
   * Fetch config.yaml for each softioc listed in values-softiocs.yaml.
   * Uses the gitRepoConfig.url/path/branch from each entry.
   */
  const syncConfigs = useCallback(async (softiocs) => {
    if (!softiocs?.length) return {};
    const results = {};
    await Promise.allSettled(
      softiocs
        .filter((s) => s.gitRepoConfig?.url && s.gitRepoConfig?.path)
        .map(async (s) => {
          try {
            const ri = parseGitUrl(s.gitRepoConfig.url);
            const branch = s.gitRepoConfig.branch || 'main';
            const filePath = `${s.gitRepoConfig.path}/config.yaml`;
            const content = await fetchFileFromGit(ri, filePath, branch, token || null);
            results[s.name] = parseTaskConfig(content);
          } catch (err) {
            console.warn(`[SoftIOC] config fetch failed for ${s.name}:`, err.message);
          }
        })
    );
    return results;
  }, [token]);

  /**
   * Sync values-softiocs.yaml from the git repository, then fetch each
   * task's config.yaml referenced in gitRepoConfig.
   * Works for public repos without a token; private repos require a PAT.
   */
  const syncFromGit = useCallback(async () => {
    if (!canSync) return;
    setSyncStatus({ state: 'syncing', lastSync: null, error: null });
    try {
      const content = await fetchFromGit(SOFTIOC_VALUES_PATH);
      const data = parseValuesSoftiocs(content);
      setValuesData(data);
      setValuesYaml(content);
      setValuesLoaded(true);
      setDirty(false);

      // Fetch per-IOC config.yaml files
      const configs = await syncConfigs(data.softiocs);
      if (Object.keys(configs).length > 0) {
        setTaskConfigs((prev) => ({ ...prev, ...configs }));
      }

      const now = new Date();
      setSyncStatus({ state: 'ok', lastSync: now, error: null });
      localStorage.setItem(LS_VALUES_KEY, content);
      localStorage.setItem('epik8s-softioc-last-sync', now.toISOString());
    } catch (err) {
      setSyncStatus({ state: 'error', lastSync: null, error: err.message });
    }
  }, [canSync, fetchFromGit, syncConfigs]);

  // Auto-sync on mount only when no locally-cached values exist
  useEffect(() => {
    const hasLocal = !!localStorage.getItem(LS_VALUES_KEY);
    if (canSync && !hasLocal) {
      syncFromGit();
    }
    // canSync/syncFromGit are stable (derived from config at mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Import values-softiocs.yaml from string.
   */
  const importValues = useCallback((yamlStr) => {
    const data = parseValuesSoftiocs(yamlStr);
    setValuesData(data);
    setValuesYaml(yamlStr);
    setValuesLoaded(true);
    setDirty(false);
  }, []);

  /**
   * Import a task config.yaml for a specific softioc.
   */
  const importTaskConfig = useCallback((name, yamlStr) => {
    try {
      const parsed = parseTaskConfig(yamlStr);
      setTaskConfigs((prev) => ({ ...prev, [name]: parsed }));
    } catch (e) {
      console.error(`Failed to parse config for ${name}:`, e);
    }
  }, []);

  /**
   * Add a new softioc from wizard output.
   */
  const addSoftioc = useCallback((taskDef, gitConfig) => {
    const entry = createSoftiocEntry(taskDef, gitConfig);
    setValuesData((prev) => {
      const updated = {
        ...prev,
        softiocs: [...prev.softiocs, entry],
      };
      setValuesYaml(serializeValuesSoftiocs(updated));
      return updated;
    });
    // Also save the task config
    const config = {
      parameters: taskDef.parameters || {},
      inputs: taskDef.inputs || {},
      outputs: taskDef.outputs || {},
      rules: taskDef.rules || [],
      transforms: taskDef.transforms || [],
      rule_defaults: taskDef.rule_defaults || {},
      mode: taskDef.mode || 'continuous',
    };
    setTaskConfigs((prev) => ({ ...prev, [entry.name]: config }));
    setDirty(true);
  }, []);

  /**
   * Update an existing softioc entry.
   */
  const updateSoftioc = useCallback((name, updates) => {
    setValuesData((prev) => {
      const softiocs = prev.softiocs.map((s) =>
        s.name === name ? { ...s, ...updates } : s
      );
      const updated = { ...prev, softiocs };
      setValuesYaml(serializeValuesSoftiocs(updated));
      return updated;
    });
    setDirty(true);
  }, []);

  /**
   * Remove a softioc.
   */
  const removeSoftioc = useCallback((name) => {
    setValuesData((prev) => {
      const softiocs = prev.softiocs.filter((s) => s.name !== name);
      const updated = { ...prev, softiocs };
      setValuesYaml(serializeValuesSoftiocs(updated));
      return updated;
    });
    setTaskConfigs((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    if (selectedSoftioc === name) setSelectedSoftioc(null);
    setDirty(true);
  }, [selectedSoftioc]);

  /**
   * Update task config for a softioc.
   */
  const updateTaskConfig = useCallback((name, config) => {
    setTaskConfigs((prev) => ({ ...prev, [name]: config }));
    setDirty(true);
  }, []);

  /**
   * Update a specific link in a task's inputs or outputs.
   */
  const updateLink = useCallback((taskName, pvKey, direction, newLink) => {
    setTaskConfigs((prev) => {
      const config = prev[taskName];
      if (!config) return prev;
      const section = direction === 'input' ? 'inputs' : 'outputs';
      const pvDef = config[section]?.[pvKey];
      if (!pvDef) return prev;
      return {
        ...prev,
        [taskName]: {
          ...config,
          [section]: {
            ...config[section],
            [pvKey]: { ...pvDef, link: newLink },
          },
        },
      };
    });
    setDirty(true);
  }, []);

  /**
   * Get the full YAML for a specific task's config.yaml
   */
  const getTaskConfigYaml = useCallback((name) => {
    const config = taskConfigs[name];
    if (!config) return '';
    return generateConfigYaml({ name, ...config });
  }, [taskConfigs]);

  /**
   * Open the wizard with a template.
   */
  const openWizard = useCallback((template = null) => {
    setWizardTemplate(template);
    setEditingTask(null);
    setShowWizard(true);
  }, []);

  /**
   * Open the wizard to edit an existing task.
   */
  const editTask = useCallback((name) => {
    const softioc = valuesData.softiocs.find((s) => s.name === name);
    const config = taskConfigs[name];
    if (softioc && config) {
      setEditingTask({ ...softioc, ...config });
      setShowWizard(true);
    }
  }, [valuesData, taskConfigs]);

  const closeWizard = useCallback(() => {
    setShowWizard(false);
    setWizardTemplate(null);
    setEditingTask(null);
  }, []);

  /**
   * Get the current values-softiocs.yaml as string.
   */
  const getValuesYaml = useCallback(() => {
    return valuesYaml || serializeValuesSoftiocs(valuesData);
  }, [valuesYaml, valuesData]);

  return (
    <SoftIOCContext.Provider
      value={{
        // Data
        valuesData,
        valuesYaml,
        valuesLoaded,
        taskConfigs,
        dirty,

        // Git sync
        syncStatus,
        canSync,
        syncFromGit,
        repoInfo,
        gitBranch,

        // Selection
        selectedSoftioc,
        setSelectedSoftioc,

        // Wizard
        showWizard,
        wizardTemplate,
        editingTask,
        openWizard,
        editTask,
        closeWizard,

        // Actions
        importValues,
        importTaskConfig,
        addSoftioc,
        updateSoftioc,
        removeSoftioc,
        updateTaskConfig,
        updateLink,
        getTaskConfigYaml,
        getValuesYaml,
      }}
    >
      {children}
    </SoftIOCContext.Provider>
  );
}

export function useSoftIOC() {
  const ctx = useContext(SoftIOCContext);
  if (!ctx) throw new Error('useSoftIOC must be used within SoftIOCProvider');
  return ctx;
}
