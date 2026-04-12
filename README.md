# EPIK8s Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Author:** Andrea Michelotti

A modular, configuration-driven React web application that provides a **Grafana-like experience** for creating and managing dashboards for EPICS-based particle accelerator systems. Supports both auto-generated views from YAML configuration and user-created custom dashboards with a pluggable widget system, plus a full graphical **Beamline Layout editor** powered by React Flow.

## Features

- **Dashboard CRUD** — Create, rename, duplicate, delete, and switch between multiple dashboards
- **Widget system** — 11+ pluggable widget types with self-describing property schemas
- **Widget picker** — Browse widget types by category or add from YAML-discovered devices
- **Widget config panel** — Edit widget properties via auto-generated form editors; replace widget type preserving compatible config
- **Frameless mode** — Widgets can hide their header/border for clean display-panel layouts
- **Multiple data sources** — Real-time EPICS PVs via PVWS WebSocket + historical data via Archiver Appliance REST
- **YAML-driven auto-discovery** — Loads `values.yaml` at runtime to discover all IOCs, devices, cameras, and zones
- **Multi-view application** — Custom Dashboards, Camera Array, Instrumentation, Beamline Overview, Beamline Layout, SoftIOC Manager
- **Grafana-like UI** — Collapsible sidebar with dashboard list, toolbar, and grid editor
- **Drag & drop layout** — react-grid-layout powered grids with resize, collapse, detail modals
- **JSON persistence** — Dashboards and layouts saved to localStorage with export/import as JSON files
- **Dark/Light theme** — Toggle between themes; preference saved
- **Zone-based beamline view** — Devices grouped by zone with summary cards and expandable grids
- **Graphical Beamline Layout editor** — React Flow canvas with device glyphs, groups/modules, shapes, connections, schematic view, and real-time PV status coloring

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173. Place your `values.yaml` in `public/` or pass `?values=/path/to/values.yaml`.

## Views

| View | Route | Description |
|------|-------|-------------|
| **Dashboard** | `/dashboard` | User-created dashboards with widget editor (default) |
| Camera Array | `/cameras` | NxM grid of MJPEG camera streams with per-tile controls |
| Instrumentation | `/instrumentation` | All devices with search/filter and drag-drop layout |
| Beamline | `/beamline` | Zone-grouped device overview with summary cards |
| **Beamline Layout** | `/layout` | Graphical beamline editor — device nodes, groups, connections, SVG glyphs |
| SoftIOC Manager | `/softioc` | Manage and monitor soft IOC deployments |

## Widget Types

| Type | Category | Description |
|------|----------|-------------|
| `pv-display` | Generic | Single PV value display with severity coloring |
| `pv-control` | Generic | PV write control (slider, toggle, button, input) |
| `plot` | Generic | Archiver-based historical trend chart (canvas) |
| `table` | Generic | Multi-PV status table |
| `camera` | Devices | MJPEG stream with acquire/exposure/gain controls |
| `motor` | Devices | Position readback, move-to, stop, home, POI presets |
| `bpm` | Devices | Beam Position Monitor (X/Y + optional charge) |
| `vacuum` | Devices | Pressure display, valve control, alarm threshold |
| `power-supply` | Devices | Current/voltage read/set, on/off toggle |
| `charge-monitor` | Devices | Charge readback with sparkline trend |
| `generic-pv` | Devices | Fallback widget for any PV prefix |

All widget types support a `frameless` property (boolean, default `false`) to hide the widget header and border — useful for building OPI-style display panels.

## Dashboard JSON Format

Dashboards can be exported/imported as JSON files via the sidebar or toolbar import/export buttons. The format is:

```json
{
  "id": "dash-abc123",
  "name": "Injector Overview",
  "description": "optional description",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "widgets": [
    {
      "id": "w-1",
      "type": "motor",
      "config": {
        "title": "FP1 Horizontal",
        "pvPrefix": "EUAPS:FPRCK1:W:CTR:FP1-HMN-01",
        "min": 0,
        "max": 12,
        "precision": 4,
        "frameless": false
      },
      "layout": { "x": 0, "y": 0, "w": 3, "h": 4 }
    }
  ]
}
```

### Widget `layout` fields (react-grid-layout)

