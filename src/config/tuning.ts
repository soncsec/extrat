/** All gameplay numbers live here so they can be tuned in one place. */

/** Size of one map tile in art pixels. */
export const TILE = 16;

/** The battle map, in tiles. */
export const MAP_COLS = 24;
export const MAP_ROWS = 14;

/** Height of the info bar under the map, in art pixels. */
export const HUD_HEIGHT = 32;

export const GAME_WIDTH = MAP_COLS * TILE;
export const GAME_HEIGHT = MAP_ROWS * TILE + HUD_HEIGHT;

/** Seed for the random number generator; override with ?seed= in the URL. */
export const DEFAULT_SEED = 1;

/** The forest map generator (M1; replaced by the chunk-based generator in M4). */
export const FOREST = {
  /** Rows of dense pine forest along the top edge. */
  treeLineRows: 2,
  /** Columns at each side kept as spawn zones: only light-cover chunks there. */
  spawnCols: 4,
  /** Size of a map chunk (ADR-E3) in tiles. A 24 x 12 field is 4 x 3 chunks. */
  chunk: { width: 6, height: 4 },
  /** Chances for a chunk's '*' (maybe cover) tile: bush, rocks, else open. */
  maybeCover: { bush: 0.35, rocks: 0.25 },
  /** Chances for a chunk's '#' (maybe tree) tile: pine, oak, else open. */
  maybeTree: { pine: 0.4, oak: 0.25 },
  /** Extra half cover scattered anywhere below the tree line, on top of the chunks. */
  scatter: { bushes: 3, rocks: 2 },
  dirtPatches: 3,
  /** Each spawn zone needs at least this many free tiles. */
  minSpawnTiles: 12,
  /** Free tiles in the squad's spawn zone with cover facing the enemy: one per marine. */
  minSquadCover: 4,
  /** The two spawn zones must be at least this many steps apart on foot. */
  minSpawnSteps: 14,
  /** Seeds tried before giving up on a valid map. */
  maxAttempts: 50,
} as const;

/**
 * Alien groups ("pods"): they wait, out of sight, until a marine spots one of them,
 * then the whole pod scrambles to cover (M3.2).
 */
export const PODS = {
  count: 2,
  size: 2,
  /** Pods start somewhere from this column eastwards. */
  westmostColumn: 12,
  /** Pod leaders start at least this many steps apart. */
  minApart: 6,
  /** Pod members start within this many steps of their leader. */
  spread: 2,
} as const;

/**
 * The campaign's missions, in order (M5.1), with their landscape (an id from
 * logic/landscapes.ts). The final mission is on the alien ship (M4.3); coast, rocky hills
 * and crash site come next, and until then those missions use the forest. The boss
 * comes in M5.6. A gentle ramp
 * (owner decision 2026-10-18): more and bigger alien groups as the campaign goes on.
 *
 * `kinds` are the alien kinds that mission can field (M5.8, owner decision 2026-10-18):
 * one new kind per mission, walkers first, so a new player learns one ability at a
 * time, and snakes (poison, the deadliest) no earlier than mission 4. The last kind
 * listed is the new one, and the battle always fields at least one of it.
 */
export const MISSIONS = [
  { landscape: 'forest', pods: { count: 2, size: 2 }, kinds: ['walker'] },
  { landscape: 'town', pods: { count: 2, size: 2 }, kinds: ['walker', 'flyer'] },
  { landscape: 'forest', pods: { count: 3, size: 2 }, kinds: ['walker', 'flyer', 'lizard'] },
  {
    landscape: 'forest',
    pods: { count: 3, size: 2 },
    kinds: ['walker', 'flyer', 'lizard', 'snake'],
  },
  {
    landscape: 'forest',
    pods: { count: 3, size: 3 },
    kinds: ['walker', 'flyer', 'lizard', 'snake'],
  },
  {
    landscape: 'ship',
    pods: { count: 3, size: 3 },
    kinds: ['walker', 'flyer', 'lizard', 'snake'],
  },
] as const satisfies readonly {
  landscape: string;
  pods: { count: number; size: number };
  kinds: readonly (typeof ALIEN_KINDS)[number][];
}[];

/**
 * XP (M5.2). Each marine earns XP for the aliens they kill (shots and grenades), and
 * the whole squad earns the mission bonus for a win. A battle started with REPLAY
 * earns none (owner decision 2026-10-18), so a map can't be farmed.
 */
