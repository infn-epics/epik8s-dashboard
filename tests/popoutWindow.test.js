import { describe, it, expect } from 'vitest';
import { buildPopupFeatures } from '../src/hooks/usePopoutWindow.js';

// The rest of usePopoutWindow.js is real-window/DOM (window.open, document
// cloning, close-detection) dependent - deliberately manual/live-verification
// only, matching this repo's existing convention for real-browser-API code
// (src/services/voiceRoom.js's mic lifecycle, src/hooks/useWakeWord.js's
// audio APIs). buildPopupFeatures is the one pure, non-window-dependent
// piece worth a unit test.
describe('buildPopupFeatures', () => {
  it('defaults to a fixed size', () => {
    expect(buildPopupFeatures()).toBe('width=420,height=520,popup=1');
  });

  it('honors an explicit size', () => {
    expect(buildPopupFeatures(800, 600)).toBe('width=800,height=600,popup=1');
  });
});