| Field | Type | Description |
|-------|------|-------------|
| `x` | integer | Column position (0–11, 12-column grid) |
| `y` | integer | Row position (in grid row units) |
| `w` | integer | Width in columns |
| `h` | integer | Height in row units |

See [public/example-dashboard.json](public/example-dashboard.json) for a complete example.

## Beamline Layout JSON Format

Beamline layouts can be exported/imported at `/layout` using the toolbar import/export buttons. The format is:

```json
{
  "beamline": "SPARC",
  "layout": "layout name",
  "elements": [
    {
      "id": "grp-gun",
      "type": "group",
      "label": "GUN",
      "x": 10,
      "y": 10,
      "width": 220,
      "height": 240,
      "borderColor": "#ff6600",
      "dashed": true,
      "shape": "rect"
    },
    {
      "id": "gun-sol",
      "type": "device",
      "label": "GUNSOL",
      "glyphType": "solenoid",
      "x": 80,
      "y": 95,
      "parentId": "grp-gun"
    },
    {
      "id": "beam",
      "type": "shape-line",
      "label": "Beam",
      "x": 30,
      "y": 130,
      "width": 2300,
      "height": 4,
      "color": "#22c55e"
    },
    {
      "id": "lbl",
      "type": "annotation",
      "label": "Section A",
      "x": 100,
      "y": 20,
      "fontSize": 14,
      "bold": true,
      "color": "#aaa"
    }
  ],
  "connections": [
    { "from": "gun-block", "to": "gun-sol" }
  ]
}
```

### Element `type` values

| Type | Description |
|------|-------------|
| `device` | Device node with SVG glyph and optional PV link |
| `group` | Module/section container — children with `parentId` move with it |
| `annotation` | Text label or beam-pipe annotation |
| `shape-line` | Straight line (beam pipe, separator) |
| `shape-rect` | Rectangle (fill + stroke) |
| `shape-circle` | Circle |
| `shape-arc` | Arc / bend |

### Device node fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique element ID |
| `label` | string | Display label |
| `glyphType` | string | SVG glyph icon (see table below) |
| `x`, `y` | number | Canvas position in pixels. If `parentId` set, relative to parent group |
| `parentId` | string | ID of a `group` element — makes this element a child of that group |
| `width`, `height` | number | Override default node dimensions |
| `glyphSize` | number | Glyph icon size in px (default 36) |
| `showBorder` | boolean | Show/hide node border box (default true) |
| `rotation` | number | Rotation in degrees |
| `devices` | array | Linked devices: `[{ "id": "...", "name": "...", "pvPrefix": "...", "family": "..." }]` |
| `sublabel` | string | Secondary label shown below main label |

### Group fields

| Field | Type | Description |
|-------|------|-------------|
| `width`, `height` | number | Group container size in pixels |
| `borderColor` | string | CSS color for the border |
| `dashed` | boolean | Dashed border (default true) |
| `shape` | string | `rect` \| `rounded` \| `oval` |

### Available `glyphType` values

| glyphType | Category | Description |
|-----------|----------|-------------|
| `electron-gun` | source | Electron gun |
| `rf-cavity` | accelerator | RF accelerating cavity |
| `undulator` | accelerator | Undulator |
| `bunch-compressor` | accelerator | Bunch compressor |
| `modulator` | accelerator | Modulator |
| `quadrupole` | magnet | Quadrupole magnet |
| `dipole` | magnet | Dipole / bending magnet |
| `solenoid` | magnet | Solenoid |
| `corrector` | magnet | Steering corrector |
| `kicker` | magnet | Kicker |
| `bpm` | diagnostic | Beam Position Monitor |
| `bcm` | diagnostic | Beam Charge Monitor |
| `camera` | diagnostic | Camera / OTR screen |
| `screen` | diagnostic | Screen |
| `flag` | diagnostic | Flag / profile monitor |
| `faraday-cup` | diagnostic | Faraday cup |
| `wire-scanner` | diagnostic | Wire scanner |
| `ict` | diagnostic | ICT / FCT |
| `vacuum-valve` | vacuum | Vacuum valve / gate valve |
| `ion-pump` | vacuum | Ion pump |
| `turbo-pump` | vacuum | Turbo pump |
| `vacuum-gauge` | vacuum | Vacuum gauge |
| `beam-stop` | beamline | Beam stop |
| `shutter` | beamline | Shutter |
| `motor` | motion | Motor axis |
| `cooling` | infra | Cooling system |
| `io` | infra | I/O module |
| `mps` | infra | Machine Protection System |
| `synch` | infra | Timing / synchronization |

