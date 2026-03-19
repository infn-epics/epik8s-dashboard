import { useState, useMemo } from 'react';

/**
 * SearchFilter - Filter control panel for devices.
 *
 * Props:
 *  - devices: full device list
 *  - onFilter: callback receiving filtered device list
 *  - showFamilyFilter: show family dropdown
 *  - showTypeFilter: show type dropdown
 *  - showZoneFilter: show zone dropdown
 */
export default function SearchFilter({
  devices,
  onFilter,
  showFamilyFilter = true,
  showTypeFilter = true,
  showZoneFilter = true,
}) {
  const [search, setSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');

  const families = useMemo(() => [...new Set(devices.map((d) => d.family).filter(Boolean))].sort(), [devices]);
  const types = useMemo(() => [...new Set(devices.map((d) => d.type).filter(Boolean))].sort(), [devices]);
  const zones = useMemo(() => [...new Set(devices.map((d) => d.zone).filter(Boolean))].sort(), [devices]);

  const filtered = useMemo(() => {
    let result = devices;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.pvPrefix.toLowerCase().includes(q) ||
          d.iocName.toLowerCase().includes(q),
      );
    }
    if (familyFilter) result = result.filter((d) => d.family === familyFilter);
    if (typeFilter) result = result.filter((d) => d.type === typeFilter);
    if (zoneFilter) result = result.filter((d) => d.zone === zoneFilter);
    return result;
  }, [devices, search, familyFilter, typeFilter, zoneFilter]);

  // Notify parent of filter changes
  useMemo(() => {
    onFilter(filtered);
  }, [filtered, onFilter]);

  return (
    <div className="search-filter">
      <input
        type="text"
        className="search-input"
        placeholder="Search devices…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {showFamilyFilter && families.length > 1 && (
        <select
          className="filter-select"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        >
          <option value="">All families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      {showTypeFilter && types.length > 1 && (
        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {showZoneFilter && zones.length > 1 && (
        <select
          className="filter-select"
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
        >
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      )}
      <span className="filter-count">{filtered.length} / {devices.length}</span>
    </div>
  );
}
