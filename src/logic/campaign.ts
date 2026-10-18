import { MISSIONS, SKIRMISH } from '../config/tuning';
import { MARINE_NAMES } from './battle';
import { createRng, rngStep } from './rng';

/**
 * The campaign (M5.1): six missions in a row with the same squad. Plain data, so it
 * can be saved later (M5.5). Scenes ask for the next state; they never edit one.
 */
export interface Campaign {
  /** Everything random in the campaign comes from this. */
  seed: number;
  /** Index into MISSIONS of the mission being played (MISSIONS.length when won). */
  mission: number;
  /** Tries at this mission so far (0 for the first). Each retry gets a new map. */
  attempt: number;
  /** Seed of the map this mission is fought on. */
  mapSeed: number;
  /** The squad's names, kept from mission to mission. */
  squad: string[];
}

/** What the player picked on the debrief. */
export type DebriefChoice = 'next' | 'retry' | 'replay';

export function newCampaign(seed: number): Campaign {
  const rng = createRng(seed);
  const names = [...MARINE_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [names[i], names[j]] = [names[j] as string, names[i] as string];
  }
  return {
    seed,
    mission: 0,
    attempt: 0,
    mapSeed: mapSeedFor(seed, 0, 0),
    squad: names.slice(0, SKIRMISH.marines),
  };
}

/** The map seed for a mission try: fixed by the campaign seed, so a campaign replays. */
export function mapSeedFor(campaignSeed: number, mission: number, attempt: number): number {
  const mixed =
    (campaignSeed ^ Math.imul(mission + 1, 0x9e3779b1) ^ Math.imul(attempt + 1, 0x85ebca6b)) >>> 0;
  return 1 + Math.floor(rngStep(mixed).value * 999_999);
}

/** True once the last mission has been won and the player moved on. */
export function isComplete(c: Campaign): boolean {
  return c.mission >= MISSIONS.length;
}

/** The mission being played (or the last one, once the campaign is complete). */
export function currentMission(c: Campaign): (typeof MISSIONS)[number] {
  return MISSIONS[Math.min(c.mission, MISSIONS.length - 1)] as (typeof MISSIONS)[number];
}

/**
 * The campaign after a battle and the player's choice on the debrief:
 * - 'next' (after a win): on to the next mission, on a new map;
 * - 'retry' (after a loss): the same mission on a new map (M5.4);
 * - 'replay' (either): the same mission on the same map. It never moves the campaign on.
 * A choice that doesn't fit the result changes nothing.
 */
export function afterBattle(c: Campaign, won: boolean, choice: DebriefChoice): Campaign {
  if (isComplete(c)) return c;
  if (choice === 'replay') return c;
  if (choice === 'next' && won) {
    const mission = c.mission + 1;
    return { ...c, mission, attempt: 0, mapSeed: mapSeedFor(c.seed, mission, 0) };
  }
  if (choice === 'retry' && !won) {
    const attempt = c.attempt + 1;
    return { ...c, attempt, mapSeed: mapSeedFor(c.seed, c.mission, attempt) };
  }
  return c;
}
