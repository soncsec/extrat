import {
  ABILITIES,
  ACTION_POINTS,
  BOSS,
  FOREST,
  MAP_COLS,
  MAP_ROWS,
  MISSIONS,
  SKIRMISH,
  XP,
} from '../config/tuning';
import {
  clipSize,
  createBattle,
  footprint,
  MARINE_NAMES,
  SUPPLY_IDS,
  unitVisibleTo,
  type BattleState,
  type SupplyId,
  type Unit,
} from './battle';
import { currentMission, mapSeedFor, squadRanks, type Campaign } from './campaign';
import { blastOutcome, generateMap, isWalkable, type BattleMap } from './map';

/**
 * The campaign save (M5.5, ADR-E6): one versioned JSON record in the browser.
 *
 * It holds as little as possible, and nothing in it is trusted on load. The map is
 * never stored: it is rebuilt from its seed. A battle is rebuilt fresh from the
 * campaign, and only the units' changeable fields are taken from the save, each one
 * checked. Anything unexpected (wrong version, an extra field, a number out of range,
 * a unit standing in a tree) rejects the whole save.
 */
export const SAVE_VERSION = 7;
/**
 * Older saves still load, checked just as strictly, with the fields they lack at their
 * starting values. Version 1 (M5.5) had no XP, kills or replay flag; version 2 (M5.2)
 * had no hit counts; version 3 (M5.9) had no death counts; version 4 (M5.3) had none
 * of the boss's front, charge or rest (M5.6); version 5 had no supply (M5.10); version 6
 * had no wrecked cover (M5.13).
 */
const OLDEST_VERSION = 1;
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
  kills: number;
  hits: number;
  /** The boss's state (M5.6); missing from saves before version 5, which had no boss. */
  front?: -1 | 0 | 1;
  charging?: { x: number; y: number } | null;
  cooldown?: number;
}

/** A battle saved at the start of the squad's turn. */
export interface SavedBattle {
  round: number;
  rng: number;
  units: SavedUnit[];
  /** Started with REPLAY: it earns no XP, even after a reload. */
  replay: boolean;
  /**
   * Cover grenades wrecked (M5.13): each tile (y * cols + x) once, in order, and what's
   * there now (a trunk, or nothing). Empty before version 7.
   */
  wrecks: [number, 'trunk' | null][];
}

export interface Save {
  v: typeof SAVE_VERSION;
  campaign: Campaign;
  /** The mission in progress, or null between missions (at a briefing). */
  battle: SavedBattle | null;
}

export type LoadResult = { ok: true; save: Save } | { ok: false; reason: string };

/** The save text for a campaign, and the battle in progress if any. */
export function encodeSave(campaign: Campaign, battle: BattleState | null, replay = false): string {
  const save: Save = {
    v: SAVE_VERSION,
    campaign: {
      seed: campaign.seed,
      mission: campaign.mission,
      attempt: campaign.attempt,
      mapSeed: campaign.mapSeed,
      squad: [...campaign.squad],
      xp: [...campaign.xp],
      deaths: [...campaign.deaths],
      supply: campaign.supply,
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
            kills: u.kills,
            hits: u.hits,
            front: u.front,
            charging: u.charging ? { x: u.charging.x, y: u.charging.y } : null,
            cooldown: u.cooldown,
          })),
          replay,
          wrecks: (battle.map.wrecked ?? []).map((i): [number, 'trunk' | null] => [
            i,
            battle.map.tiles[i]?.prop === 'trunk' ? 'trunk' : null,
          ]),
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
  const v = data.v;
  if (!isInt(v, OLDEST_VERSION, SAVE_VERSION)) return fail('unknown version');
  const campaign = checkCampaign(data.campaign, v);
  if (!campaign) return fail('bad campaign');
  if (data.battle === null) return { ok: true, save: { v: SAVE_VERSION, campaign, battle: null } };
  const battle = checkBattleShape(data.battle, v);
  if (!battle) return fail('bad battle');
  return { ok: true, save: { v: SAVE_VERSION, campaign, battle } };
}

/**
 * The battle a save resumes: built fresh from the campaign's mission and map (the same
 * units, kinds and names every time), with each unit's changeable fields from the save
 * after checking them against the map. Null if anything doesn't fit.
 *
 * The map is built here from the mission's own landscape, never passed in, so the
 * units are always checked against the map the battle is fought on.
 */
