import { ABILITIES, ACTION_POINTS, MISSIONS, SKIRMISH } from '../config/tuning';
import {
  clipSize,
  createBattle,
  isVisibleTo,
  MARINE_NAMES,
  type BattleState,
  type Unit,
} from './battle';
import { currentMission, mapSeedFor, type Campaign } from './campaign';
import { isWalkable, type BattleMap } from './map';

/**
 * The campaign save (M5.5, ADR-E6): one versioned JSON record in the browser.
 *
 * It holds as little as possible, and nothing in it is trusted on load. The map is
 * never stored: it is rebuilt from its seed. A battle is rebuilt fresh from the
 * campaign, and only the units' changeable fields are taken from the save, each one
 * checked. Anything unexpected (wrong version, an extra field, a number out of range,
 * a unit standing in a tree) rejects the whole save.
 */
export const SAVE_VERSION = 1;
/** A save larger than this isn't ours: it is rejected before parsing. */
export const MAX_SAVE_LENGTH = 16_384;

/** The fields of a unit that change during a battle (everything else comes from its kind). */
export interface SavedUnit {
  id: string;
  x: number;
  y: number;
  hp: number;
  ap: number;
  ammo: number | null;
  overwatch: boolean;
  grenades: number;
  exposed: boolean;
  dormant: boolean;
  poison: number;
  facing: 1 | -1;
}

/** A battle saved at the start of the squad's turn. */
export interface SavedBattle {
  round: number;
  rng: number;
  units: SavedUnit[];
}

export interface Save {
  v: typeof SAVE_VERSION;
  campaign: Campaign;
  /** The mission in progress, or null between missions (at a briefing). */
  battle: SavedBattle | null;
}

export type LoadResult = { ok: true; save: Save } | { ok: false; reason: string };

/** The save text for a campaign, and the battle in progress if any. */
export function encodeSave(campaign: Campaign, battle: BattleState | null): string {
  const save: Save = {
    v: SAVE_VERSION,
    campaign: {
      seed: campaign.seed,
      mission: campaign.mission,
      attempt: campaign.attempt,
      mapSeed: campaign.mapSeed,
      squad: [...campaign.squad],
    },
    battle: battle
      ? {
          round: battle.round,
          rng: battle.rng,
          units: battle.units.map((u) => ({
            id: u.id,
            x: u.x,
            y: u.y,
            hp: u.hp,
            ap: u.ap,
            ammo: u.ammo,
            overwatch: u.overwatch,
            grenades: u.grenades,
            exposed: u.exposed,
            dormant: u.dormant,
            poison: u.poison,
            facing: u.facing,
          })),
        }
      : null,
  };
  return JSON.stringify(save);
}

/**
 * Reads save text and checks its shape and the campaign's numbers. A mid-mission
 * battle is checked further against its map by restoreBattle.
 */
export function decodeSave(text: string): LoadResult {
  if (text.length > MAX_SAVE_LENGTH) return fail('too large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('not valid JSON');
  }
  if (!isRecord(data) || !hasOnly(data, ['v', 'campaign', 'battle'])) return fail('bad shape');
  if (data.v !== SAVE_VERSION) return fail('unknown version');
  const campaign = checkCampaign(data.campaign);
  if (!campaign) return fail('bad campaign');
  if (data.battle === null) return { ok: true, save: { v: SAVE_VERSION, campaign, battle: null } };
  const battle = checkBattleShape(data.battle);
  if (!battle) return fail('bad battle');
  return { ok: true, save: { v: SAVE_VERSION, campaign, battle } };
}

/**
 * The battle a save resumes: built fresh from the campaign's mission and map (the same
 * units, kinds and names every time), with each unit's changeable fields from the save
 * after checking them against the map. Null if anything doesn't fit.
 */
