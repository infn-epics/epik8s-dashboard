import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeBackoffDelay, MAX_RECONNECT_ATTEMPTS } from '../src/voice/events.js';

const roomInstances = [];

vi.mock('livekit-client', () => {
  class MockRoom {
    constructor() {
      this._handlers = {};
      this.localParticipant = {
        publishTrack: vi.fn(async () => {}),
        unpublishTrack: vi.fn(async () => {}),
        publishData: vi.fn(),
      };
      this.connect = vi.fn(async () => {});
      this.disconnect = vi.fn();
      roomInstances.push(this);
    }
    on(event, cb) {
      this._handlers[event] = cb;
      return this;
    }
    emit(event, ...args) {
      this._handlers[event]?.(...args);
    }
  }
  return {
    Room: MockRoom,
    RoomEvent: {
      DataReceived: 'DataReceived',
      TrackSubscribed: 'TrackSubscribed',
      TrackUnsubscribed: 'TrackUnsubscribed',
      Disconnected: 'Disconnected',
    },
    Track: { Kind: { Audio: 'audio', Video: 'video' } },
    createLocalAudioTrack: vi.fn(),
  };
});

import VoiceRoomClient from '../src/services/voiceRoom.js';
import { createLocalAudioTrack } from 'livekit-client';

function makeClient(overrides = {}) {
  return new VoiceRoomClient({
    tokenEndpoint: 'https://backend.test/voice/token',
    serverUrl: 'wss://livekit.test',
    roomName: 'argus-control-room',
    ...overrides,
  });
}

beforeEach(() => {
  roomInstances.length = 0;
  createLocalAudioTrack.mockReset();
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ token: 'tok' }) }));
});

describe('VoiceRoomClient.connect', () => {
  it('joins the room and reaches "connected" without touching the microphone', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.status).toBe('connected');
    expect(createLocalAudioTrack).not.toHaveBeenCalled();
    expect(roomInstances[0].localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('includes the selected LLM model when minting its room token', async () => {
    const client = makeClient({ model: 'qwen36-27b' });
    await client.connect();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('qwen36-27b');
  });

  it('discards a superseded overlapping connect() attempt so data-channel events are not duplicated (regression: React StrictMode double-invokes the connect effect in dev, and any connect()/connect() race hits this)', async () => {
    const client = makeClient();
    // Two connect() calls before either token fetch resolves — this is
    // exactly what React 18 StrictMode's double-invoked effects produce.
    const p1 = client.connect();
    const p2 = client.connect();
    await Promise.all([p1, p2]);

    // The superseded attempt bails (generation check) before ever
    // constructing a Room, so exactly one live connection remains.
    expect(roomInstances).toHaveLength(1);
    expect(client.status).toBe('connected');

    const received = [];
    client.onData((msg) => received.push(msg));
    roomInstances[0].emit('DataReceived', new TextEncoder().encode(JSON.stringify({ type: 'highlight', device_id: 'X' })));
    expect(received).toHaveLength(1);
  });
});

describe('VoiceRoomClient data channel', () => {
  it('publishes reliable JSON data after connecting', async () => {
    const client = makeClient();
    await client.connect();

    client.sendData({ type: 'text_input', text: 'stato BTF' });

    expect(roomInstances[0].localParticipant.publishData).toHaveBeenCalledWith(
      new TextEncoder().encode(JSON.stringify({ type: 'text_input', text: 'stato BTF' })),
      { reliable: true },
    );
  });
});

describe('push-to-talk', () => {
  it('startTalking publishes a mic track only on explicit activation', async () => {
    const client = makeClient();
    await client.connect();
    const room = roomInstances[0];
    const micTrackStub = { stop: vi.fn() };
    createLocalAudioTrack.mockResolvedValue(micTrackStub);

    await expect(client.startTalking()).resolves.toBe(true);

    expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(micTrackStub);
    expect(client.isTalking).toBe(true);
  });

  it('stopTalking unpublishes and stops the track, releasing the mic indicator', async () => {
    const client = makeClient();
    await client.connect();
    const room = roomInstances[0];
    const micTrackStub = { stop: vi.fn() };
    createLocalAudioTrack.mockResolvedValue(micTrackStub);

    await expect(client.startTalking()).resolves.toBe(true);
    await expect(client.stopTalking()).resolves.toBe(true);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(micTrackStub);
    expect(micTrackStub.stop).toHaveBeenCalledTimes(1);
    expect(client.isTalking).toBe(false);
  });

  it('stopTalking is a no-op when talk was never started', async () => {
    const client = makeClient();
    await client.connect();
    await expect(client.stopTalking()).resolves.toBe(false);
    expect(roomInstances[0].localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('does not leave the mic publishing when stopTalking() is called before startTalking() finishes acquiring the track (regression: a quick press-release during a slow mic-permission prompt previously left startTalking() no-opped by stopTalking() and then publish anyway once the prompt resolved)', async () => {
    const client = makeClient();
    await client.connect();
    const room = roomInstances[0];

    let resolveTrack;
    const micTrackStub = { stop: vi.fn() };
    createLocalAudioTrack.mockImplementation(() => new Promise((resolve) => { resolveTrack = resolve; }));

    const startPromise = client.startTalking();
    // Release before the (still-pending, e.g. permission-prompt-blocked) track resolves.
    await expect(client.stopTalking()).resolves.toBe(false);
    expect(client.isTalking).toBe(false);

    // The permission prompt is answered only *after* release.
    resolveTrack(micTrackStub);
    await expect(startPromise).resolves.toBe(false);

    expect(micTrackStub.stop).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(client.isTalking).toBe(false);
  });

  it('reports a failed mic publication so the UI does not wait for STT that can never start', async () => {
    const client = makeClient();
    await client.connect();
    const room = roomInstances[0];
    const micTrackStub = { stop: vi.fn() };
    createLocalAudioTrack.mockResolvedValue(micTrackStub);
    room.localParticipant.publishTrack.mockRejectedValue(new Error('publish failed'));

    await expect(client.startTalking()).resolves.toBe(false);

    expect(micTrackStub.stop).toHaveBeenCalledTimes(1);
    expect(client.isTalking).toBe(false);
    await expect(client.stopTalking()).resolves.toBe(false);
  });
});

describe('reconnect backoff', () => {
  it('schedules a reconnect with the computed backoff delay after a disconnect', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      await client.connect();
      const room = roomInstances[0];

      room.emit('Disconnected');
      expect(client.status).toBe('idle');
      expect(roomInstances).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(computeBackoffDelay(0) + 10);
      expect(roomInstances).toHaveLength(2);
      expect(client.status).toBe('connected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the reconnect budget is exhausted and surfaces an error status', async () => {
    vi.useFakeTimers();
    try {
      global.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
      const client = makeClient();
      await client.connect();
      expect(client.status).toBe('error');

      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
        await vi.advanceTimersByTimeAsync(computeBackoffDelay(attempt) + 10);
      }
      expect(client.status).toBe('error');

      const callsAfterBudget = global.fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(global.fetch.mock.calls.length).toBe(callsAfterBudget);
    } finally {
      vi.useRealTimers();
    }
  });
});
