# EPIK8s Dashboard

A modular, configuration-driven React web application that generates dynamic control dashboards from epik8s-style YAML configuration files. Supports multiple views for camera arrays, instrumentation control, and beamline overview with a flexible drag-and-drop layout system.

## Features

- **Multi-view application** — Camera View, Instrumentation View, Beamline Overview with SPA routing
- **YAML-driven configuration** — loads `values.yaml` at runtime to discover all IOCs and devices
- **Widget framework** — pluggable widgets (Camera, Motor, BPM, Generic) bound to EPICS PVs via pvws
- **Drag & drop layout** — react-grid-layout powered dashboards with resize, collapse, detail modals
- **Layout persistence** — saves user layouts per view/zone to localStorage
- **Dark/Light theme** — toggle between themes; preference saved
- **Zone-based beamline view** — groups devices by zone with auto-layout
- **Search & filter** — filter devices by name, family, type, zone
- **EPICS PV integration** — subscribe and write via pvws WebSocket

## Quick Start

```bash
npm install
npm run dev
```

Place your `values.yaml` in `public/` or pass `?values=/path/to/values.yaml`.

## Views

| View | Route | Description |
|------|-------|-------------|
| Camera Array | `/cameras` | NxM grid of MJPEG camera streams with per-tile controls |
| Instrumentation | `/instrumentation` | All devices with search/filter and drag-drop layout |
| Beamline | `/beamline` | Zone-grouped device overview |

## Project Structure

```
src/
  App.jsx                           Main router
  context/AppContext.jsx             Global state (config, devices, pvws client)
  models/device.js                  Device normalization from YAML
  services/
    pvws.js                         PVWS WebSocket client
    configLoader.js                 YAML parser
    layoutPersistence.js            Layout save/load (localStorage)
  hooks/
    usePv.js                        PV subscription hooks
    useLayout.js                    Layout state management
    useTheme.js                     Dark/light theme toggle
  components/
    layout/
      AppShell.jsx                  Navbar and view container
      DashboardGrid.jsx             react-grid-layout wrapper
      Widget.jsx                    Base widget container
    widgets/
      CameraWidget.jsx              Camera stream + PV controls
      MotorWidget.jsx               Motor position/move/stop
      BPMWidget.jsx                 Beam Position Monitor
      GenericPVWidget.jsx           Generic fallback
      WidgetRegistry.js             Maps device types to widget components
    views/
      CameraView.jsx                NxM camera grid
      InstrumentationView.jsx       Filterable device dashboard
      BeamlineView.jsx              Zone-based beamline layout
    common/
      PvControls.jsx                PvDisplay, PvInput, PvSlider, StatusIndicator
      SearchFilter.jsx              Search/filter panel
```
- **EPICS PV control** via WebSocket:
  - `${pv_prefix}:Acquire` — Start / Stop
  - `${pv_prefix}:AcquireTime` — Exposure slider
  - `${pv_prefix}:Gain` — Gain slider
- **Auto-discovery** — parses `values.yaml` and finds IOCs with `stream_enable: true`
- **Fully frontend** — no backend server needed; static files only

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Configuration

Place your `values.yaml` in the `public/` folder (it's served at `/values.yaml`).

The app extracts cameras from `epicsConfiguration.iocs[]` entries that have `stream_enable: true`, and builds:

| Field | Source |
|---|---|
| PV prefix | `iocprefix:deviceName` (e.g. `EUAPS:CAM:SIM01`) |
| MJPEG URL | `<namespace>-<iocname>.<domain>:<port>/<device>.mjpg` |

### URL Parameters

| Param | Default | Description |
|---|---|---|
| `rows` | `3` | Number of grid rows |
| `cols` | `3` | Number of grid columns |
| `pvws` | `ws://<host>/pvws/pv` | PVWS WebSocket endpoint |
| `values` | `/values.yaml` | Path to the YAML config |

Example: `http://localhost:3000/?rows=2&cols=4&pvws=ws://myhost/pvws/pv`

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file server (nginx, Apache, etc.).

## Architecture

```
src/
  services/
    pvws.js           — PVWS WebSocket client (connect, subscribe, put)
    configLoader.js   — YAML parser, camera extractor
  hooks/
    usePv.js          — React hooks for PV subscription & status
  components/
    CameraGrid.jsx    — N×M CSS Grid layout
    CameraTile.jsx    — Individual tile: stream + selector + controls
    CameraControls.jsx— Acquire/Exposure/Gain controls
    ConnectionStatus.jsx — PVWS connection indicator
  App.jsx             — App shell, config loading, state
  index.css           — Dark theme styling
public/
  values.yaml         — Beamline configuration (auto-discovered cameras)
```
