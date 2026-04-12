import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';

/**
 * Probe an HTTPS URL.
 * Returns { url, ok, certError }
 *  - ok=true:        reachable
 *  - certError=true: fetch threw TypeError while browser is online → likely cert issue
 *  - ok=false:       network down or other
 */
async function probeUrl(url) {
  if (!url || !url.startsWith('https://')) return null;
  try {
    await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(5000) });
    return { url, ok: true, certError: false };
  } catch {
    // TypeError with navigator.onLine → almost certainly a cert rejection
    if (navigator.onLine) {
      return { url, ok: false, certError: true };
    }
    return { url, ok: false, certError: false };
  }
}

/**
 * Collect all known HTTPS service endpoints from the YAML config.
 * Always builds https:// URLs regardless of how the dashboard itself is served.
 */
function collectEndpoints(config) {
  const endpoints = [];
  const ns = config?.namespace || '';
  const domain = config?.epik8namespace || '';
  if (!ns || !domain) return endpoints;

  // K8s Backend
  endpoints.push({ label: 'K8s Backend', url: `https://${ns}-backend.${domain}/healthz` });

  // ChannelFinder
  const services = config?.epicsConfiguration?.services || {};
  const cf = services.channelfinder || {};
  if (cf.url) {
    endpoints.push({ label: 'ChannelFinder', url: cf.url.replace(/^http:/, 'https:') });
  } else {
    endpoints.push({ label: 'ChannelFinder', url: `https://${ns}-channelfinder.${domain}/ChannelFinder` });
  }

  // Archiver
  const archiver = services.archiver || {};
  const archiverHost = archiver.host || `${ns}-archiver.${domain}`;
  endpoints.push({ label: 'Archiver', url: `https://${archiverHost}` });

  return endpoints;
}

const DISMISSED_KEY = 'epik8s-cert-dismissed';

/**
 * CertWarningBanner — probes HTTPS backend endpoints on mount.
 * If any fail with what looks like a certificate error, shows a dismissible
 * banner with direct links for the user to open and accept each certificate.
 */
export default function CertWarningBanner() {
  const { config } = useApp();
  const [failures, setFailures] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || 'false'); } catch { return false; }
  });

  useEffect(() => {
    if (!config || dismissed) return;
    const endpoints = collectEndpoints(config);
    if (endpoints.length === 0) return;

    let cancelled = false;
    Promise.all(endpoints.map(async (ep) => {
      const result = await probeUrl(ep.url);
      return result?.certError ? ep : null;
    })).then((results) => {
      if (!cancelled) {
        setFailures(results.filter(Boolean));
      }
    });
    return () => { cancelled = true; };
  }, [config, dismissed]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  }, []);

  if (dismissed || failures.length === 0) return null;

  return (
    <div className="cert-banner">
      <div className="cert-banner-icon">⚠️</div>
      <div className="cert-banner-body">
        <strong>Certificate not trusted</strong> — Your browser rejected the TLS certificate for{' '}
        {failures.length === 1 ? 'this service' : 'these services'}. Click each link below to open it and accept the certificate, then reload the dashboard.
        <ul className="cert-banner-links">
          {failures.map((f) => (
            <li key={f.url}>
              <a href={f.url} target="_blank" rel="noopener noreferrer">{f.label}</a>
              <span className="cert-banner-url">{f.url}</span>
            </li>
          ))}
        </ul>
      </div>
      <button className="cert-banner-close" onClick={dismiss} title="Dismiss for this session">✕</button>
    </div>
  );
}
