import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitFileExists } from '../src/services/gitApi.js';

describe('gitFileExists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds a GitLab file by listing its parent directory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { name: 'values.yaml', path: 'deploy/values.yaml', type: 'blob' },
        { name: 'values-softiocs.yaml', path: 'deploy/values-softiocs.yaml', type: 'blob' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const exists = await gitFileExists(
      { platform: 'gitlab', host: 'baltig.infn.it', projectPath: 'lnf-da-control/epik8s-btf' },
      'deploy/values-softiocs.yaml',
      'main',
      'token',
    );

    expect(exists).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/repository/tree?path=deploy');
    expect(fetchMock.mock.calls[0][0]).not.toContain('/repository/files/');
    expect(fetchMock.mock.calls[0][1].headers['PRIVATE-TOKEN']).toBe('token');
  });

  it('returns false when an optional file is absent from the directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ name: 'values.yaml', path: 'deploy/values.yaml', type: 'blob' }],
    }));

    await expect(gitFileExists(
      { platform: 'gitlab', host: 'baltig.infn.it', projectPath: 'lnf-da-control/epik8s-btf' },
      'deploy/values-softiocs.yaml',
    )).resolves.toBe(false);
  });
});
