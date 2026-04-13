import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/* ── Help content keyed by route ── */
const HELP = {
  '/dashboard': {
    title: 'Dashboards',
    icon: '📊',
    sections: [
      {
        heading: 'Overview',
        body: 'Create and manage custom dashboards with drag-and-drop widgets. Each dashboard is a named collection of resizable widget tiles arranged on a grid layout.',
      },
      {
        heading: 'Editing',
        body: 'Click the **Edit** toggle to enter edit mode. In edit mode you can:\n• Add widgets using the **＋ Widget** picker\n• Drag widgets to reposition them\n• Resize by pulling the bottom-right corner handle\n• Right-click a widget header for options (configure, delete)\n• Toggle **Essential / Detail** view mode per widget',
      },
      {
        heading: 'Managing dashboards',
        body: '• **Rename**: click the dashboard name in the sidebar and type a new name\n• **Import/Export**: use the sidebar footer buttons to save/load dashboard JSON files\n• **Multiple dashboards**: each beamline user can create multiple named dashboards; they are persisted in the browser\'s local storage',
      },
      {
        heading: 'Widgets',
        body: 'Widgets display live EPICS PV data. Each device type (motor, vacuum, power supply, BPM, LLRF, timing, …) has a dedicated widget with essential and detail views. Configure the PV prefix in the widget config panel.',
      },
    ],
  },
  '/cameras': {
    title: 'Cameras',
    icon: '📷',
    sections: [
      {
        heading: 'Overview',
        body: 'View live camera streams in an adjustable N×M grid layout.',
      },
      {
        heading: 'Configuration',
        body: '• Click the ⚙ button to open the settings panel\n• Adjust **Rows** and **Columns** to change the grid size\n• Each tile has a dropdown to select which camera to display\n• Camera list is loaded from devices that have `stream_enable: true` in the YAML configuration',
      },
    ],
  },
  '/instrumentation': {
    title: 'Instrumentation',
    icon: '🔧',
    sections: [
      {
        heading: 'Overview',
        body: 'Browse and monitor all configured devices with live PV data. Devices are presented as individual widgets grouped by family/zone.',
      },
      {
        heading: 'Layout modes',
        body: '• **Grid** (⊞): Full-size widget tiles in a draggable react-grid-layout. Supports both essential and detail view modes.\n• **Row** (☰): Compact horizontal strip — each device is rendered as a fixed-width card in essential view mode for a dense overview.',
      },
      {
        heading: 'Filtering',
        body: 'Use the search bar to filter devices by name, family, zone, or IOC prefix. The filter applies in real time to both layout modes.',
      },
      {
        heading: 'Editing',
        body: 'In edit mode you can:\n• Hide/show individual device widgets using the visibility toggles\n• Rearrange widgets in grid mode by dragging\n• Reset the layout to default positions',
      },
    ],
  },
  '/beamline': {
    title: 'Beamline',
    icon: '🔬',
    sections: [
      {
        heading: 'Overview',
        body: 'A zone-based view of the beamline. Each zone displays either a summary card with key PV values or a detailed grid of device widgets.',
      },
      {
        heading: 'Zones',
        body: 'Zones are defined in the YAML configuration or auto-derived from device parameters. Select a zone from the dropdown to focus on a specific section of the beamline.',
      },
      {
        heading: 'View modes',
        body: '• **Summary**: compact cards showing essential device info\n• **Detail**: expanded widget grid with full controls',
      },
    ],
  },
  '/layout': {
    title: 'Beamline Layout',
    icon: '🗺',
    sections: [
      {
        heading: 'Overview',
        body: 'A graphical editor for creating schematic beamline layouts using React Flow. Devices are represented as draggable nodes with SVG glyphs colored by live alarm state.',
      },
      {
        heading: 'Editing',
        body: '• Drag devices from the palette on the left onto the canvas\n• Select a glyph type for each node\n• Group nodes into modules (parent containers)\n• Add drawing primitives: lines, rectangles, circles, arcs\n• Use the right-click context menu for copy, cut, paste, delete\n• Multi-select: Shift+click or box-select',
      },
      {
        heading: 'Keyboard shortcuts',
        body: '• **Ctrl+C** / **Ctrl+X** / **Ctrl+V**: Copy / Cut / Paste\n• **Delete** / **Backspace**: Delete selected\n• **Ctrl+Z**: Undo\n• **Ctrl+A**: Select all',
      },
      {
        heading: 'Multiple layouts',
        body: 'Create multiple named layouts. Switch between them using the layout dropdown. Each layout is stored separately and can be exported/imported.',
      },
    ],
  },
  '/k8s': {
    title: 'Kubernetes Operations',
    icon: '☸',
    sections: [
      {
        heading: 'Overview',
        body: 'Manage ArgoCD applications and Kubernetes resources (pods, services, deployments, statefulsets, configmaps, nodes) for the current namespace.',
      },
      {
        heading: 'Applications',
        body: '• **Sync**: trigger an ArgoCD sync to reconcile desired vs. live state\n• **Restart**: perform a rolling restart of the application pod\n• **Delete**: remove the ArgoCD application\n• Filter by name or labels using the search bar\n• Sort columns by clicking the header',
      },
      {
        heading: 'Pods & Deployments',
        body: '• View pod status, restarts, age\n• Delete individual pods\n• Scale deployments and statefulsets up/down\n• Restart deployments with a rolling update',
      },
      {
        heading: 'Nodes',
        body: 'View cluster node status, roles, CPU/memory usage, and resource capacity.',
      },
    ],
  },
  '/tickets': {
    title: 'Tickets',
    icon: '🎫',
    sections: [
      {
        heading: 'Overview',
        body: 'Browse and manage issues from the connected GitHub/GitLab repository (configured via `giturl` in values.yaml).',
      },
      {
        heading: 'Filtering',
        body: '• Filter by state: Open, Closed, All\n• Filter by label\n• Text search across title and body\n• Results are paginated (20 per page)',
      },
      {
        heading: 'Creating tickets',
        body: 'Click **New Ticket** to open the creation form. Requires a valid Personal Access Token (PAT) configured in Settings.',
      },
    ],
  },
  '/softioc': {
    title: 'SoftIOC Manager',
    icon: '🧩',
    sections: [
      {
        heading: 'Overview',
        body: 'Manage iocmng-based soft IOCs running as TaskBase plugins. Each softioc exposes system PVs (ENABLE, STATUS, MESSAGE, VERSION, CYCLE_COUNT) plus user-defined inputs and outputs declared in `config.yaml`.',
      },
      {
        heading: 'Visualizer',
        body: 'Live monitoring panel for all configured softiocs. Shows system PVs with severity coloring, user inputs with linked source PV values, and user outputs with linked target PV values. Expand a softioc card for full detail.',
      },
      {
        heading: 'Builder',
        body: 'Step-by-step wizard to create a new softioc configuration:\n• **Template** — choose type: declarative, custom, interlock, or motor-interlock\n• **Basic Info** — name, PV prefix, mode (continuous / triggered / on-demand), scan interval\n• **Inputs / Outputs** — define PVs with optional link wiring\n• **Rules** — condition-based rules with actuator writes (declarative templates)\n• **Preview** — review generated `config.yaml` and Python skeleton; download as ZIP',
      },
      {
        heading: 'Links',
        body: 'Visual editor for wiring softioc inputs and outputs together. Drag connections between PVs across different softiocs. Connections are stored in `values-softiocs.yaml`.',
      },
      {
        heading: 'Deployment',
        body: 'Editor for `values-softiocs.yaml` — the Helm values file used by epik8s-chart to create ArgoCD Applications for each softioc.\n• Import from file or sync from the Git repository\n• Add, remove, and inline-edit softioc entries\n• Preview the full YAML and copy or download it for use in the beamline repository',
      },
    ],
  },
  '/channels': {
    title: 'Channel Browser',
    icon: '📡',
    sections: [
      {
        heading: 'Overview',
        body: 'Search and browse EPICS channels registered in the ChannelFinder service. Displays channel metadata and live PV values for the selected channel.',
      },
      {
        heading: 'Filtering',
        body: '• **Name**: wildcard pattern, e.g. `SPARC:*:STATUS`\n• **IOC**: filter by IOC name\n• **Zone**: filter by beamline zone\n• **Type** and **Family**: filter by device type or family\n• **Raw query**: free-form ChannelFinder query string\nResults are paginated (50 channels per page).',
      },
      {
        heading: 'Channel actions',
        body: 'Click a row to expand full property metadata. Right-click for the context menu:\n• Copy PV name to clipboard\n• View live PV value inline\n• Open PV history in Archiver trend plot',
      },
    ],
  },
  '/settings': {
    title: 'Settings',
    icon: '⚙',
    sections: [
      {
        heading: 'Data Sources',
        body: 'Configure the PVWS (Process Variable Web Socket) URL and Archiver Appliance URL. Defaults are loaded from the YAML configuration; you can override them here. Changes are saved to local storage.',
      },
      {
        heading: 'Authentication',
        body: 'Enter a Personal Access Token (PAT) for your Git provider (GitHub or GitLab). The PAT is required for:\n• Creating and managing tickets\n• ArgoCD sync/restart operations\n• Any write operations through the K8s backend',
      },
    ],
  },
};