export const XP = {
  /** Every shot or grenade that hits an enemy, so wounding counts (owner, 2026-10-18). */
  hit: 3,
  kill: 10,
  missionWon: 10,
  /** No marine can have more: saves with more are rejected. */
  max: 10_000,
} as const;

/**
 * Ranks (M5.2): the XP a marine needs for each, and what it adds over a rookie: aim,
 * health, and (M5.9, owner 2026-10-18) something to carry, so a promotion is felt:
 * extra grenades and a bigger clip. Six missions earn a marine about 80-200 XP, so
 * most finish as Sergeants.
 */
export const RANKS = [
  { name: 'Rookie', short: 'RKE', xp: 0, aim: 0, hp: 0, grenades: 0, ammo: 0 },
  { name: 'Squaddie', short: 'SQD', xp: 20, aim: 5, hp: 0, grenades: 0, ammo: 0 },
  { name: 'Corporal', short: 'CPL', xp: 50, aim: 5, hp: 1, grenades: 1, ammo: 0 },
  { name: 'Sergeant', short: 'SGT', xp: 90, aim: 10, hp: 1, grenades: 1, ammo: 1 },
  { name: 'Lieutenant', short: 'LT', xp: 140, aim: 10, hp: 2, grenades: 2, ammo: 1 },
] as const;

/** The Wall of Shame (M5.3): shame is cosmetic only (owner decision 2026-10-17). */
export const SHAME = {
  /** Deaths in a campaign before a marine's nickname gets worse. */
  veteranDeaths: 3,
} as const;

/** Squad and enemy sizes for the skirmish. */
export const SKIRMISH = {
  marines: 4,
  aliens: PODS.count * PODS.size,
  /** Units on the same side start at least this many steps apart. */
  minSpacing: 3,
} as const;

/** Unit stats. */
export const UNITS = {
  /**
   * move: tiles per move action. aim: base hit chance in percent.
   * damage: inclusive range per hit. range: farthest attack in tiles.
   * crit: base chance in percent that a hit is critical.
   * ammo: shots per clip, or null for weapons that never need reloading.
   * ability: what makes the kind different (see ABILITIES).
   */
  marine: {
    hp: 4,
    move: 5,
    aim: 70,
    damage: { min: 2, max: 3 },
    range: 16,
    crit: 10,
    ammo: 3,
    ability: null,
  },
  /**
   * Charges in and claws: reaches the 8 tiles around it, ignores cover, can't watch.
   * Aim was 80 until the balance pass of 2026-10-18 (M5.8): two claws killed a rookie.
   */
  walker: {
    hp: 4,
    move: 5,
    aim: 70,
    damage: { min: 2, max: 3 },
    range: 1.5,
    crit: 10,
    ammo: null,
    ability: 'melee',
  },
  /** Shoots from above: the target's cover counts one step less. */
  flyer: {
    hp: 3,
    move: 6,
    aim: 60,
    damage: { min: 1, max: 2 },
    range: 7,
    crit: 0,
    ammo: null,
    ability: 'fromAbove',
  },
  /** Its tongue drags a marine it hits next to it, out of cover. */
  lizard: {
    hp: 3,
    move: 4,
    aim: 65,
    damage: { min: 1, max: 1 },
    range: 5,
    crit: 0,
    ammo: null,
    ability: 'pull',
  },
  /** Spits venom: a marine it hits is poisoned for a few turns. */
  snake: {
    hp: 3,
    move: 4,
    aim: 60,
    damage: { min: 1, max: 1 },
    range: 6,
    crit: 0,
    ammo: null,
    ability: 'poison',
  },
  /**
   * The Overseer, the final mission's boss (M5.6, docs/boss-design.md): a mech on a
   * 2 x 2 footprint with an armoured front and a charged blast (see BOSS).
   */
  overseer: {
    hp: 12,
    move: 3,
    aim: 75,
    damage: { min: 2, max: 3 },
    range: 7,
    crit: 10,
    ammo: null,
    ability: 'blast',
  },
} as const;

/**
 * The Overseer's rules (M5.6, approved design docs/boss-design.md with its proposed
 * defaults, owner 2026-10-19).
 */
