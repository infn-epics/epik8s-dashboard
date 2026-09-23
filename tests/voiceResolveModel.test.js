import { describe, it, expect } from 'vitest';
import { resolveVoiceModel } from '../src/voice/resolveModel.js';

const models = [{ id: 'minimax-m27' }, { id: 'qwen36-27b' }];

describe('resolveVoiceModel', () => {
  it('uses the configured default before the operator has picked anything', () => {
    // Initial state is '' - this is the case that used to be "fixed up" by a
    // state write inside the connect effect, which reconnected on every load.
    expect(resolveVoiceModel(models, 'qwen36-27b', '')).toBe('qwen36-27b');
  });

  it('keeps the operator pick while it is still a configured model', () => {
    expect(resolveVoiceModel(models, 'minimax-m27', 'qwen36-27b')).toBe('qwen36-27b');
  });

  it('falls back to the default when the pick is no longer configured', () => {
    expect(resolveVoiceModel(models, 'minimax-m27', 'removed-model')).toBe('minimax-m27');
  });

  it('falls back to the first configured model when there is no default', () => {
    expect(resolveVoiceModel(models, '', '')).toBe('minimax-m27');
    expect(resolveVoiceModel(models, undefined, undefined)).toBe('minimax-m27');
  });

  it('returns an empty string when nothing is configured', () => {
    expect(resolveVoiceModel([], '', '')).toBe('');
    expect(resolveVoiceModel(undefined, undefined, undefined)).toBe('');
  });

  it('is stable for identical inputs (a derived value, not state)', () => {
    expect(resolveVoiceModel(models, 'minimax-m27', '')).toBe(resolveVoiceModel(models, 'minimax-m27', ''));
  });
});
