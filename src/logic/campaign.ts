import { MISSIONS, RANKS, SKIRMISH, XP } from '../config/tuning';
import { MARINE_NAMES, type BattleState } from './battle';
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
  /** Each marine's XP, in squad order (M5.2). */
  xp: number[];
  /** How many times each marine has died this campaign, in squad order (M5.3). */
  deaths: number[];
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
    xp: Array.from({ length: SKIRMISH.marines }, () => 0),
    deaths: Array.from({ length: SKIRMISH.marines }, () => 0),
  };
}

/**
 * The campaign with a death counted for each marine lying dead in a finished battle
 * (M5.3). They come back next mission at full health: shame is the only cost. Scenes
 * don't call this for a replayed battle, as with XP.
 */
export function recordDeaths(c: Campaign, battle: BattleState): Campaign {
  const deaths = c.deaths.map((d, i) => {
    const marine = battle.units.find((u) => u.id === `m${i + 1}`);
    return marine && marine.hp <= 0 ? d + 1 : d;
  });
  return { ...c, deaths };
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

/** The highest rank this much XP has earned (an index into RANKS). */
export function rankForXp(xp: number): number {
  let rank = 0;
  RANKS.forEach((r, i) => {
    if (xp >= r.xp) rank = i;
  });
  return rank;
}

/** Each marine's rank, in squad order. */
export function squadRanks(c: Campaign): number[] {
  return c.xp.map(rankForXp);
}

/** A marine who went up a rank. */
export interface Promotion {
  name: string;
  rank: number;
}

/**
 * The XP each marine (in squad order) earned in a finished battle: their hits and
 * kills, and the mission bonus if the squad won. Fallen marines keep what they earned
 * and get the bonus too: they come back next mission (no permadeath).
 */
export function battleXp(battle: BattleState, won: boolean): number[] {
  return Array.from({ length: SKIRMISH.marines }, (_, i) => {
    const marine = battle.units.find((u) => u.id === `m${i + 1}`);
    return (
      (marine?.hits ?? 0) * XP.hit + (marine?.kills ?? 0) * XP.kill + (won ? XP.missionWon : 0)
    );
  });
}

/**
 * The campaign with a battle's XP added (capped at XP.max), and who was promoted.
 * Scenes don't call this for a battle started with REPLAY: replays earn no XP.
 */
export function awardXp(
  c: Campaign,
  gained: readonly number[],
): { campaign: Campaign; promotions: Promotion[] } {
  const xp = c.xp.map((x, i) => Math.min(XP.max, x + Math.max(0, gained[i] ?? 0)));
  const promotions: Promotion[] = [];
  xp.forEach((x, i) => {
    const before = rankForXp(c.xp[i] ?? 0);
    const after = rankForXp(x);
    if (after > before) promotions.push({ name: c.squad[i] ?? '', rank: after });
  });
  return { campaign: { ...c, xp }, promotions };
}
