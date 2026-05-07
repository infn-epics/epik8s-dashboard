import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';

function metricNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function MetricCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`ops-arch-metric ops-arch-metric--${tone}`}>
      <span className="ops-arch-metric-label">{label}</span>
      <span className="ops-arch-metric-value">{value}</span>
    </div>
  );
}

export default function OpsArchiverView() {
  const { archiverClient, dataSources } = useApp();
  const archiverUrl = archiverClient?.baseUrl || dataSources?.archiverUrl || '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const [info, setInfo] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [disconnectedPvs, setDisconnectedPvs] = useState([]);
  const [pausedPvs, setPausedPvs] = useState([]);

  const [pvName, setPvName] = useState('');
  const [pvStatus, setPvStatus] = useState([]);
  const [pvBusy, setPvBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!archiverClient) {
      setError('Archiver URL is not configured');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [applianceInfo, applianceMetrics, disconnected, paused] = await Promise.all([
        archiverClient.getApplianceInfo(),
        archiverClient.getApplianceMetrics(),
        archiverClient.getCurrentlyDisconnectedPVs(),
        archiverClient.getPausedPVsForThisAppliance(),
      ]);
      setInfo(applianceInfo || null);
      setMetrics(applianceMetrics || {});
      setDisconnectedPvs(Array.isArray(disconnected) ? disconnected : []);
      setPausedPvs(Array.isArray(paused) ? paused : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load archiver status');
    } finally {
      setLoading(false);
    }
  }, [archiverClient]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const connectedCount = metricNumber(metrics.connectedPVCount);
  const disconnectedCount = disconnectedPvs.length;
  const totalPvCount = metricNumber(metrics.pvCount, connectedCount + disconnectedCount);
  const pausedCount = pausedPvs.length;

  const disconnectedAlarm = disconnectedCount > connectedCount;

  const eventRate = metrics.eventRate || 'N/A';
  const dataRatePerDay = metrics.dataRateGBPerDay || 'N/A';

  const submitPvAction = useCallback(async (action, successLabel) => {
    const pv = pvName.trim();
    if (!pv) {
      setActionStatus('Please enter a PV name');
      return;
    }
    if (!archiverClient) {
      setActionStatus('Archiver URL is not configured');
      return;
    }

    setPvBusy(true);
    setActionStatus('');
    try {
      await action(pv);
      setActionStatus(`${successLabel}: ${pv}`);
      const status = await archiverClient.getPVStatus(pv);
      setPvStatus(status);
      refresh();
    } catch (err) {
      setActionStatus(`Action failed: ${err.message}`);
    } finally {
      setPvBusy(false);
    }
  }, [archiverClient, pvName, refresh]);

  const queryPvStatus = useCallback(async () => {
    const pv = pvName.trim();
    if (!pv) {
      setActionStatus('Please enter a PV name');
      return;
    }
    if (!archiverClient) {
      setActionStatus('Archiver URL is not configured');
      return;
    }

    setPvBusy(true);
    setActionStatus('');
    try {
      const status = await archiverClient.getPVStatus(pv);
      setPvStatus(status);
      setActionStatus(status.length ? `Status loaded for ${pv}` : `No archiver status for ${pv}`);
    } catch (err) {
      setActionStatus(`Status query failed: ${err.message}`);
    } finally {
      setPvBusy(false);
    }
  }, [archiverClient, pvName]);

  const shownDisconnected = useMemo(() => disconnectedPvs.slice(0, 100), [disconnectedPvs]);

  return (
    <div className="ops-arch-view">
      <div className="view-toolbar">
        <span className="view-toolbar-title">🗄 EPICS Archiver</span>
        <div className="toolbar-controls">
          <button className="toolbar-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="ops-arch-topline">
        <span className={`ops-arch-health ${archiverUrl ? 'ok' : 'err'}`}>
          {archiverUrl ? `Connected to ${archiverUrl}` : 'Archiver URL not configured'}
        </span>
        {lastUpdated && (
          <span className="ops-arch-updated">Updated: {lastUpdated.toLocaleTimeString()}</span>
        )}
      </div>

      {error && <div className="ops-arch-error">{error}</div>}

      {disconnectedAlarm && (
        <div className="ops-arch-alarm">
          ALARM: disconnected PVs ({disconnectedCount}) are greater than connected PVs ({connectedCount}).
        </div>
      )}

      <div className="ops-arch-metrics-grid">
        <MetricCard label="Total PVs" value={totalPvCount} />
        <MetricCard label="Connected PVs" value={connectedCount} tone="ok" />
        <MetricCard label="Disconnected PVs" value={disconnectedCount} tone={disconnectedAlarm ? 'err' : 'warn'} />
        <MetricCard label="Paused PVs" value={pausedCount} tone={pausedCount > 0 ? 'warn' : 'neutral'} />
        <MetricCard label="Event rate" value={eventRate} />
        <MetricCard label="Data rate (GB/day)" value={dataRatePerDay} />
      </div>

      <div className="ops-arch-panel">
        <h3>PV Archiving Control</h3>
        <div className="ops-arch-pv-row">
          <input
            className="ops-arch-pv-input"
            type="text"
            value={pvName}
            onChange={(e) => setPvName(e.target.value)}
            placeholder="PV name, e.g. SPARC:VAC:MIDIVAC:UN1SIP01:PRES_RB"
          />
          <button className="toolbar-btn" disabled={pvBusy} onClick={queryPvStatus}>Query status</button>
          <button className="toolbar-btn active" disabled={pvBusy} onClick={() => submitPvAction((pv) => archiverClient.archivePV(pv), 'Enable archiving')}>Enable</button>
          <button className="toolbar-btn" disabled={pvBusy} onClick={() => submitPvAction((pv) => archiverClient.pauseArchivingPV(pv), 'Pause archiving')}>Pause</button>
          <button className="toolbar-btn" disabled={pvBusy} onClick={() => submitPvAction((pv) => archiverClient.resumeArchivingPV(pv), 'Resume archiving')}>Resume</button>
          <button className="toolbar-btn" disabled={pvBusy} onClick={() => submitPvAction((pv) => archiverClient.disableArchivingPV(pv), 'Disable archiving')}>Disable</button>
        </div>
        {actionStatus && <div className="ops-arch-action">{actionStatus}</div>}

        {pvStatus.length > 0 && (
          <div className="ops-arch-status-table-wrap">
            <table className="ops-arch-table">
              <thead>
                <tr>
                  <th>PV</th>
                  <th>Status</th>
                  <th>Appliance</th>
                  <th>Sampling</th>
                </tr>
              </thead>
              <tbody>
                {pvStatus.map((row) => (
                  <tr key={`${row.pvName}-${row.appliance}`}> 
                    <td className="ops-arch-mono">{row.pvName}</td>
                    <td>{row.status || 'N/A'}</td>
                    <td>{row.appliance || 'N/A'}</td>
                    <td>{row.samplingMethod || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ops-arch-split">
        <div className="ops-arch-panel">
          <h3>Currently Disconnected PVs ({disconnectedCount})</h3>
          <div className="ops-arch-status-table-wrap">
            <table className="ops-arch-table">
              <thead>
                <tr>
                  <th>PV</th>
                  <th>Host</th>
                  <th>Lost At</th>
                </tr>
              </thead>
              <tbody>
                {shownDisconnected.length === 0 && (
                  <tr>
                    <td colSpan={3}>No disconnected PVs</td>
                  </tr>
                )}
                {shownDisconnected.map((row) => (
                  <tr key={`${row.pvName}-${row.connectionLostAt || row.noConnectionAsOfEpochSecs || ''}`}>
                    <td className="ops-arch-mono">{row.pvName}</td>
                    <td>{row.hostName || 'N/A'}</td>
                    <td>{row.connectionLostAt || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {disconnectedPvs.length > shownDisconnected.length && (
            <div className="ops-arch-note">Showing first {shownDisconnected.length} disconnected PVs.</div>
          )}
        </div>

        <div className="ops-arch-panel">
          <h3>Paused PVs ({pausedCount})</h3>
          <div className="ops-arch-status-table-wrap">
            <table className="ops-arch-table">
              <thead>
                <tr>
                  <th>PV</th>
                </tr>
              </thead>
              <tbody>
                {pausedPvs.length === 0 && (
                  <tr>
                    <td>No paused PVs</td>
                  </tr>
                )}
                {pausedPvs.map((pv) => (
                  <tr key={pv}>
                    <td className="ops-arch-mono">{pv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {info && (
        <div className="ops-arch-note">
          Appliance: {info.identity || 'N/A'} | Version: {info.version || 'N/A'} | Retrieval: {info.dataRetrievalURL || 'N/A'}
        </div>
      )}
    </div>
  );
}
