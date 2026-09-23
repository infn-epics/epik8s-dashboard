import { describe, it, expect } from 'vitest';
import { resolveOidcConfig, dashboardRole, userFromClaims, decodeJwt, pkceChallenge } from '../src/services/oidc.js';

describe('resolveOidcConfig', () => {
  it('derives the issuer from the dashboard hostname', () => {
    expect(resolveOidcConfig({ hostname: 'btf-dashboard.k8sda.lnf.infn.it' })).toEqual({
      issuer: 'https://keycloak.k8sda.lnf.infn.it/realms/epik8s', clientId: 'epik8s-dashboard',
    });
  });
  it('explicit ?oidc= wins, ?oidc=off disables', () => {
    expect(resolveOidcConfig({ search: '?oidc=https://kc/realms/x/', hostname: 'btf-dashboard.a.b' }).issuer).toBe('https://kc/realms/x');
    expect(resolveOidcConfig({ search: '?oidc=off', hostname: 'btf-dashboard.a.b' })).toBeNull();
  });
  it('is off on an unknown host with no config (legacy PAT login)', () => {
    expect(resolveOidcConfig({ hostname: 'localhost' })).toBeNull();
  });
});

describe('roles', () => {
  it('maps capability roles to dashboard levels', () => {
    expect(dashboardRole(['pv.read', 'logbook.read'])).toBe('viewer');
    expect(dashboardRole(['pv.read', 'pv.write'])).toBe('operator');
    expect(dashboardRole(['pv.write', 'ioc.control'])).toBe('expert');
    expect(dashboardRole(['config.edit'])).toBe('expert');
    expect(dashboardRole(['platform.admin', 'pv.write'])).toBe('admin');
    expect(dashboardRole([])).toBe('viewer');
  });
  it('builds a user from claims', () => {
    const u = userFromClaims({ sub: 's', preferred_username: 'ann', name: 'Ann', roles: ['pv.write'], beamlines: ['btf'] });
    expect(u).toMatchObject({ login: 'ann', name: 'Ann', role: 'operator', beamlines: ['btf'] });
  });
  it('decodes a JWT payload and tolerates junk', () => {
    const p = btoa(JSON.stringify({ sub: 'x' })).replace(/=+$/, '');
    expect(decodeJwt(`h.${p}.s`).sub).toBe('x');
    expect(decodeJwt('nope')).toBeNull();
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 test vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
