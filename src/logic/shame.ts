import { SHAME } from '../config/tuning';
import type { Campaign } from './campaign';
import { createRng } from './rng';

/*
 * The Wall of Shame (M5.3): a marine who dies comes back next mission, but shamed.
 * Everything here is cosmetic. The owner reviews these starter lists (2026-10-18).
 */

/** Nicknames after a first death. Each marine in a squad gets a different one. */
export const NICKNAMES = [
  'Speed Bump',
  'Bullet Sponge',
  'Target Practice',
  'Sleeping Beauty',
  'Paperweight',
  'Decoy',
  'Welcome Mat',
  'Chew Toy',
  'Tripwire',
  'Crash Test',
] as const;

/** Nicknames after SHAME.veteranDeaths deaths. */
export const VETERAN_NICKNAMES = [
  'Frequent Flyer',
  'Nine Lives',
  'Boomerang',
  'Reliable Casualty',
  'Immortal (Not)',
] as const;

/** Debrief lines for a marine lost in the battle; {name} is the marine's. */
export const JOKES = [
  '{name} found the one tile with no cover.',
  '{name} is thinking about a desk job.',
  '{name} called it a tactical lie-down.',
  'The aliens send {name} their regards.',
  '{name} led from the front. Briefly.',
  '{name} tested the ground. It is still hard.',
  '{name} will be fine. Probably.',
  '{name} took one for the team. Again.',
] as const;

/** The debrief line when the whole squad was lost. */
export const WIPE_JOKE = 'The whole squad took the day off. Back tomorrow.';

/** The Wall of Shame when nobody has died yet. */
export const NO_SHAME = 'No shame yet. Keep it that way.';

/** The most debrief lines shown at once. */
export const MAX_JOKES = 2;

/** A copy of `items` shuffled by `seed`. */
function shuffledBy<T>(seed: number, items: readonly T[]): T[] {
  const rng = createRng(seed >>> 0);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Marine `i`'s nickname, or null while they have never died. Fixed by the campaign
 * seed, so it never changes between screens, and different for each marine.
 */
export function nicknameFor(c: Campaign, i: number): string | null {
  const deaths = c.deaths[i] ?? 0;
  if (deaths <= 0) return null;
  const veteran = deaths >= SHAME.veteranDeaths;
  const list = shuffledBy(c.seed ^ (veteran ? 0x5ead : 0), veteran ? VETERAN_NICKNAMES : NICKNAMES);
  return list[i % list.length] ?? null;
}

/**
 * The debrief's lines about the marines lost in a battle (at most MAX_JOKES), picked
 * by the map seed so a replayed map tells the same jokes. Empty if nobody was lost.
 */
export function debriefJokes(
  lost: readonly string[],
  squadSize: number,
  mapSeed: number,
): string[] {
  if (lost.length === 0) return [];
  if (lost.length >= squadSize) return [WIPE_JOKE];
  const jokes = shuffledBy(mapSeed, JOKES);
  return lost.slice(0, MAX_JOKES).map((name, i) => (jokes[i] as string).replace('{name}', name));
}
