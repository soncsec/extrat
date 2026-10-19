import { describe, expect, it } from 'vitest';
import {
  decodeSettings,
  DEFAULT_SETTINGS,
  encodeSettings,
  MAX_SETTINGS_LENGTH,
} from '../../src/logic/settings';

describe('player settings (ADR-E6, amended 2026-10-19)', () => {
  it('round-trip', () => {
    for (const muted of [true, false]) {
      expect(decodeSettings(encodeSettings({ muted }))).toEqual({ muted });
    }
  });

  it('give the defaults for anything but exactly their own shape', () => {
    const bad: (string | null)[] = [
      null,
      '',
      '{not json',
      'null',
      '[]',
      '"muted"',
      '{}',
      '{"v":1}',
      '{"v":1,"muted":"yes"}',
      '{"v":1,"muted":1}',
      '{"v":2,"muted":true}',
      '{"v":1,"muted":true,"admin":true}',
      '{"muted":true}',
      `{"v":1,"muted":true,"pad":"${'x'.repeat(MAX_SETTINGS_LENGTH)}"}`,
    ];
    for (const text of bad) expect(decodeSettings(text), String(text)).toEqual(DEFAULT_SETTINGS);
  });

  it('never hand out the shared defaults object', () => {
    const a = decodeSettings(null);
    a.muted = true;
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });
});
