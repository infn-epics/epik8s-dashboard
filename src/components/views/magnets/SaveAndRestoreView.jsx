import { useState } from 'react';
import {
  createConfiguration, createFolder, deleteNodes, getChildren, getConfiguration,
  getSaveAndRestoreUrl, getSaveAndRestoreUser, getSnapshotItems, isSaveAndRestoreLoggedIn,
  login, logoutSaveAndRestore, searchNodes, takeSnapshot, updateConfiguration, updateNode,
  updateSnapshot, vTypeText, withVTypeValue,
} from '../../../services/saveAndRestoreApi.js';
import { ProcedureFrame, StatusBox } from './MagnetParts.jsx';

const NODE_ICON = { FOLDER: '📁', CONFIGURATION: '🗂', SNAPSHOT: '📸', COMPOSITE_SNAPSHOT: '🗃' };

function formatDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

/** Small inline "username / password / Login" form, or a "Logged in as X · Logout" line. */
function LoginBar({ user, onChange }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) {
    return (
      <div className="sar-login">
        <span>Logged in to save-and-restore as <strong>{user}</strong></span>
        <button type="button" className="mag-proc-btn" onClick={() => { logoutSaveAndRestore(); onChange(); }}>
          Logout
        </button>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      setPassword('');
      onChange();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sar-login" onSubmit={submit}>
      <span>Not logged in (read-only)</span>
      <input className="mag-proc-input" placeholder="username" autoComplete="username"
        value={username} onChange={(e) => setUsername(e.target.value)} />
      <input className="mag-proc-input" type="password" placeholder="password" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="mag-proc-btn" disabled={busy || !username || !password}>
        {busy ? 'Logging in...' : 'Login'}
      </button>
      {error && <span className="sar-login-error">{error}</span>}
    </form>
  );
}