export function restoreBattle(campaign: Campaign, saved: SavedBattle): BattleState | null {
  const mission = currentMission(campaign);
  const built = generateMap(campaign.mapSeed, MAP_COLS, MAP_ROWS, mission.landscape);
  const fresh = createBattle(built, built.seed, {
    names: campaign.squad,
    pods: mission.pods,
    kinds: mission.kinds,
    ranks: squadRanks(campaign),
    boss: 'boss' in mission && mission.boss === true,
    supply: campaign.supply,
  });
  // Units are checked against the map as grenades left it.
  const map = rewreck(built, saved.wrecks);
  if (!map) return null;
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
    // The boss's state belongs to the boss alone, and its charge lands on the map.
    if (base.kind === 'overseer') {
      if (s.front === 0) return null;
      if (s.charging && (s.charging.x >= map.cols || s.charging.y >= map.rows)) return null;
    } else if ((s.front ?? 0) !== 0 || (s.charging ?? null) !== null || (s.cooldown ?? 0) !== 0) {
      return null;
    }
    if (s.hp > 0) {
      // The living stand on free ground, one to a tile (the boss on all four of its own).
      for (const t of footprint({ kind: base.kind, x: s.x, y: s.y })) {
        const key = t.y * map.cols + t.x;
        if (!isWalkable(map, t.x, t.y) || taken.has(key)) return null;
        taken.add(key);
      }
    }
    units.push({ ...base, ...s });
  }
  const alive = (side: Unit['side']): boolean => units.some((u) => u.side === side && u.hp > 0);
  if (!alive('marine') || !alive('alien')) return null;
  // A side can't have killed more than the other side has lost.
  const count = (side: Unit['side'], f: (u: Unit) => number): number =>
    units.filter((u) => u.side === side).reduce((n, u) => n + f(u), 0);
  const dead = (u: Unit): number => (u.hp <= 0 ? 1 : 0);
  if (count('marine', (u) => u.kills) > count('alien', dead)) return null;
  if (count('alien', (u) => u.kills) > count('marine', dead)) return null;
  // Every hit took at least a point of health off the other side.
  const lost = (u: Unit): number => u.maxHp - u.hp;
  if (count('marine', (u) => u.hits) > count('alien', lost)) return null;
  if (count('alien', (u) => u.hits) > count('marine', lost)) return null;
  const state: BattleState = {
    ...fresh,
    map,
    units,
    turn: 'marine',
    round: saved.round,
    rng: saved.rng,
    selected: null,
    lastShot: null,
    lastMove: null,
    supply: fresh.supply,
    lastThrow: null,
    lastBlast: null,
    lastPoison: [],
  };
  // A dormant alien the squad can already see would have been woken: not a real save.
  if (units.some((u) => u.dormant && u.hp > 0 && unitVisibleTo(state, 'marine', u))) return null;
  return state;
}

/**
 * The map with a save's wrecked cover (M5.13) put back, or null if any of it couldn't
 * have happened: a tile off the map, in the edge rows, listed twice, or whose prop a
 * blast doesn't leave like that (only a tree leaves a trunk).
 */