/* ── General help (always shown) ── */
const GENERAL_HELP = {
  title: 'EPIK8s Dashboard',
  sections: [
    {
      heading: 'About',
      body: 'EPIK8s is a web-based control system dashboard for EPICS-based accelerator facilities running on Kubernetes. It provides real-time monitoring, device control, beamline visualization, and operational management.',
    },
    {
      heading: 'Navigation',
      body: '• **Controls**: Dashboards, Beamline, Layout, SoftIOC — device monitoring, visualization, and soft IOC management\n• **Monitor**: Cameras, Instrumentation, Channels — live data and channel browsing\n• **Ops**: Kubernetes, Tickets — operational management\n• **Settings**: Data source configuration and authentication',
    },
    {
      heading: 'Configuration',
      body: 'The dashboard loads its configuration from a `values.yaml` file. You can specify a custom path via the `?values=` URL parameter. The YAML defines:\n• Beamline name, namespace, and Git repository\n• IOC definitions with device families and PV prefixes\n• Service endpoints (PVWS, Archiver, cameras)\n• Dashboard title and backend settings',
    },
    {
      heading: 'Chat & System Console',
      body: '• **💬 Chat**: real-time messaging with all connected users. Supports broadcasts (play a sound alert), screenshots, and file attachments.\n• **🖥 System**: live event log of backend operations (sync, restart, delete, scale). Filter events by text.',
    },
    {
      heading: 'Keyboard shortcuts',
      body: '• **?** or **F1**: Toggle this help panel\n• **Escape**: Close help, close modals',
    },
  ],
};

