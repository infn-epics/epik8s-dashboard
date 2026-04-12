/**
 * SoftIOCVisualizer — Live view of running softiocs with their PV controls.
 *
 * For each softioc:
 *  - System PVs: ENABLE, STATUS, MESSAGE, VERSION, CYCLE_COUNT/RUN
 *  - User inputs with live values (wired inputs show link source)
 *  - User outputs with live values (wired outputs show link target)
 *  - Expandable detail panel
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useSoftIOC } from '../../context/SoftIOCContext.jsx';
import { usePv } from '../../hooks/usePv.js';
import { getSystemPvs, statusLabel, statusColor, buildPvName } from '../../services/softiocApi.js';

/* ── Single PV row with live value + optional live linked-PV value ── */
function PvRow({ client, pvName, label, type, writable, link, linkDirection, linkPva }) {
  const pv = usePv(client, pvName);
  const value = pv?.value ?? '—';
  const severity = pv?.severity ?? -1;

  // Linked PVs: use pva:// prefix only when the config says pva: true for links
  const resolvedLink = link ? (linkPva ? `pva://${link}` : link) : null;
  const linkPv = usePv(client, resolvedLink);
  const linkValue = linkPv?.value;

  const severityClass =
    severity === 0 ? 'pv-ok' :
    severity === 1 ? 'pv-minor' :
    severity === 2 ? 'pv-major' :
    severity === 3 ? 'pv-invalid' : '';

  return (
    <div className={`sioc-pv-live-row ${severityClass}`} title={`PV: ${pvName}`}>
      <span className="sioc-pv-label">{label}</span>
      <span className={`sioc-pv-value ${writable ? 'writable' : ''}`}>
        {type === 'bool' ? (
          <><span className={`sioc-led ${Number(value) ? 'on' : 'off'}`} /> {Number(value) ? 'ON' : 'OFF'}</>
        ) : (
          String(value)
        )}
      </span>
      {link && (
        <span className="sioc-pv-link-badge" title={`${linkDirection === 'in' ? '← reads' : '→ writes'} ${link}`}>
          {linkDirection === 'in' ? '←' : '→'} <code>{link}</code>
          {linkValue !== undefined && linkValue !== null
            ? <span className="sioc-link-live-val"> = {String(linkValue)}</span>
            : <span className="sioc-link-no-val"> (no data)</span>}
        </span>
      )}
    </div>
  );
}

/* ── System PV row — shows expanded PV name on hover ── */
function SystemPvRow({ client, pv }) {
  const msg = usePv(client, pv.name);
  const value = msg?.value ?? '—';

  if (pv.key === 'STATUS') {
    const label = typeof value === 'number' ? statusLabel(value) : String(value);
    const color = typeof value === 'number' ? statusColor(value) : '#6c757d';
    return (
      <div className="sioc-pv-live-row" title={`PV: ${pv.name}`}>
        <span className="sioc-pv-label">{pv.key}</span>
        <span className="sioc-status-badge" style={{ backgroundColor: color }}>{label}</span>
      </div>
    );
  }

  if (pv.key === 'ENABLE') {
    return (
      <div className="sioc-pv-live-row" title={`PV: ${pv.name}`}>
        <span className="sioc-pv-label">{pv.key}</span>
        <span className={`sioc-led ${Number(value) ? 'on' : 'off'}`} />
        <span className="sioc-pv-value">{Number(value) ? 'Enabled' : 'Disabled'}</span>
      </div>
    );
  }

  return (
    <div className="sioc-pv-live-row" title={`PV: ${pv.name}`}>
      <span className="sioc-pv-label">{pv.key}</span>
      <span className="sioc-pv-value">{String(value)}</span>
    </div>
  );
}