export const BOSS = {
  /** Tiles on each side of its square footprint. */
  size: 2,
  /** The most damage a shot from in front of it does. */
  armourCap: 1,
  /** It starts charging its blast once its health is at or below this share of the most. */
  chargeBelow: 0.5,
  blast: {
    /** Units within this distance of the marked tile are hit: 1.5 covers the 3 x 3 square. */
    radius: 1.5,
    damage: 3,
    /**
     * Alien turns, counted from the one it fires on, before it can charge again: it
     * fires, rests a turn, and may charge on the next.
     */
    cooldown: 2,
  },
} as const;

/** The alien kinds a pod member can be, drawn at random for each one. */
export const ALIEN_KINDS = ['walker', 'flyer', 'lizard', 'snake'] as const;

/** Numbers for the alien abilities. Only aimed attacks use them, not overwatch reactions. */
export const ABILITIES = {
  poison: {
    /** Turns of poison after a hit; a new hit starts the count again. */
    turns: 2,
    /** Health lost at the start of each of the victim's turns. Poison never kills: it stops at 1. */
    damage: 1,
  },
} as const;

/** Hit chance rules (M1; cover and flanking come in M2). */
export const SHOOTING = {
  /** Shots up to this distance (tiles) get no distance penalty. */
  closeRange: 5,
  /** Percent lost per tile beyond closeRange. */
  penaltyPerTile: 3,
  minChance: 10,
  maxChance: 95,
  /** Percent taken off the hit chance when the target has cover facing the shooter. */
  cover: { half: 20, full: 40 },
  /** Extra crit chance, in percent, against a flanked target (no cover facing the shooter). */
  flankCrit: 40,
  /** Extra damage a critical hit does. */
  critDamage: 2,
} as const;

/** How far units see, in tiles. Trees and boulders block sight (the same line as shots). */
export const SIGHT = {
  radius: 12,
} as const;

/** Reaction shots from overwatch, taken when an enemy moves into sight. */
export const OVERWATCH = {
  /** Percent taken off the hit chance: snap shots at a moving target. */
  aimPenalty: 15,
  /** Reaction shots never crit. */
  canCrit: false,
} as const;

/** Frag grenades: thrown at a tile, damage everyone nearby, strip their cover for a turn. */
export const GRENADE = {
  /** Grenades each marine carries into a battle (aliens carry none). */
  perMarine: 1,
  /** Farthest throw, in tiles (it arcs, so trees don't block it). */
  range: 8,
  /** Units within this distance of the target tile are hit: 1.5 covers the 3 x 3 square. */
  radius: 1.5,
  damage: 2,
} as const;

/**
 * How aliens weigh their choices (ADR-E4). Each tile an alien could move to gets a
 * score in points; it goes to the best one, or stays to shoot or watch.
 */
export const AI = {
  /** A shot is worth its hit chance times this... */
  hitValue: 100,
  /** ...plus this when a hit could kill... */
  killValue: 40,
  /** ...plus this times the crit chance (flanking a marine makes crits likely). */
  critValue: 40,
  /** Extra for a lizard's hit that would drag a marine (worth it unless already adjacent). */
  pullValue: 25,
  /** Extra for a snake's hit on a marine who isn't poisoned yet. */
  poisonValue: 20,
  /** For ending a dash within range of a marine: a shot next turn. */
  setupValue: 10,
  /** Lost per tile the nearest marine is out of range. */
  approachCost: 8,
  /** Lost per percent chance that each marine who would see the tile hits the alien there. */
  threatCost: 0.15,
  /** Lost per percent chance of an overwatch reaction shot on the way. */
  overwatchCost: 0.35,
  /** Pod mates try to stay within this many tiles of each other... */
  groupRange: 5,
  /** ...and lose this much per tile beyond it. */
  groupCost: 2,
  /** Lost per step walked, so a shorter move wins a tie. */
  stepCost: 1,
  /**
   * The most a seeded random nudge adds to a tile, so aliens aren't predictable.
   * Less than stepCost: it only breaks near-ties.
   */
  noise: 0.9,
} as const;

/** Action points each unit gets at the start of its side's turn. A move costs 1. */
export const ACTION_POINTS = 2;

/** Presentation speeds. */
export const ANIMATION = {
  /** Tiles per second when a unit runs along a path. */
  runSpeed: 6,
  /** How many times faster the alien turn plays after Space or a tap (M5.11). */
  fastForward: 3,
} as const;