/** Simple Markdown-like rendering: **bold**, `code`, \n• bullets */
function renderMarkdown(text) {
  const parts = [];
  let key = 0;
  // Split into lines first for bullet handling
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) parts.push(<br key={`br-${key++}`} />);
    const line = lines[i];
    // Parse inline formatting
    const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const tok of tokens) {
      if (tok.startsWith('**') && tok.endsWith('**')) {
        parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
      } else if (tok.startsWith('`') && tok.endsWith('`')) {
        parts.push(<code key={key++} className="help-code">{tok.slice(1, -1)}</code>);
      } else {
        parts.push(<span key={key++}>{tok}</span>);
      }
    }
  }
  return parts;
}

/**
 * HelpPanel — context-sensitive help overlay.
 *
 * Shows help for the current route, plus a general section.
 * Toggled by navbar ❓ button or keyboard shortcut.
 */
export default function HelpPanel({ onClose }) {
  const location = useLocation();
  const panelRef = useRef(null);
  const [tab, setTab] = useState('context'); // 'context' | 'general'

  const contextHelp = HELP[location.pathname] || null;

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    // Delay to avoid closing immediately from the toggle click
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const activeHelp = tab === 'context' && contextHelp ? contextHelp : GENERAL_HELP;

  return (
    <div className="help-overlay">
      <div className="help-panel" ref={panelRef}>
        <div className="help-header">
          <div className="help-tabs">
            {contextHelp && (
              <button
                className={`help-tab ${tab === 'context' ? 'active' : ''}`}
                onClick={() => setTab('context')}
              >
                {contextHelp.icon} {contextHelp.title}
              </button>
            )}
            <button
              className={`help-tab ${tab === 'general' ? 'active' : ''}`}
              onClick={() => setTab('general')}
            >
              📖 General
            </button>
          </div>
          <button className="help-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="help-body">
          {activeHelp.sections.map((sec, i) => (
            <section key={i} className="help-section">
              <h3 className="help-section-title">{sec.heading}</h3>
              <p className="help-section-body">{renderMarkdown(sec.body)}</p>
            </section>
          ))}
        </div>

        <div className="help-footer">
          <span className="help-hint">Press <kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
