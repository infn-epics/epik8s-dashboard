# Voice Assistant (experimental)

Jarvis-like push-to-talk voice interaction with the accelerator control
system, backed by a LiveKit room + a Python `livekit-agents` backend that
talks to the control system over MCP. This module is a **parallel,
optional channel** — it never touches the existing PVWS/REST widget
control flows.

Disabled by default. This is a feature-flagged experimental extension, not
a supported control path: it does not carry an audit trail itself (that
lives in the agent/MCP backend), and confirmation banners never execute
actions — they only forward a confirm/cancel event to the agent.

## Files

- `src/voice/events.js` — event schemas, `matchDeviceId`, backoff/TTL pure helpers (framework-free, unit-tested in `tests/voiceEvents.test.js`, `tests/voiceHighlight.test.js`).
- `src/services/voiceRoom.js` — `VoiceRoomClient`, the LiveKit room connection (mirrors `PvwsClient`'s shape).
- `src/context/VoiceContext.jsx` — owns the `VoiceRoomClient` instance, exposes connection status.
- `src/context/VoiceHighlightContext.jsx` — tracks `highlight` events, exposes `isHighlighted(pvPrefix, deviceId)` to widgets.
- `src/hooks/useVoiceAssistant.js` — push-to-talk state machine, transcript, confirmation flow.
- `src/components/consoles/VoiceConsole.jsx` + `voiceConsoleUI.jsx` — the floating console (FAB, transcript panel, confirmation banner).

## Enabling the flag

Voice is off unless `config.epicsConfiguration.services.voiceAssistant.enabled`
is `true` in `values.yaml`:

```yaml
epicsConfiguration:
  services:
    voiceAssistant:
      enabled: true
      tokenEndpoint: "https://argus-voice-token.example.infn.it/token"
      serverUrl: "wss://argus-livekit.example.infn.it"
      roomName: "argus-control-room"
      identityPrefix: "operator"
      # highlightTtlMs: 8000   # optional, defaults to 8000ms in code
```

For local dev, without editing `values.yaml`, use query params (persisted
to `localStorage` under `epik8s-voice-overrides`, same pattern as the
`?pvws=`/`?archiver=` overrides):

```
http://localhost:5173/dashboard?voice=1&voiceToken=http://localhost:8788/token&voiceServer=ws://localhost:7880&voiceRoom=argus-control-room
```

- `?voice=1` / `?voice=0` — force enable/disable.
- `?voiceToken=<url>` — override the token endpoint.
- `?voiceServer=<ws url>` — override the LiveKit media server WS URL.
- `?voiceRoom=<name>` — override the room name.

All four persist to `localStorage` (`epik8s-voice-overrides`) so you only
need to pass them once.

## Testing against a local LiveKit backend

No real agent needed to exercise the frontend — `livekit-server-sdk`'s
`RoomServiceClient.sendData()` can inject data-channel events from a plain
script, standing in for the Python agent.

1. Run a LiveKit dev server:
   ```
   docker run -d --name livekit-dev -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
     livekit/livekit-server --dev --bind 0.0.0.0
   ```
   This uses the placeholder dev keys `devkey` / `secret` (printed in the container logs).
2. Stand up a token endpoint that returns `{ "token": "<jwt>" }` for `POST { room, identity }` — a few lines with `livekit-server-sdk`'s `AccessToken`:
   ```js
   const at = new AccessToken('devkey', 'secret', { identity });
   at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
   const token = await at.toJwt();
   ```
3. Launch the dashboard with the four query params above. The console header dot should turn green (connected) within a couple seconds.
4. Push-to-talk: hold the 🎙 FAB — this triggers a real `getUserMedia` permission prompt and publishes a real mic track (verify no publish happens before this point).
5. Inject events with `RoomServiceClient.sendData(room, new TextEncoder().encode(json), DataPacket_Kind.RELIABLE)`, e.g.:
   ```json
   { "type": "highlight", "device_id": "EUAPS:CTRL:FPMMIR:HMOT01", "reason": "test", "ttl_ms": 8000 }
   { "type": "transcript", "role": "assistant", "text": "sto muovendo il motore", "final": true }
   { "type": "confirm_request", "action_id": "a1", "label": "Spegnere il magnete Q1?" }
   ```
   `highlight` pulses the matching widget's border for `ttl_ms`; `transcript` appends to the console's history panel; `confirm_request` opens the Conferma/Annulla banner (clicking either sends `confirm_action` back over the data channel and clears the banner — nothing is executed locally).

## Event schemas

All events are JSON over the LiveKit data channel.

**`highlight`** (agent → frontend) — highlights a device widget:
```json
{ "type": "highlight", "device_id": "IOC1:MOT01", "reason": "Motore fuori posizione", "ttl_ms": 8000 }
```

**`transcript`** (agent → frontend) — user/assistant speech, partial or final:
```json
{ "type": "transcript", "role": "user", "text": "porta il motore a zero", "final": false }
```

**`confirm_request`** (agent → frontend) — triggers the confirmation banner:
```json
{ "type": "confirm_request", "action_id": "a1b2c3", "label": "Spegnere il magnete Q1?", "device_id": "IOC1:Q1" }
```

**`confirm_action`** (frontend → agent) — the *only* outbound event besides mic audio:
```json
{ "type": "confirm_action", "action_id": "a1b2c3", "confirmed": true, "ts": 1690454400000 }
```
The frontend never executes anything here — it only forwards the operator's
choice. Real execution and audit logging stay entirely backend/MCP-side.

## Known open questions

- **`device_id` format**: `matchDeviceId()` (`src/voice/events.js`) tries exact match, then prefix match, then common EPICS suffix stripping (`:RBV`, `.RBV`, …) against a widget's `pvPrefix`/`deviceId`. This is the part most likely to need adjustment once the real agent's convention is known — see the test cases in `tests/voiceEvents.test.js` for the currently-supported forms.
- **Transcript transport**: this module assumes the agent sends custom `transcript` JSON events (for consistency with `highlight`/`confirm_request`), not LiveKit's built-in transcription API. Confirm against the actual agent implementation.
- **Auth on the token endpoint**: `VoiceRoomClient._fetchToken()` does an unauthenticated `POST`. If the token endpoint requires the dashboard's existing auth (see `src/context/AuthContext.jsx`), thread a header through `VoiceContext.jsx`.
- **Highlight scope**: currently universal — every widget (`WidgetFrame.jsx` wraps all of them) can be highlighted. If highlighting should be scoped to specific device families for an initial rollout, add an allowlist check next to `voiceHighlightClass` in `WidgetFrame.jsx`.