**Import note:** The `/layout` import handler also accepts Dashboard JSON (`widgets` array). Dashboard widgets are automatically converted to annotation nodes for quick visualization.

See [public/sparc-beamline-layout.json](public/sparc-beamline-layout.json) for a complete real-world example (SPARC beamline at LNF-INFN).

## Project Structure

```
src/
  App.jsx                            Main router + providers
  main.jsx                           Entry point
  index.css                          Global styles (dark/light theme)

  context/
    AppContext.jsx                    Config, devices, zones, PVWS + Archiver clients
    DashboardContext.jsx              Dashboard CRUD state management
    SoftIOCContext.jsx               SoftIOC deployment state

  models/
    device.js                        Device normalization from YAML
    dashboard.js                     Dashboard/widget creation helpers

  services/
    pvws.js                          PVWS WebSocket client
    configLoader.js                  YAML config parser
    archiver.js                      EPICS Archiver Appliance REST client
    dashboardStorage.js              Dashboard localStorage + JSON export/import
    softiocApi.js                    SoftIOC management API client

  hooks/
    usePv.js                         PV subscription hooks
    useArchiver.js                   Archiver data fetching hook
    useTheme.js                      Dark/light theme toggle
    useLayout.js                     Layout state for auto-generated views
    useGitFetch.js                   Git repo fetch hook

  widgets/
    registry.js                      Widget type definitions with property schemas
    WidgetFrame.jsx                  Universal widget container (drag/collapse/config/frameless)
    WidgetConfigPanel.jsx            Property editor + replace-type UI
    WidgetPicker.jsx                 Widget browse & add dialog
    types/
      PvDisplayWidget.jsx            Single PV display
      PvControlWidget.jsx            PV control (slider/toggle/button/input)
      CameraWidget.jsx               MJPEG camera stream
      MotorWidget.jsx                Motor control
      BPMWidget.jsx                  Beam Position Monitor
      VacuumWidget.jsx               Vacuum gauge/valve
      PowerSupplyWidget.jsx          Power supply control
      ChargeMonitorWidget.jsx        Charge monitor with trend
      PlotWidget.jsx                 Archiver-based canvas chart
      TableWidget.jsx                Multi-PV table
      GenericPVWidget.jsx            Generic PV fallback

  components/
    layout/
      AppShell.jsx                   Grafana-like shell (navbar + sidebar + content)
      Sidebar.jsx                    Dashboard list sidebar with import/export
      DashboardGrid.jsx              react-grid-layout wrapper
    views/
      DashboardView.jsx              Custom dashboard editor (auto-open config, replace type)
      CameraView.jsx                 NxM camera grid
      InstrumentationView.jsx        Filterable device dashboard
      BeamlineView.jsx               Zone-based beamline layout
      BeamlineLayout.jsx             React Flow graphical layout editor
      SoftIOCView.jsx                SoftIOC manager view
    glyphs/
      DeviceGlyphs.jsx               SVG glyph components + GLYPH_TYPES registry
    common/
      PvControls.jsx                 PvDisplay, PvInput, PvSlider, StatusIndicator
      SearchFilter.jsx               Search/filter panel
```

## URL Parameters

| Param | Default | Description |
|---|---|---|
| `pvws` | `ws://<derived-host>/pvws/pv` | PVWS WebSocket endpoint |
| `archiver` | Auto-derived from namespace | Archiver Appliance REST URL |
| `values` | `/values.yaml` | Path to the YAML config |

## Data Sources

### PVWS (Real-time)
WebSocket connection to EPICS PVs via [pvws](https://github.com/ornl-epics/pvws). Subscribe, read, and write PV values in real-time.

### Archiver Appliance (Historical)
REST client for [EPICS Archiver Appliance](https://slacmshanern.github.io/epicsarchiverap/). Fetch historical PV data for trend plots. Used by the Plot widget.

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server (nginx, Apache, etc.).
