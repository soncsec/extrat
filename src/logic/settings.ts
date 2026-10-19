/**
 * The player's settings (ADR-E6, amended 2026-10-19 with the owner's approval): kept in
 * localStorage under their own key, beside the campaign save. Only whether sound is
 * muted, for now. Like the save, nothing read back is trusted: anything but exactly the
 * expected shape gives the defaults.
 */
export interface Settings {
  muted: boolean;
}

export const SETTINGS_VERSION = 1;
export const DEFAULT_SETTINGS: Readonly<Settings> = { muted: false };
/** Settings text longer than this isn't ours: ignored without parsing. */
export const MAX_SETTINGS_LENGTH = 256;

export function encodeSettings(s: Settings): string {
  return JSON.stringify({ v: SETTINGS_VERSION, muted: s.muted });
}

/** The settings in `text`, or the defaults if it is missing or not exactly ours. */
export function decodeSettings(text: string | null): Settings {
  if (text === null || text.length > MAX_SETTINGS_LENGTH) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ...DEFAULT_SETTINGS };
  }
  const keys = Object.keys(data);
  const { v, muted } = data as Record<string, unknown>;
  if (keys.length !== 2 || v !== SETTINGS_VERSION || typeof muted !== 'boolean') {
    return { ...DEFAULT_SETTINGS };
  }
  return { muted };
}