/** New folder / new configuration form, shown under the currently open folder. */
function CreateForm({ kind, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pvName, setPvName] = useState('');
  const [pvs, setPvs] = useState([]); // configuration only: [{ pvName, readbackPvName }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addPv = () => {
    const trimmed = pvName.trim();
    if (!trimmed) return;
    setPvs((p) => [...p, { pvName: trimmed, readbackPvName: '' }]);
    setPvName('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim(), description.trim(), pvs);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sar-create" onSubmit={submit}>
      <div className="mag-proc-toolbar">
        <input className="mag-proc-input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="mag-proc-input" style={{ flex: 1 }} placeholder="description (optional)"
          value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {kind === 'CONFIGURATION' && (
        <>
          <div className="mag-proc-toolbar">
            <input className="mag-proc-input" style={{ flex: 1 }} placeholder="PV name, e.g. BTF:MAG:EEI:QUATB201:CURRENT_SP"
              value={pvName} onChange={(e) => setPvName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPv(); } }} />
            <button type="button" className="mag-proc-btn" onClick={addPv}>Add PV</button>
          </div>
          {pvs.length > 0 && (
            <ul className="sar-pv-list">
              {pvs.map((p, i) => (
                <li key={p.pvName}>
                  <span>{p.pvName}</span>
                  <button type="button" className="mag-proc-btn mag-proc-btn--sm"
                    onClick={() => setPvs((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <div className="mag-proc-status mag-proc-status--error">{error}</div>}
      <div className="mag-proc-toolbar">
        <button type="submit" className="mag-proc-btn mag-proc-btn--primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating...' : `Create ${kind === 'FOLDER' ? 'folder' : 'configuration'}`}
        </button>
        <button type="button" className="mag-proc-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Right-pane editor for a CONFIGURATION: its PV list, plus "take a snapshot now". */
function ConfigurationPanel({ node, pvList, loggedIn, onSaved, onSnapshotTaken }) {
  const [rows, setRows] = useState(pvList);
  const [pvName, setPvName] = useState('');
  const [snapName, setSnapName] = useState('');
  const [snapComment, setSnapComment] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const addPv = () => {
    const trimmed = pvName.trim();
    if (!trimmed) return;
    setRows((r) => [...r, { pvName: trimmed, readbackPvName: '' }]);
    setPvName('');
  };

  const save = async () => {
    setBusy('Saving...');
    setMessage(null);
    try {
      await updateConfiguration(node, rows);
      setMessage({ tone: 'ok', text: 'Configuration saved.' });
      onSaved?.(rows);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || String(err) });
    } finally {
      setBusy('');
    }
  };

  const snapshot = async () => {
    if (!snapName.trim()) {
      setMessage({ tone: 'warn', text: 'Enter a name for the new snapshot.' });
      return;
    }
    setBusy('Capturing live values...');
    setMessage(null);
    try {
      const snap = await takeSnapshot(node.uniqueId, snapName.trim(), snapComment.trim());
      setSnapName('');
      setSnapComment('');
      setMessage({ tone: 'ok', text: `Snapshot "${snap.snapshotNode?.name}" saved.` });
      onSnapshotTaken?.();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || String(err) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="sar-panel">
      <h3>{NODE_ICON.CONFIGURATION} {node.name}</h3>
      {node.description && <p className="mag-proc-empty">{node.description}</p>}

      <table className="mag-proc-table">
        <thead><tr><th>PV name</th><th>Readback PV</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.pvName}</td>
              <td>
                <input className="mag-proc-input" style={{ width: '100%' }} value={r.readbackPvName || ''}
                  disabled={!loggedIn}
                  onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, readbackPvName: e.target.value } : x)))} />
              </td>
              <td>
                <button type="button" className="mag-proc-btn mag-proc-btn--sm" disabled={!loggedIn}
                  onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mag-proc-toolbar">
        <input className="mag-proc-input" style={{ flex: 1 }} placeholder="add PV name..." value={pvName}
          disabled={!loggedIn} onChange={(e) => setPvName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPv(); } }} />
        <button type="button" className="mag-proc-btn" disabled={!loggedIn} onClick={addPv}>Add PV</button>
        <button type="button" className="mag-proc-btn mag-proc-btn--primary" disabled={!loggedIn || !!busy} onClick={save}>
          Save configuration
        </button>
      </div>

      <h4>Take a snapshot now</h4>
      <p className="mag-proc-empty">Captures the live value of every PV above, read directly by save-and-restore.</p>
      <div className="mag-proc-toolbar">
        <input className="mag-proc-input" placeholder="snapshot name" value={snapName}
          disabled={!loggedIn} onChange={(e) => setSnapName(e.target.value)} />
        <input className="mag-proc-input" style={{ flex: 1 }} placeholder="comment (optional)" value={snapComment}
          disabled={!loggedIn} onChange={(e) => setSnapComment(e.target.value)} />
        <button type="button" className="mag-proc-btn mag-proc-btn--primary" disabled={!loggedIn || !!busy} onClick={snapshot}>
          Take snapshot
        </button>
      </div>

      <StatusBox message={message} busy={busy} />
    </div>
  );
}

/** Right-pane editor for a SNAPSHOT: its captured values, editable and re-savable. */
function SnapshotPanel({ node, items, loggedIn, onSaved }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const save = async () => {
    setBusy('Saving...');
    setMessage(null);
    try {
      await updateSnapshot(node, rows);
      setMessage({ tone: 'ok', text: 'Snapshot saved.' });
      onSaved?.(rows);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || String(err) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="sar-panel">
      <h3>{NODE_ICON.SNAPSHOT} {node.name}</h3>
      {node.description && <p className="mag-proc-empty">{node.description}</p>}

      <table className="mag-proc-table">
        <thead><tr><th>PV name</th><th>Value</th><th>Readback</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.configPv?.pvName || i}>
              <td>{r.configPv?.pvName}</td>
              <td>
                <input className="mag-proc-input" value={vTypeText(r.value)} disabled={!loggedIn}
                  onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i
                    ? { ...x, value: withVTypeValue(x.value, e.target.value) } : x)))} />
              </td>
              <td className="mag-proc-empty">{r.readbackValue ? vTypeText(r.readbackValue) : '---'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mag-proc-toolbar">
        <button type="button" className="mag-proc-btn mag-proc-btn--primary" disabled={!loggedIn || !!busy} onClick={save}>
          Save snapshot
        </button>
      </div>

      <StatusBox message={message} busy={busy} />
    </div>
  );
}