/* ── SoftIOC card with expandable detail ── */
function SoftIOCCard({ softioc, config, onEditLinks }) {
  const { pvwsClient } = useApp();
  const [expanded, setExpanded] = useState(false);

  const prefix = softioc.iocprefix || softioc.name?.toUpperCase?.() || '';
  const mode = config?.mode || config?.parameters?.mode || 'continuous';
  // SoftIOC's own PVs are always published via pvAccess → always pva:// prefix.
  // The config `pva` flag controls whether *linked* (external) PVs use PVA or CA.
  const linksPva = config?.parameters?.pva === true;
  const pvPrefix = (name) => `pva://${name}`;
  const systemPvs = useMemo(
    () => getSystemPvs(prefix, mode).map((pv) => ({ ...pv, name: `pva://${pv.name}` })),
    [prefix, mode],
  );

  const inputs = config?.inputs || {};
  const outputs = config?.outputs || {};
  const rules = config?.rules || [];

  // STATUS PV for card header color
  const statusPv = usePv(pvwsClient, `pva://${prefix}:STATUS`);
  const statusVal = statusPv?.value;
  const headerColor = typeof statusVal === 'number' ? statusColor(statusVal) : 'var(--border)';

  return (
    <div className="sioc-card">
      <div className="sioc-card-header" style={{ borderLeftColor: headerColor }}
        onClick={() => setExpanded(!expanded)}>
        <div className="sioc-card-title">
          <strong>{softioc.name}</strong>
          <span className="sioc-card-prefix">{prefix}</span>
        </div>
        <div className="sioc-card-meta">
          {softioc.description && <span className="sioc-card-desc">{softioc.description}</span>}
          <span className="sioc-card-mode">{mode}</span>
        </div>
        <span className="sioc-card-expand">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="sioc-card-body">
          {/* System PVs */}
          <div className="sioc-card-section">
            <h4>System</h4>
            {systemPvs.map((pv) => (
              <SystemPvRow key={pv.key} client={pvwsClient} pv={pv} />
            ))}
          </div>

          {/* Inputs */}
          {Object.keys(inputs).length > 0 && (
            <div className="sioc-card-section">
              <h4>Inputs ({Object.keys(inputs).length})</h4>
              {Object.entries(inputs).map(([key, spec]) => (
                <PvRow key={key} client={pvwsClient}
                  pvName={pvPrefix(buildPvName(prefix, key))}
                  label={key} type={spec.type}
                  writable={!spec.link}
                  link={spec.link} linkDirection="in" linkPva={linksPva} />
              ))}
            </div>
          )}

          {/* Outputs */}
          {Object.keys(outputs).length > 0 && (
            <div className="sioc-card-section">
              <h4>Outputs ({Object.keys(outputs).length})</h4>
              {Object.entries(outputs).map(([key, spec]) => (
                <PvRow key={key} client={pvwsClient}
                  pvName={pvPrefix(buildPvName(prefix, key))}
                  label={key} type={spec.type}
                  writable={false}
                  link={spec.link} linkDirection="out" linkPva={linksPva} />
              ))}
            </div>
          )}

          {/* Rules summary */}
          {rules.length > 0 && (
            <div className="sioc-card-section">
              <h4>Rules ({rules.length})</h4>
              {rules.map((rule, idx) => (
                <div key={idx} className="sioc-rule-summary">
                  <span className="sioc-rule-id">{rule.id}</span>
                  <span className="sioc-rule-condition">{rule.condition}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="sioc-card-actions">
            <button className="btn btn-sm btn-secondary" onClick={() => onEditLinks?.(softioc.name)}>
              🔗 Edit Links
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Visualizer ── */
export default function SoftIOCVisualizer({ onEditLinks }) {
  const { valuesData, taskConfigs } = useSoftIOC();
  const softiocs = valuesData.softiocs || [];

  if (softiocs.length === 0) {
    return (
      <div className="sioc-empty-state">
        <h3>No SoftIOCs configured</h3>
        <p>Import a values-softiocs.yaml or create a new softioc with the wizard.</p>
      </div>
    );
  }

  return (
    <div className="sioc-visualizer">
      {softiocs.map((s) => (
        <SoftIOCCard
          key={s.name}
          softioc={s}
          config={taskConfigs[s.name]}
          onEditLinks={onEditLinks}
        />
      ))}
    </div>
  );
}
