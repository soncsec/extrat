import type { BattleState } from '../logic/battle';
import type { Campaign } from '../logic/campaign';
import { decodeSave, encodeSave, type Save } from '../logic/save';
import { decodeSettings, encodeSettings, type Settings } from '../logic/settings';

/**
 * The campaign save in localStorage (ADR-E6), and the player's settings under a key of
 * their own (amended 2026-10-19). Nothing else is stored. The browser may refuse storage
 * (private mode, full disk); the game then plays on without saving.
 */
const KEY = 'extrat.campaign';
const SETTINGS_KEY = 'extrat.settings';

export type StoredSave = { status: 'none' } | { status: 'ok'; save: Save } | { status: 'bad' };

/** The saved campaign, if any. A save that fails the checks is deleted, never used. */
export function readSave(): StoredSave {
  let text: string | null;
  try {
    text = window.localStorage.getItem(KEY);
  } catch {
    return { status: 'none' };
  }
  if (text === null) return { status: 'none' };
  const loaded = decodeSave(text);
  if (loaded.ok) return { status: 'ok', save: loaded.save };
  clearSave();
  return { status: 'bad' };
}

export function writeSave(campaign: Campaign, battle: BattleState | null, replay = false): void {
  try {
    window.localStorage.setItem(KEY, encodeSave(campaign, battle, replay));
  } catch {
    // No storage: the campaign still plays, it just won't resume.
  }
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The player's settings; the defaults if there are none or they aren't ours. */
export function readSettings(): Settings {
  try {
    return decodeSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return decodeSettings(null);
  }
}

export function writeSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, encodeSettings(settings));
  } catch {
    // No storage: the setting lasts for this visit only.
  }
}