function rewreck(map: BattleMap, wrecks: SavedBattle['wrecks']): BattleMap | null {
  if (wrecks.length === 0) return map;
  const tiles = [...map.tiles];
  const wrecked: number[] = [];
  for (const [i, to] of wrecks) {
    if (i >= tiles.length || wrecked.includes(i)) return null;
    if (Math.floor(i / map.cols) < FOREST.treeLineRows) return null;
    const outcome = blastOutcome(tiles[i]?.prop ?? null);
    // Blown down to a trunk; or blown away, a tree perhaps by a second grenade.
    if (outcome === undefined || (to === 'trunk' && outcome !== 'trunk')) return null;
    tiles[i] = to === 'trunk' ? { prop: 'trunk', anchor: true } : { prop: null, anchor: false };
    wrecked.push(i);
  }
  return { ...map, tiles, wrecked };
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

const CAMPAIGN_KEYS = ['seed', 'mission', 'attempt', 'mapSeed', 'squad'] as const;

function checkCampaign(v: unknown, version: number): Campaign | null {
  const old = version < 2;
  const keys = old
    ? CAMPAIGN_KEYS
    : version < 4
      ? [...CAMPAIGN_KEYS, 'xp']
      : version < 6
        ? [...CAMPAIGN_KEYS, 'xp', 'deaths']
        : [...CAMPAIGN_KEYS, 'xp', 'deaths', 'supply'];
  if (!isRecord(v) || !hasOnly(v, keys)) return null;
  const { seed, mission, attempt, mapSeed, squad } = v;
  const xp = old ? noXp() : v.xp;
  const deaths = version < 4 ? noXp() : v.deaths;
  // Before version 6 there was no supply: the next briefing offers one if it's due.
  const supply = version < 6 ? null : v.supply;
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
  if (!Array.isArray(xp) || xp.length !== squad.length) return null;
  if (!xp.every((x) => isInt(x, 0, XP.max))) return null;
  if (!Array.isArray(deaths) || deaths.length !== squad.length) return null;
  if (!deaths.every((d) => isInt(d, 0, 100_000))) return null;
  // One of the named supplies, never on the first mission (nothing won yet).
  const ids = SUPPLY_IDS as readonly unknown[];
  if (supply !== null && (!ids.includes(supply) || mission === 0)) return null;
  return {
    seed,
    mission,
    attempt,
    mapSeed,
    squad: [...(squad as string[])],
    xp: [...(xp as number[])],
    deaths: [...(deaths as number[])],
    supply: supply as SupplyId | null,
  };
}

/** Zero for each marine: the XP of a version 1 save, or the deaths of one before 4. */
function noXp(): number[] {
  return Array.from({ length: SKIRMISH.marines }, () => 0);
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

function checkBattleShape(v: unknown, version: number): SavedBattle | null {
  const old = version < 2;
  if (
    !isRecord(v) ||
    !hasOnly(
      v,
      old
        ? ['round', 'rng', 'units']
        : version < 7
          ? ['round', 'rng', 'units', 'replay']
          : ['round', 'rng', 'units', 'replay', 'wrecks'],
    )
  ) {
    return null;
  }
  const { round, rng, units } = v;
  const replay = old ? false : v.replay;
  if (typeof replay !== 'boolean') return null;
  if (!isInt(round, 1, 10_000) || !isInt(rng, 0, 0xffffffff)) return null;
  if (!Array.isArray(units) || units.length === 0 || units.length > 64) return null;
  const out: SavedUnit[] = [];
  for (const u of units) {
    const keys = old
      ? UNIT_KEYS
      : version < 3
        ? [...UNIT_KEYS, 'kills']
        : version < 5
          ? [...UNIT_KEYS, 'kills', 'hits']
          : [...UNIT_KEYS, 'kills', 'hits', 'front', 'charging', 'cooldown'];
    if (!isRecord(u) || !hasOnly(u, keys)) return null;
    const { id, x, y, hp, ap, ammo, overwatch, grenades, exposed, dormant, poison, facing } = u;
    const kills = old ? 0 : u.kills;
    const hits = version < 3 ? 0 : u.hits;
    if (!isInt(kills, 0, 64) || !isInt(hits, 0, 999)) return null;
    // Every kill was a hit. A version 2 save's hits are lost: they start again at 0.
    if (version >= 3 && hits < kills) return null;
    if (typeof id !== 'string' || !/^[am][0-9]{1,2}$/.test(id)) return null;
    if (!isInt(x, 0, 255) || !isInt(y, 0, 255) || !isInt(hp, 0, 99)) return null;
    if (!isInt(ap, 0, ACTION_POINTS) || !isInt(grenades, 0, 9)) return null;
    if (ammo !== null && !isInt(ammo, 0, 99)) return null;
    if (typeof overwatch !== 'boolean' || typeof exposed !== 'boolean') return null;
    if (typeof dormant !== 'boolean') return null;
    if (!isInt(poison, 0, ABILITIES.poison.turns)) return null;
    if (facing !== 1 && facing !== -1) return null;
    const boss = version >= 5 ? checkBossState(u) : null;
    if (version >= 5 && !boss) return null;
    out.push({
      id,
      x,
      y,
      hp,
      ap,
      ammo,
      overwatch,
      grenades,
      exposed,
      dormant,
      poison,
      facing,
      kills,
      hits,
      ...(boss ?? {}),
    });
  }
  const wrecks = version < 7 ? [] : checkWrecks(v.wrecks);
  if (!wrecks) return null;
  return { round, rng, units: out, replay, wrecks };
}

/** A save's wrecked cover (version 7): [tile, 'trunk' or null] pairs, each tile once. */
function checkWrecks(v: unknown): SavedBattle['wrecks'] | null {
  if (!Array.isArray(v) || v.length > MAP_COLS * MAP_ROWS) return null;
  const out: SavedBattle['wrecks'] = [];
  const seen = new Set<number>();
  for (const w of v) {
    if (!Array.isArray(w) || w.length !== 2) return null;
    const [i, to] = w as unknown[];
    if (!isInt(i, 0, MAP_COLS * MAP_ROWS - 1) || seen.has(i)) return null;
    if (to !== 'trunk' && to !== null) return null;
    seen.add(i);
    out.push([i, to]);
  }
  return out;
}

/** A unit's boss fields from a version 5 save, or null if any is out of shape. */
function checkBossState(
  u: Record<string, unknown>,
): Required<Pick<SavedUnit, 'front' | 'charging' | 'cooldown'>> | null {
  const { front, charging, cooldown } = u;
  if (front !== -1 && front !== 0 && front !== 1) return null;
  if (!isInt(cooldown, 0, BOSS.blast.cooldown)) return null;
  if (charging === null) return { front, charging: null, cooldown };
  if (!isRecord(charging) || !hasOnly(charging, ['x', 'y'])) return null;
  if (!isInt(charging.x, 0, 255) || !isInt(charging.y, 0, 255)) return null;
  return { front, charging: { x: charging.x, y: charging.y }, cooldown };
}