/**
 * Save & Restore — full browse/search + create/edit/delete interface to the Phoebus
 * save-and-restore service: folders, configurations (PV lists) and snapshots (captured
 * values). Reading needs no login; creating, editing and deleting do (HTTP Basic, the
 * operator's own save-and-restore account — see LoginBar).
 */
export default function SaveAndRestoreView() {
  const url = getSaveAndRestoreUrl();
  const [, forceUpdate] = useState(0); // re-render after login()/logoutSaveAndRestore() (module-level state)
  const loggedIn = isSaveAndRestoreLoggedIn();
  const user = getSaveAndRestoreUser();

  const [query, setQuery] = useState('');
  const [path, setPath] = useState([]); // [{ id, name, nodeType }]
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(null); // 'FOLDER' | 'CONFIGURATION' | null
  const [selected, setSelected] = useState(null); // { node, pvList } | { node, items }
  const [message, setMessage] = useState(null);

  const currentFolder = path[path.length - 1] || null;

  const withLoading = async (fn) => {
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const runSearch = (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    withLoading(async () => {
      setPath([]);
      setSelected(null);
      setItems(await searchNodes(q));
    });
  };

  const openFolder = (node) => withLoading(async () => {
    const children = await getChildren(node.uniqueId);
    setPath((p) => [...p, { id: node.uniqueId, name: node.name, nodeType: node.nodeType }]);
    setSelected(null);
    setItems(children);
  });

  const refreshCurrent = () => withLoading(async () => {
    setItems(currentFolder ? await getChildren(currentFolder.id) : await searchNodes(query.trim() || '*'));
  });

  const goTo = (index) => withLoading(async () => {
    if (index < 0) {
      setPath([]);
      setSelected(null);
      setItems(await searchNodes(query.trim() || '*'));
      return;
    }
    const target = path[index];
    setPath(path.slice(0, index + 1));
    setSelected(null);
    setItems(await getChildren(target.id));
  });

  const openConfiguration = (node) => withLoading(async () => {
    setSelected({ type: 'CONFIGURATION', node, pvList: await getConfiguration(node.uniqueId) });
  });

  const openSnapshot = (node) => withLoading(async () => {
    setSelected({ type: 'SNAPSHOT', node, items: await getSnapshotItems(node.uniqueId) });
  });

  const click = (node) => {
    if (node.nodeType === 'FOLDER') openFolder(node);
    else if (node.nodeType === 'CONFIGURATION') openConfiguration(node);
    else if (node.nodeType === 'SNAPSHOT') openSnapshot(node);
    // COMPOSITE_SNAPSHOT items live behind a different endpoint shape - not supported here.
  };

  const create = async (kind, name, description, pvs) => {
    if (kind === 'FOLDER') await createFolder(currentFolder.id, name, description);
    else await createConfiguration(currentFolder.id, name, description, pvs);
    setCreating(null);
    await refreshCurrent();
  };

  const rename = (node) => {
    const name = window.prompt('New name:', node.name);
    if (!name || name === node.name) return;
    withLoading(async () => {
      await updateNode({ ...node, name });
      await refreshCurrent();
    });
  };

  const remove = (node) => {
    if (!window.confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
    withLoading(async () => {
      await deleteNodes([node.uniqueId]);
      if (selected?.node.uniqueId === node.uniqueId) setSelected(null);
      await refreshCurrent();
    });
  };

  if (!url) {
    return (
      <ProcedureFrame title="Save & Restore" subtitle="Browse, create and edit save-and-restore configurations and snapshots.">
        <p className="mag-proc-empty">save-and-restore is not configured for this beamline.</p>
      </ProcedureFrame>
    );
  }

  return (
    <ProcedureFrame
      title="Save & Restore"
      subtitle="Browse, create and edit save-and-restore configurations and snapshots. Reading needs no login; creating, editing and deleting need your save-and-restore account."
    >
      <LoginBar user={user} onChange={() => forceUpdate((n) => n + 1)} />
      <StatusBox message={message} />

      <div className="sar-manager">
        <div className="sar-manager-browse">
          <form className="mag-proc-toolbar" onSubmit={runSearch}>
            <input className="mag-proc-input" style={{ flex: 1 }} type="search"
              placeholder="Search (name or *)..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="mag-proc-btn">Search</button>
          </form>

          {path.length > 0 && (
            <div className="sar-breadcrumb">
              <button type="button" className="sar-crumb" onClick={() => goTo(-1)}>Search results</button>
              {path.map((p, i) => (
                <span key={p.id}>
                  <span className="sar-crumb-sep">/</span>
                  <button type="button" className="sar-crumb" onClick={() => goTo(i)}>{p.name}</button>
                </span>
              ))}
            </div>
          )}

          {currentFolder?.nodeType === 'FOLDER' && !creating && (
            <div className="mag-proc-toolbar">
              <button type="button" className="mag-proc-btn" disabled={!loggedIn} onClick={() => setCreating('FOLDER')}
                title={loggedIn ? '' : 'Log in to create a folder here'}>
                + Folder
              </button>
              <button type="button" className="mag-proc-btn" disabled={!loggedIn} onClick={() => setCreating('CONFIGURATION')}
                title={loggedIn ? '' : 'Log in to create a configuration here'}>
                + Configuration
              </button>
            </div>
          )}
          {creating && (
            <CreateForm
              kind={creating}
              onCreate={(name, description, pvs) => create(creating, name, description, pvs)}
              onCancel={() => setCreating(null)}
            />
          )}

          {error && <div className="mag-proc-status mag-proc-status--error">{error}</div>}
          {loading && <div className="mag-proc-status mag-proc-status--info">Loading...</div>}

          {!loading && items !== null && (
            items.length === 0 ? (
              <p className="mag-proc-empty">Nothing here.</p>
            ) : (
              <ul className="sar-node-list">
                {items.map((node) => (
                  <li key={node.uniqueId}>
                    <button
                      type="button"
                      className={`sar-node ${selected?.node.uniqueId === node.uniqueId ? 'active' : ''}`}
                      disabled={node.nodeType === 'COMPOSITE_SNAPSHOT'}
                      onClick={() => click(node)}
                      title={node.nodeType === 'COMPOSITE_SNAPSHOT' ? 'Composite snapshots are not supported here' : node.description || ''}
                    >
                      <span className="sar-node-icon">{NODE_ICON[node.nodeType] || '•'}</span>
                      <span className="sar-node-name">{node.name}</span>
                      <span className="sar-node-meta">{node.userName} · {formatDate(node.lastModified)}</span>
                    </button>
                    {loggedIn && (
                      <span className="sar-node-actions">
                        <button type="button" className="mag-proc-btn mag-proc-btn--sm" onClick={() => rename(node)}>Rename</button>
                        <button type="button" className="mag-proc-btn mag-proc-btn--sm" onClick={() => remove(node)}>Delete</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
          {!loading && items === null && (
            <p className="mag-proc-empty">Search for a folder, configuration or snapshot name (or "*" for everything).</p>
          )}
        </div>

        <div className="sar-manager-detail">
          {!selected && <p className="mag-proc-empty">Select a configuration to edit its PV list, or a snapshot to view or edit its values.</p>}
          {selected?.type === 'CONFIGURATION' && (
            <ConfigurationPanel
              node={selected.node}
              pvList={selected.pvList}
              loggedIn={loggedIn}
              onSaved={(pvList) => setSelected({ ...selected, pvList })}
              onSnapshotTaken={() => { if (currentFolder?.id === selected.node.uniqueId) refreshCurrent(); }}
            />
          )}
          {selected?.type === 'SNAPSHOT' && (
            <SnapshotPanel
              node={selected.node}
              items={selected.items}
              loggedIn={loggedIn}
              onSaved={(items) => setSelected({ ...selected, items })}
            />
          )}
        </div>
      </div>
    </ProcedureFrame>
  );
}
