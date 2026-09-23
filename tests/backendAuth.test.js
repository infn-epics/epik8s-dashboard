import { describe, it, expect } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { authorize, requiredCapability, requiredWsCapability, createAuth } from '../k8s-backend/auth.js';
import { parseGitRepo, allowedPrefixes, isAllowedGitUrl } from '../k8s-backend/git-relay.js';

const ISS = 'https://kc.example/realms/epik8s';

describe('authorize', () => {
  const op = { roles: ['pv.read', 'pv.write'], beamlines: ['btf'] };
  it('allows a role on the user\'s beamline', () => expect(authorize(op, 'pv.read', 'btf').ok).toBe(true));
  it('denies a role the user lacks', () => expect(authorize(op, 'ioc.control', 'btf').ok).toBe(false));
  it('denies another beamline', () => expect(authorize(op, 'pv.read', 'sparc').ok).toBe(false));
  it('denies a user with no beamlines / roles (deny by default)', () => {
    expect(authorize({}, 'pv.read', 'btf').ok).toBe(false);
    expect(authorize({ roles: ['pv.read'] }, 'pv.read', 'btf').ok).toBe(false);
  });
  it('platform.admin bypasses beamline check', () => expect(authorize({ roles: ['platform.admin'] }, 'ioc.control', 'btf').ok).toBe(true));
});

describe('requiredCapability', () => {
  it('reads need pv.read, k8s writes ioc.control', () => {
    expect(requiredCapability('GET', '/api/v1/pods')).toBe('pv.read');
    expect(requiredCapability('POST', '/api/v1/deployments/x/restart')).toBe('ioc.control');
    expect(requiredCapability('DELETE', '/api/v1/pods/x')).toBe('ioc.control');
  });
  it('git writes need config.edit but ticket creation only logbook.write', () => {
    const q = u => ({ url: u });
    expect(requiredCapability('PUT', '/api/v1/git/relay', q('https://api.github.com/repos/o/r/contents/a'))).toBe('config.edit');
    expect(requiredCapability('POST', '/api/v1/git/relay', q('https://api.github.com/repos/o/r/issues'))).toBe('logbook.write');
    expect(requiredCapability('GET', '/api/v1/git/relay', q('https://api.github.com/repos/o/r/contents/a'))).toBe('pv.read');
  });
  it('unknown non-api path has no rule', () => expect(requiredCapability('GET', '/other')).toBeNull());
  it('ws exec/attach are control, logs read', () => {
    expect(requiredWsCapability('/ws/pods/p/exec')).toBe('ioc.control');
    expect(requiredWsCapability('/ws/pods/p/logs')).toBe('pv.read');
  });
});

describe('token verification', () => {
  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' };
    const auth = createAuth({ issuer: ISS, beamline: 'btf', keyResolver: createLocalJWKSet({ keys: [jwk] }) });
    const sign = (claims, { aud = 'epik8s-services', iss = ISS, exp = '5m' } = {}) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setExpirationTime(exp).sign(privateKey);
    return { auth, sign };
  }
  function run(auth, req) {
    return new Promise(resolve => {
      const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
      auth.middleware({ method: 'GET', path: '/api/v1/pods', query: {}, headers: {}, ...req }, res, () => resolve({ code: 200 }));
    });
  }
  it('accepts a valid token', async () => {
    const { auth, sign } = await setup();
    const t = await sign({ roles: ['pv.read'], beamlines: ['btf'] });
    expect((await run(auth, { headers: { authorization: `Bearer ${t}` } })).code).toBe(200);
  });
  it('accepts X-Epik8s-Token', async () => {
    const { auth, sign } = await setup();
    const t = await sign({ roles: ['pv.read'], beamlines: ['btf'] });
    expect((await run(auth, { headers: { 'x-epik8s-token': t, authorization: 'Basic xxx' } })).code).toBe(200);
  });
  it('401 without token, wrong audience, wrong issuer or expired', async () => {
    const { auth, sign } = await setup();
    const c = { roles: ['pv.read'], beamlines: ['btf'] };
    expect((await run(auth, {})).code).toBe(401);
    for (const opts of [{ aud: 'other' }, { iss: 'https://evil/realms/x' }, { exp: Math.floor(Date.now() / 1000) - 60 }]) {
      const t = await sign(c, opts);
      expect((await run(auth, { headers: { authorization: `Bearer ${t}` } })).code).toBe(401);
    }
  });
  it('403 for the wrong beamline or missing capability', async () => {
    const { auth, sign } = await setup();
    const other = await sign({ roles: ['pv.read'], beamlines: ['sparc'] });
    expect((await run(auth, { headers: { authorization: `Bearer ${other}` } })).code).toBe(403);
    const viewer = await sign({ roles: ['pv.read'], beamlines: ['btf'] });
    expect((await run(auth, { method: 'POST', path: '/api/v1/pods/x/restart', headers: { authorization: `Bearer ${viewer}` } })).code).toBe(403);
  });
  it('healthz stays open', async () => {
    const { auth } = await setup();
    expect((await run(auth, { path: '/healthz' })).code).toBe(200);
  });
});

describe('git relay scope', () => {
  const gh = parseGitRepo('https://github.com/infn-epics/epik8s-btf.git');
  const gl = parseGitRepo('git@baltig.infn.it:epics-containers/epik8s-btf.git');
  it('parses both hosts', () => {
    expect(gh).toEqual({ platform: 'github', host: 'github.com', projectPath: 'infn-epics/epik8s-btf' });
    expect(gl.platform).toBe('gitlab');
  });
  it('allows only the beamline repo', () => {
    const p = allowedPrefixes(gh);
    expect(isAllowedGitUrl('https://api.github.com/repos/infn-epics/epik8s-btf/contents/x.yaml?ref=main', p)).toBe(true);
    expect(isAllowedGitUrl('https://api.github.com/repos/infn-epics/other/contents/x', p)).toBe(false);
    expect(isAllowedGitUrl('https://api.github.com/repos/infn-epics/epik8s-btf/../other/contents', p)).toBe(false);
    expect(isAllowedGitUrl('https://api.github.com/repos/infn-epics/epik8s-btf/%2e%2e/other', p)).toBe(false);
    expect(isAllowedGitUrl('https://evil.example/repos/infn-epics/epik8s-btf/', p)).toBe(false);
    const g = allowedPrefixes(gl);
    expect(isAllowedGitUrl('https://baltig.infn.it/api/v4/projects/epics-containers%2Fepik8s-btf/issues', g)).toBe(true);
    expect(isAllowedGitUrl('https://baltig.infn.it/api/v4/projects/epics-containers%2Fother/issues', g)).toBe(false);
  });
});
