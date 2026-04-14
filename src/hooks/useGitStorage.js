/**
 * useGitStorage — hook that provides git-backed storage for layouts and dashboards.
 *
 * Wraps gitStorageService with the current app config and auth token.
 * Returns a gitStorage instance whenever a git repo is configured.
 * Public repositories can be read without authentication; write operations
 * still require a PAT.
 *
 *   const { gitStorage, canSync, canWrite } = useGitStorage();
 *   if (canSync) {
 *     const layouts = await gitStorage.listLayouts();
 *   }
 *   if (canWrite) {
 *     await gitStorage.saveLayout('sparc', data, 'Updated positions');
 *   }
 */
import { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { createGitStorageFromConfig } from '../services/gitStorageService.js';

export function useGitStorage() {
  const { config } = useApp();
  const { token } = useAuth();

  const gitStorage = useMemo(() => createGitStorageFromConfig(config, token || null), [config, token]);

  return {
    gitStorage,
    canSync: !!gitStorage,
    canWrite: !!gitStorage && !!token,
  };
}
