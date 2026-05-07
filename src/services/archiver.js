/**
 * EPICS Archiver Appliance REST client.
 *
 * Retrieves historical PV data from an EPICS Archiver Appliance instance.
 * API docs: https://slacmshanern.github.io/epicsarchiverap/userguide.html
 */

const DEFAULT_FETCH_LIMIT = 1000;

export default class ArchiverClient {
  /**
   * @param {string} baseUrl - Archiver base URL, e.g. "https://archiver.example.com"
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this._cache = new Map();
  }

  _mgmtUrl(action, params = null) {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    return `${this.baseUrl}/mgmt/bpl/${action}${qs}`;
  }

  async _mgmtJson(action, params = null, options = null) {
    const resp = await fetch(this._mgmtUrl(action, params), options || undefined);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Fetch archived data for a PV over a time range.
   * @param {string} pv - PV name
   * @param {Date|string} from - Start time
   * @param {Date|string} to - End time (default: now)
   * @param {number} limit - Max samples (default 1000)
   * @returns {Promise<Array<{timestamp: number, value: number, severity: number}>>}
   */
  async fetchData(pv, from, to = new Date(), limit = DEFAULT_FETCH_LIMIT) {
    const fromISO = from instanceof Date ? from.toISOString() : from;
    const toISO = to instanceof Date ? to.toISOString() : to;

    const cacheKey = `${pv}|${fromISO}|${toISO}|${limit}`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

    const url = `${this.baseUrl}/retrieval/data/getData.json?pv=${encodeURIComponent(pv)}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}&limit=${limit}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Archiver fetch failed: ${resp.status} ${resp.statusText}`);

    const json = await resp.json();
    const samples = (json[0]?.data || []).map((d) => ({
      timestamp: d.secs * 1000 + (d.nanos || 0) / 1e6,
      value: d.val,
      severity: d.severity || 0,
      status: d.status || 0,
    }));

    this._cache.set(cacheKey, samples);
    // Evict old cache entries
    if (this._cache.size > 100) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }

    return samples;
  }

  /**
   * Search for PV names matching a pattern.
   * @param {string} pattern - Glob or regex pattern
   * @returns {Promise<string[]>}
   */
  async searchPVs(pattern) {
    try {
      return await this._mgmtJson('getMatchingPVsForThisAppliance', { pv: pattern, limit: '100' });
    } catch {
      return [];
    }
  }

  /**
   * Check if a PV is being archived.
   * @param {string} pv
   * @returns {Promise<boolean>}
   */
  async isPVArchived(pv) {
    let data;
    try {
      data = await this._mgmtJson('getPVStatus', { pv });
    } catch {
      return false;
    }
    return data.length > 0 && data[0].status === 'Being archived';
  }

  async getApplianceInfo() {
    return this._mgmtJson('getApplianceInfo');
  }

  async getApplianceMetrics() {
    const data = await this._mgmtJson('getApplianceMetrics');
    return Array.isArray(data) ? (data[0] || {}) : data;
  }

  async getCurrentlyDisconnectedPVs() {
    const data = await this._mgmtJson('getCurrentlyDisconnectedPVs');
    return Array.isArray(data) ? data : [];
  }

  async getPausedPVsForThisAppliance() {
    const data = await this._mgmtJson('getPausedPVsForThisAppliance');
    return Array.isArray(data) ? data : [];
  }

  async getPVStatus(pv) {
    if (!pv) return [];
    const data = await this._mgmtJson('getPVStatus', { pv });
    return Array.isArray(data) ? data : [];
  }

  async archivePV(pv) {
    return this._mgmtJson('archivePV', { pv });
  }

  async pauseArchivingPV(pv) {
    return this._mgmtJson('pauseArchivingPV', { pv });
  }

  async resumeArchivingPV(pv) {
    return this._mgmtJson('resumeArchivingPV', { pv });
  }

  async disableArchivingPV(pv) {
    return this._mgmtJson('abortArchivingPV', { pv });
  }

  /** Clear the data cache. */
  clearCache() {
    this._cache.clear();
  }
}