export function restoreBattle(
  campaign: Campaign,
  saved: SavedBattle,
  buildMap: (mapSeed: number) => BattleMap,
): BattleState | null {
  const map = buildMap(campaign.mapSeed);
  const fresh = createBattle(map, map.seed, {
    names: campaign.squad,
    pods: currentMission(campaign).pods,
  });
  if (saved.units.length !== fresh.units.length) return null;
  const byId = new Map(saved.units.map((u) => [u.id, u]));
  if (byId.size !== saved.units.length) return null;
  const taken = new Set<number>();
  const units: Unit[] = [];
  for (const base of fresh.units) {
    const s = byId.get(base.id);
    if (!s) return null;
    if (s.x >= map.cols || s.y >= map.rows) return null;
    if (s.hp > base.maxHp || s.grenades > base.grenades) return null;
    const clip = clipSize(base);
    if ((clip === null) !== (s.ammo === null) || (clip !== null && (s.ammo ?? 0) > clip)) {
      return null;
    }
    if (s.dormant && base.side !== 'alien') return null;
    if (s.hp > 0) {
      // The living stand on free ground, one to a tile.
      const key = s.y * map.cols + s.x;
      if (!isWalkable(map, s.x, s.y) || taken.has(key)) return null;
      taken.add(key);
    }
    units.push({ ...base, ...s });
  }
  const alive = (side: Unit['side']): boolean => units.some((u) => u.side === side && u.hp > 0);
  if (!alive('marine') || !alive('alien')) return null;
  const state: BattleState = {
    ...fresh,
    units,
    turn: 'marine',
    round: saved.round,
    rng: saved.rng,
    selected: null,
    lastShot: null,
    lastMove: null,
    lastThrow: null,
    lastPoison: [],
  };
  // A dormant alien the squad can already see would have been woken: not a real save.
  if (units.some((u) => u.dormant && u.hp > 0 && isVisibleTo(state, 'marine', u))) return null;
  return state;
}

function fail(reason: string): LoadResult {
  return { ok: false, reason };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True if the object has exactly these own keys (no more, no fewer). */
function hasOnly(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function checkCampaign(v: unknown): Campaign | null {
  if (!isRecord(v) || !hasOnly(v, ['seed', 'mission', 'attempt', 'mapSeed', 'squad'])) {
    return null;
  }
  const { seed, mission, attempt, mapSeed, squad } = v;
  if (!isInt(seed, 0, 0xffffffff)) return null;
  // A completed campaign isn't saved, so the mission is always one still to play.
  if (!isInt(mission, 0, MISSIONS.length - 1)) return null;
  if (!isInt(attempt, 0, 100_000)) return null;
  // The map seed isn't free: it must be the one this campaign gives this try.
  if (mapSeed !== mapSeedFor(seed, mission, attempt)) return null;
  if (!Array.isArray(squad) || squad.length !== SKIRMISH.marines) return null;
  const names = MARINE_NAMES as readonly string[];
  if (!squad.every((n) => typeof n === 'string' && names.includes(n))) return null;
  if (new Set(squad).size !== squad.length) return null;
  return { seed, mission, attempt, mapSeed, squad: [...(squad as string[])] };
}

const UNIT_KEYS = [
  'id',
  'x',
  'y',
  'hp',
  'ap',
  'ammo',
  'overwatch',
  'grenades',
  'exposed',
  'dormant',
  'poison',
  'facing',
] as const;

function checkBattleShape(v: unknown): SavedBattle | null {
  if (!isRecord(v) || !hasOnly(v, ['round', 'rng', 'units'])) return null;
  const { round, rng, units } = v;
  if (!isInt(round, 1, 10_000) || !isInt(rng, 0, 0xffffffff)) return null;
  if (!Array.isArray(units) || units.length === 0 || units.length > 64) return null;
  const out: SavedUnit[] = [];
  for (const u of units) {
    if (!isRecord(u) || !hasOnly(u, UNIT_KEYS)) return null;
    const { id, x, y, hp, ap, ammo, overwatch, grenades, exposed, dormant, poison, facing } = u;
    if (typeof id !== 'string' || !/^[am][0-9]{1,2}$/.test(id)) return null;
    if (!isInt(x, 0, 255) || !isInt(y, 0, 255) || !isInt(hp, 0, 99)) return null;
    if (!isInt(ap, 0, ACTION_POINTS) || !isInt(grenades, 0, 9)) return null;
    if (ammo !== null && !isInt(ammo, 0, 99)) return null;
    if (typeof overwatch !== 'boolean' || typeof exposed !== 'boolean') return null;
    if (typeof dormant !== 'boolean') return null;
    if (!isInt(poison, 0, ABILITIES.poison.turns)) return null;
    if (facing !== 1 && facing !== -1) return null;
    out.push({ id, x, y, hp, ap, ammo, overwatch, grenades, exposed, dormant, poison, facing });
  }
  return { round, rng, units: out };
}
