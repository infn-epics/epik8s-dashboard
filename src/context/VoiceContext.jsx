import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from './AppContext.jsx';
import VoiceRoomClient from '../services/voiceRoom.js';

const VoiceContext = createContext(null);

/**
 * VoiceProvider — owns the single VoiceRoomClient instance for the session.
 *
 * Intentionally thin: only connection status, not transcript/highlight
 * state, so components that only care whether the room is connected (e.g.
 * a status dot) don't re-render on every data-channel message. Always
 * mounts so useVoice()/useVoiceHighlight() never throw, but no-ops
 * (no connect(), no client work) when voiceConfig.enabled is false.
 */
export function VoiceProvider({ children }) {
  const { voiceConfig } = useApp();
  const clientRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [selectedModel, setSelectedModel] = useState('');

  if (!clientRef.current) {
    clientRef.current = new VoiceRoomClient({});
  }

  useEffect(() => {
    const client = clientRef.current;
    const unsub = client.onStatusChange(setConnectionStatus);
    return unsub;
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    client.disconnect();
    if (!voiceConfig?.enabled) return undefined;

    client.tokenEndpoint = voiceConfig.tokenEndpoint;
    client.serverUrl = voiceConfig.serverUrl;
    client.roomName = voiceConfig.roomName;
    client.identityPrefix = voiceConfig.identityPrefix || 'operator';
    const configuredModels = voiceConfig.models || [];
    const defaultModel = voiceConfig.defaultModel || configuredModels[0]?.id || '';
    const model = configuredModels.some((entry) => entry.id === selectedModel)
      ? selectedModel : defaultModel;
    client.model = model;
    if (model !== selectedModel) setSelectedModel(model);
    client.connect();

    return () => client.disconnect();
  }, [voiceConfig?.enabled, voiceConfig?.tokenEndpoint, voiceConfig?.serverUrl, voiceConfig?.roomName, voiceConfig?.identityPrefix, voiceConfig?.defaultModel, voiceConfig?.models, selectedModel]);

  const connect = useCallback(() => clientRef.current.reconnectNow(), []);
  const disconnect = useCallback(() => clientRef.current.disconnect(), []);
  const setModel = useCallback((model) => {
    if (!voiceConfig?.models?.some((entry) => entry.id === model)) return;
    setSelectedModel(model);
  }, [voiceConfig?.models]);

  const value = {
    client: clientRef.current,
    connectionStatus,
    enabled: !!voiceConfig?.enabled,
    connect,
    disconnect,
    selectedModel,
    setModel,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
  return ctx;
}
