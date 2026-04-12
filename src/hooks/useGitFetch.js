/**
 * useGitFetch — hook that provides a `fetchFromGit(filePath)` function
 * bound to the beamline's git repository URL, branch, and current auth token.
 *
 * Any dashboard view can use this to read files from the beamline git repo:
 *
 *   const { fetchFromGit, canFetch } = useGitFetch();
 *   const content = await fetchFromGit('deploy/values-softiocs.yaml');
 *
 * Works for public repos without a token. Private repos require the user
 * to log in with a personal access token via the Auth panel.
 */
import { useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { parseGitUrl, fetchFileFromGit } from '../services/gitApi.js';

/**
 * @returns {{
 *   fetchFromGit: (filePath: string) => Promise<string>,
 *   canFetch: boolean,
 *   repoInfo: Object|null,
 *   branch: string,
 * }}
 */
export function useGitFetch() {
  const { config } = useApp();
  const { token, repoInfo: authRepoInfo } = useAuth();

  // authRepoInfo is populated after successful login; fall back to config.giturl
  // so public repos work even without authentication
  const repoInfo = authRepoInfo || (config?.giturl ? parseGitUrl(config.giturl) : null);
  const branch = config?.gitrev || 'main';
  const canFetch = !!repoInfo;

  const fetchFromGit = useCallback(
    (filePath) => {
      if (!repoInfo) return Promise.reject(new Error('No git repository configured'));
      return fetchFileFromGit(repoInfo, filePath, branch, token || null);
    },
    [repoInfo, branch, token],
  );

  return { fetchFromGit, canFetch, repoInfo, branch };
}
