import {
  ABILITIES,
  ACTION_POINTS,
  ALIEN_KINDS,
  BOSS,
  GRENADE,
  OVERWATCH,
  PODS,
  RANKS,
  SHOOTING,
  SIGHT,
  SKIRMISH,
  SUPPLIES,
  UNITS,
} from '../config/tuning';
import { findPath, hasLineOfSight, reachable, type Point } from './grid';
import {
  blocksSight,
  blastProps,
  isWalkable,
  PROPS,
  spawnZone,
  tileAt,
  type BattleMap,
  type Cover,
  type Wreck,
} from './map';
import { createRng, rngStep, type Rng } from './rng';

/**
 * Battle state and the actions that change it (ADR-E2).
 * Scenes never edit this directly: they call apply() and draw the result.
 */

export type Side = 'marine' | 'alien';
export type UnitKind = keyof typeof UNITS;
export type AlienKind = (typeof ALIEN_KINDS)[number];

export interface Unit extends Point {
  id: string;
  side: Side;
  kind: UnitKind;
  name: string;
  hp: number;
  maxHp: number;
  /** 1 faces right (east), -1 faces left (west). */
  facing: 1 | -1;
  /** Action points left this turn. */
  ap: number;
  /** Tiles per move action. */
  move: number;
  /** Shots left in the clip, or null for a weapon that never needs reloading. */
  ammo: number | null;
  /** Watching for enemies who move into sight; cleared when this unit's turn comes round. */
  overwatch: boolean;
  /** Grenades left. */
  grenades: number;
  /** Caught by a grenade: no cover bonus until the thrower's side starts its next turn. */
  exposed: boolean;
  /** The alien group this unit belongs to (null for marines). */
  pod: number | null;
  /** A pod member that hasn't been spotted yet: it waits and doesn't act. */
  dormant: boolean;
  /** Turns of poison left: it loses health at the start of each of its side's turns. */
  poison: number;
  /**
   * Squares left over from a move cut short (by spotting aliens, or a hidden one in the
   * way): the unit may still walk this far for free. Any other action, or the end of
   * the turn, uses them up.
   */
  freeSteps: number;
  /** Index into RANKS (M5.2): adds aim and health. Aliens are always 0. */
  rank: number;
  /** Enemies this unit has killed in this battle (for XP). */
  kills: number;
  /** Shots and grenades of this unit that hit an enemy (kills included); marines earn XP for them. */
  hits: number;
  /**
   * The boss's armoured front (M5.6): 1 east, -1 west, set toward the nearest marine as
   * each alien turn begins. 0 for every other unit.
   */
  front: -1 | 0 | 1;
  /** The tile at the centre of the boss's charged blast, fired on its next turn (null: none). */
  charging: Point | null;
  /** Alien turns before the boss may charge again (0: it may). */
  cooldown: number;
}

/** Health lost to poison at the start of a side's turn. */
export interface PoisonTick {
  unitId: string;
  damage: number;
  hpAfter: number;
}

export interface BattleState {
  map: BattleMap;
  units: Unit[];
  /** Whose turn it is. */
  turn: Side;
  /** Starts at 1; goes up each time the marines' turn begins again. */
  round: number;
  /** The marine the player is commanding, if any. */
  selected: string | null;
  /** Random generator state for every roll in the battle (ADR-006): saved with the battle. */
  rng: number;
  /** What the most recent shot did, for the scene to animate. */
  lastShot: ShotResult | null;
  /** What the most recent move did, including reaction shots along the way. */
  lastMove: MoveResult | null;
  /** The supply the squad brought (M5.10): its aim counts on every marine's shot. */
  supply: SupplyId | null;
  /** What the most recent grenade did. */
  lastThrow: ThrowResult | null;
  /** What the boss's most recent blast did (M5.6). */
  lastBlast: BlastResult | null;
  /** Poison damage taken when the current turn began. */
  lastPoison: PoisonTick[];
}

export interface ThrowResult {
  unitId: string;
  at: Point;
  /** Everyone caught in the blast (friend or foe), in unit order. */
  hits: { unitId: string; damage: number; hpAfter: number; killed: boolean }[];
  /** A blast wakes a hidden pod: its survivors scramble to cover. */
  scampers: Scamper[];
  /** Cover the blast wrecked (M5.13): blown away, or a tree blown down to its trunk. */
  wrecks: Wreck[];
}

/** The boss's charged blast going off (M5.6). */
export interface BlastResult {
  unitId: string;
  at: Point;
  /** Everyone caught in it (friend or foe), in unit order. */
  hits: { unitId: string; damage: number; hpAfter: number; killed: boolean }[];
}

export interface MoveResult {
  unitId: string;
  /** The tiles actually walked, which stop early if a reaction shot kills the mover. */
  path: Point[];
  /** Reaction shots, each fired when the mover reached path[step]. */
  reactions: { step: number; shot: ShotResult }[];
  /** Aliens the squad spotted on the last tile walked; spotting stops the move there. */
  spotted: string[];
  /** Woken aliens' free scramble to cover, in order. */
  scampers: Scamper[];
}

/** A woken alien's free move to cover. */
export interface Scamper {
  unitId: string;
  path: Point[];
}

export interface ShotResult {
  shooterId: string;
  targetId: string;
  /** Hit chance in percent when the shot was taken. */
  chance: number;
  hit: boolean;
  /** A critical hit: extra damage, more likely when flanking. */
  crit: boolean;
  damage: number;
  /** The target's health after this shot. */
  hpAfter: number;
  killed: boolean;
  /** An overwatch reaction shot rather than an aimed one. */
  reaction: boolean;
  /** A lizard's tongue dragged the target here (null: it wasn't moved). */
  pulledTo: Point | null;
  /** A snake's venom poisoned the target. */
  poisoned: boolean;
}

export type Action =
  | { type: 'select'; unitId: string }
  | { type: 'deselect' }
  | { type: 'move'; unitId: string; to: Point }
  | { type: 'shoot'; unitId: string; targetId: string }
  | { type: 'reload'; unitId: string }
  | { type: 'overwatch'; unitId: string }
  | { type: 'throw'; unitId: string; at: Point }
  | { type: 'charge'; unitId: string; at: Point }
  | { type: 'blast'; unitId: string }
  | { type: 'endTurn' };

export const MARINE_NAMES = ['Vasquez', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Reyes'];
const ALIEN_NAMES: Record<AlienKind, string> = {
  walker: 'Walker',
  flyer: 'Flyer',
  lizard: 'Lizard',
  snake: 'Snake',
};

/** Who fights: the campaign's squad names and the mission's alien groups. */
export interface BattleSetup {
  /** Marine names in squad order; missing ones are drawn at random. */
  names?: readonly string[];
  /** Alien groups for this mission (default: PODS). */
  pods?: { count: number; size: number };
  /** Marine ranks in squad order (index into RANKS); missing ones are rookies. */
  ranks?: readonly number[];
  /**
   * Alien kinds this battle may field (default: all). The last one listed is the
   * mission's new kind, and at least one alien is always of that kind (M5.8).
   */
  kinds?: readonly AlienKind[];
  /** The final mission's boss (M5.6) stands among the alien groups, in its own group. */
  boss?: boolean;
  /** The supply picked after the last mission (M5.10), for every marine. */
  supply?: SupplyId | null;
}

/** One of the supplies picked between missions (M5.10). */
export type SupplyId = keyof typeof SUPPLIES;
export const SUPPLY_IDS = Object.keys(SUPPLIES) as SupplyId[];

/** A new battle: marines deploy in the west spawn zone, aliens in the east. */
export function createBattle(map: BattleMap, seed: number, setup: BattleSetup = {}): BattleState {
  const rng = createRng(seed);
  const drawn = shuffled(rng, MARINE_NAMES);
  const names = drawn.map((n, i) => setup.names?.[i] ?? n);
  const supply = setup.supply ?? null;
  const extra = supply ? SUPPLIES[supply] : { hp: 0, grenades: 0 };
  const marines = deploy(map, rng, 'west', SKIRMISH.marines).map((p, i): Unit => {
    const rank = rankIndex(setup.ranks?.[i] ?? 0);
    const hp = UNITS.marine.hp + rankOf(rank).hp + extra.hp;
    return {
      ...p,
      id: `m${i + 1}`,
      side: 'marine',
      kind: 'marine',
      name: names[i] ?? `Marine ${i + 1}`,
      hp,
      maxHp: hp,
      facing: 1,
      ap: ACTION_POINTS,
      move: UNITS.marine.move,
      ammo: UNITS.marine.ammo + rankOf(rank).ammo,
      overwatch: false,
      grenades: GRENADE.perMarine + rankOf(rank).grenades + extra.grenades,
      exposed: false,
      pod: null,
      dormant: false,
      poison: 0,
      freeSteps: 0,
      rank,
      kills: 0,
      hits: 0,
      front: 0,
      charging: null,
      cooldown: 0,
    };
  });
  // The boss stands somewhere the squad can't see, placed by its own generator so a
  // battle without one deploys exactly as before; the pods keep off its tiles.
  const bossAt = setup.boss ? placeBoss(map, seed, marines) : null;
  // Kinds come from their own generator, so the draw doesn't move where anyone stands.
  const kindRng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const allowed = setup.kinds && setup.kinds.length > 0 ? setup.kinds : ALIEN_KINDS;
  const places = deployPods(
    map,
    rng,
    marines,
    setup.pods ?? PODS,
    bossAt ? footprintAt(bossAt, BOSS.size) : [],
  );
  const kinds = places.map(() => kindRng.pick(allowed));
  // The mission's new kind must show up, so the briefing's warning is never a lie.
  const newest = allowed[allowed.length - 1] as AlienKind;
  if (kinds.length > 0 && !kinds.includes(newest)) kinds[kindRng.int(0, kinds.length - 1)] = newest;
  const aliens = places.map(({ pod, ...p }, i): Unit => {
    const kind = kinds[i] as AlienKind;
    return {
      ...p,
      id: `a${i + 1}`,
      side: 'alien',
      kind,
      name: ALIEN_NAMES[kind],
      hp: UNITS[kind].hp,
      maxHp: UNITS[kind].hp,
      facing: -1,
      ap: ACTION_POINTS,
      move: UNITS[kind].move,
      ammo: UNITS[kind].ammo,
      overwatch: false,
      grenades: 0,
      exposed: false,
      pod,
      dormant: true,
      poison: 0,
      freeSteps: 0,
      rank: 0,
      kills: 0,
      hits: 0,
      front: 0,
      charging: null,
      cooldown: 0,
    };
  });
  if (bossAt) aliens.push(makeBoss(bossAt, `a${aliens.length + 1}`, (setup.pods ?? PODS).count));
  return {
    map,
    units: [...marines, ...aliens],
    turn: 'marine',
    round: 1,
    selected: null,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    lastShot: null,
    lastMove: null,
    supply,
    lastThrow: null,
    lastBlast: null,
    lastPoison: [],
  };
}

/** The Overseer (M5.6), dormant in a group of its own, its armoured front to the west. */
function makeBoss(at: Point, id: string, pod: number): Unit {
  const stats = UNITS.overseer;
  return {
    ...at,
    id,
    side: 'alien',
    kind: 'overseer',
    name: 'Overseer',
    hp: stats.hp,
    maxHp: stats.hp,
    facing: -1,
    ap: ACTION_POINTS,
    move: stats.move,
    ammo: stats.ammo,
    overwatch: false,
    grenades: 0,
    exposed: false,
    pod,
    dormant: true,
    poison: 0,
    freeSteps: 0,
    rank: 0,
    kills: 0,
    hits: 0,
    front: -1,
    charging: null,
    cooldown: 0,
  };
}

/**
 * Where the boss stands: the bottom-left tile of a free BOSS.size square in the east,
 * out of the squad's sight if the map allows it.
 */
function placeBoss(map: BattleMap, seed: number, marines: readonly Point[]): Point {
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const [eastStart, eastEdge] = spawnZone(map.cols, 'east');
  const westmost = Math.min(PODS.westmostColumn, eastStart);
  const seen = tilesSeenFrom(map, marines);
  const spots: { p: Point; r: number; hidden: boolean }[] = [];
  for (let y = BOSS.size - 1; y < map.rows; y++) {
    for (let x = westmost; x + BOSS.size - 1 <= eastEdge; x++) {
      const tiles = footprintAt({ x, y }, BOSS.size);
      if (!tiles.every((t) => isWalkable(map, t.x, t.y))) continue;
      const hidden = tiles.every((t) => !seen.has(t.y * map.cols + t.x));
      spots.push({ p: { x, y }, r: rng.next(), hidden });
    }
  }
  spots.sort((a, b) => Number(b.hidden) - Number(a.hidden) || a.r - b.r);
  const best = spots[0];
  if (!best) throw new Error('no room for the boss');
  return best.p;
}

/** The tiles of a square footprint whose bottom-left tile is `at` (it grows right and up). */
function footprintAt(at: Point, size: number): Point[] {
  const tiles: Point[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) tiles.push({ x: at.x + i, y: at.y - j });
  }
  return tiles;
}

/** How many tiles wide (and tall) a unit stands: the boss is BOSS.size, everyone else 1. */
export function unitSize(unit: Pick<Unit, 'kind'>): number {
  return unit.kind === 'overseer' ? BOSS.size : 1;
}

/** The tiles a unit stands on, its own tile first (M5.6: the boss stands on four). */
export function footprint(unit: Pick<Unit, 'kind' | 'x' | 'y'>): Point[] {
  return footprintAt(unit, unitSize(unit));
}

/**
 * The closest pair of tiles, one from each unit's footprint, with a clear line between
 * them; null if no tile of one can see a tile of the other. For one-tile units it is
 * just their own tiles.
 */
export function sightLine(
  map: BattleMap,
  from: Pick<Unit, 'kind' | 'x' | 'y'>,
  to: Pick<Unit, 'kind' | 'x' | 'y'>,
): { from: Point; to: Point; dist: number } | null {
  let best: { from: Point; to: Point; dist: number } | null = null;
  for (const a of footprint(from)) {
    for (const b of footprint(to)) {
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (best && dist >= best.dist) continue;
      if (canSee(map, a, b)) best = { from: a, to: b, dist };
    }
  }
  return best;
}

/** True if any living unit on `side` can see any tile the unit stands on. */
export function unitVisibleTo(state: BattleState, side: Side, unit: Unit): boolean {
  return footprint(unit).some((p) => isVisibleTo(state, side, p));
}

/**
 * The boss's front sits on the side of the nearest living marine (by column; a marine
 * in the boss's own columns leaves it as it was).
 */
function frontToward(state: BattleState, boss: Unit): -1 | 1 {
  const marines = livingUnits(state, 'marine');
  const old: -1 | 1 = boss.front === 0 ? boss.facing : boss.front;
  if (marines.length === 0) return old;
  const centre = { x: boss.x + (BOSS.size - 1) / 2, y: boss.y - (BOSS.size - 1) / 2 };
  const nearest = marines.reduce((a, b) =>
    Math.hypot(b.x - centre.x, b.y - centre.y) < Math.hypot(a.x - centre.x, a.y - centre.y) ? b : a,
  );
  if (nearest.x > boss.x + BOSS.size - 1) return 1;
  if (nearest.x < boss.x) return -1;
  return old;
}

/** True if a shot from `shooter` at the boss comes from in front of its armour. */
export function fromTheFront(boss: Unit, shooter: Point): boolean {
  if (boss.front === 1) return shooter.x > boss.x + unitSize(boss) - 1;
  if (boss.front === -1) return shooter.x < boss.x;
  return false;
}

/** Applies one action. Invalid actions return the same state object, unchanged. */
export function apply(state: BattleState, action: Action): BattleState {
  switch (action.type) {
    case 'select': {
      const unit = unitById(state, action.unitId);
      const ok = unit !== undefined && unit.side === 'marine' && unit.hp > 0;
      if (!ok || state.turn !== 'marine' || state.selected === action.unitId) return state;
      return { ...state, selected: action.unitId };
    }
    case 'deselect':
      return state.selected === null ? state : { ...state, selected: null };
    case 'move':
      return move(state, action.unitId, action.to);
    case 'overwatch': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canOverwatch(state, unit.id)) return state;
      return replaceUnit(state, { ...unit, overwatch: true, ap: 0, freeSteps: 0 });
    }
    case 'shoot':
      return shoot(state, action.unitId, action.targetId);
    case 'throw':
      return throwGrenade(state, action.unitId, action.at);
    case 'charge': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canCharge(state, unit.id) || !onMap(state.map, action.at)) return state;
      const at = { x: action.at.x, y: action.at.y };
      return replaceUnit(state, { ...unit, charging: at, ap: 0, freeSteps: 0 });
    }
    case 'blast':
      return fireBlast(state, action.unitId);
    case 'reload': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canReload(state, unit.id)) return state;
      return replaceUnit(state, { ...unit, ammo: clipSize(unit), ap: unit.ap - 1, freeSteps: 0 });
    }
    case 'endTurn': {
      // The other side's living units get their action points back.
      const turn: Side = state.turn === 'marine' ? 'alien' : 'marine';
      // Their overwatch ends: it only lasts through the other side's turn. The other
      // side's exposure ends too: it lasted until this side's turn came round again.
      const lastPoison: PoisonTick[] = [];
      const units = state.units.map((u) => {
        // The boss's rest counts down as each alien turn ends (M5.6).
        const cooldown =
          u.side !== turn && turn === 'marine' ? Math.max(0, u.cooldown - 1) : u.cooldown;
        if (u.side !== turn) return { ...u, exposed: false, freeSteps: 0, cooldown };
        if (u.hp <= 0) return u;
        // The boss turns its armoured front toward the nearest marine as its turn begins.
        const front: Unit['front'] = u.front === 0 ? 0 : frontToward(state, u);
        const facing = front === 0 ? u.facing : front;
        const fresh = { ...u, ap: ACTION_POINTS, overwatch: false, freeSteps: 0, front, facing };
        if (u.poison <= 0) return fresh;
        // Poison bites as the turn begins, but never takes the last point of health.
        const hp = Math.max(Math.min(u.hp, 1), u.hp - ABILITIES.poison.damage);
        lastPoison.push({ unitId: u.id, damage: u.hp - hp, hpAfter: hp });
        return { ...fresh, hp, poison: u.poison - 1 };
      });
      const round = turn === 'marine' ? state.round + 1 : state.round;
      return { ...state, units, turn, round, selected: null, lastPoison };
    }
  }
}

/**
 * The best cover `defender` has against a shot from `from`. A prop on a side of
 * the defender's tile counts when the shooter is on that side of it: a rock to
 * the east protects against shots from anywhere east, not from the west.
 */
export function coverAgainst(map: BattleMap, defender: Point, from: Point): Cover | null {
  let best: Cover | null = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const facing = (from.x - defender.x) * dx + (from.y - defender.y) * dy > 0;
    const prop = tileAt(map, defender.x + dx, defender.y + dy)?.prop;
    if (!facing || prop == null) continue;
    const cover = PROPS[prop].cover;
    if (cover === 'full') return 'full';
    best = cover;
  }
  return best;
}

/** True if a unit at `a` can see `b`: no tree or boulder in the way. */
export function canSee(map: BattleMap, a: Point, b: Point): boolean {
  return hasLineOfSight(a, b, (x, y) => blocksSight(map, x, y));
}

/**
 * The tiles a side can see now, keyed by `y * cols + x`: every tile within sight
 * radius of one of its living units with nothing blocking the line.
 */
export function visibleTiles(state: BattleState, side: Side): Set<number> {
  return tilesSeenFrom(state.map, livingUnits(state, side));
}

/** The tiles seen from these spots (for working out sight part-way through a move). */
export function tilesSeenFrom(map: BattleMap, eyes: readonly Point[]): Set<number> {
  const seen = new Set<number>();
  const r = SIGHT.radius;
  for (const eye of eyes) {
    for (let y = Math.max(0, eye.y - r); y <= Math.min(map.rows - 1, eye.y + r); y++) {
      for (let x = Math.max(0, eye.x - r); x <= Math.min(map.cols - 1, eye.x + r); x++) {
        const key = y * map.cols + x;
        if (seen.has(key) || Math.hypot(x - eye.x, y - eye.y) > r) continue;
        if (canSee(map, eye, { x, y })) seen.add(key);
      }
    }
  }
  return seen;
}

/** True if any living unit on `side` can see the point. */
export function isVisibleTo(state: BattleState, side: Side, p: Point): boolean {
  const r = SIGHT.radius;
  return livingUnits(state, side).some(
    (u) => Math.hypot(u.x - p.x, u.y - p.y) <= r && canSee(state.map, u, p),
  );
}

/** Why a shot isn't possible right now, or null if it is. */
export type ShotBlock = 'range' | 'sight' | 'ammo' | 'other';

export function shotBlock(
  state: BattleState,
  shooterId: string,
  targetId: string,
): ShotBlock | null {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  if (!shooter || !target || shooter.hp <= 0 || target.hp <= 0) return 'other';
  if (shooter.side === target.side || shooter.ap <= 0) return 'other';
  if (shooter.ammo === 0) return 'ammo';
  // Measured between the nearest tiles that can see each other (the boss stands on four).
  const line = sightLine(state.map, shooter, target);
  const nearest = Math.min(
    ...footprint(target).flatMap((b) =>
      footprint(shooter).map((a) => Math.hypot(b.x - a.x, b.y - a.y)),
    ),
  );
  if (nearest > UNITS[shooter.kind].range) return 'range';
  if (!line) return 'sight';
  if (line.dist > UNITS[shooter.kind].range) return 'range';
  // The squad must have spotted the target: any of the shooter's side within sight counts.
  if (!unitVisibleTo(state, shooter.side, target)) return 'sight';
  return null;
}

/**
 * Chance in percent that `shooterId` hits `targetId` with a shot now, or null if
 * the shot isn't allowed (see shotBlock). Aim, minus distance beyond close range,
 * minus the target's cover facing the shooter.
 */
export function hitChance(state: BattleState, shooterId: string, targetId: string): number | null {
  return shotOdds(state, shooterId, targetId)?.hit ?? null;
}

/** Everything that goes into a shot's odds, for the breakdown panel. */
export interface ShotOdds {
  /** The shooter's aim, with its rank's bonus and a marine's supply of scopes (M5.10). */
  aim: number;
  /** Lost to distance beyond close range (zero or negative). */
  range: number;
  /** The target's cover facing the shooter, and what it costs. */
  cover: Cover | null;
  coverPenalty: number;
  /** No cover facing the shooter: the shot gets the flanking crit bonus. */
  flanked: boolean;
  /** Taken off for an overwatch reaction shot (zero for aimed shots). */
  reactionPenalty: number;
  /** The target was caught by a grenade: its cover doesn't count. */
  exposed: boolean;
  /**
   * The target is the boss and the shooter is in front of it: a hit does at most
   * BOSS.armourCap damage (M5.6). False for every other target.
   */
  armoured: boolean;
  /** Final chances in percent. */
  hit: number;
  crit: number;
}

/** The odds of a shot now, or null if it isn't allowed (see shotBlock). */
export function shotOdds(state: BattleState, shooterId: string, targetId: string): ShotOdds | null {
  if (shotBlock(state, shooterId, targetId) !== null) return null;
  return oddsBetween(
    state,
    unitById(state, shooterId) as Unit,
    unitById(state, targetId) as Unit,
    false,
  );
}

/**
 * The odds of an overwatch reaction shot by `shooterId` at `targetId` where it stands
 * now, or null if the shooter isn't on overwatch or can't make the shot.
 */
export function reactionOdds(
  state: BattleState,
  shooterId: string,
  targetId: string,
): ShotOdds | null {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  if (!shooter?.overwatch || !target || shooter.hp <= 0 || target.hp <= 0) return null;
  if (shooter.side === target.side || shooter.ammo === 0) return null;
  const line = sightLine(state.map, shooter, target);
  if (!line || line.dist > UNITS[shooter.kind].range) return null;
  if (!unitVisibleTo(state, shooter.side, target)) return null;
  return oddsBetween(state, shooter, target, true);
}

/**
 * The odds of a shot from `shooter` at `target` as they stand, without checking that
 * the shot is allowed. The AI uses it to weigh shots from tiles it could move to.
 */
export function oddsBetween(
  state: BattleState,
  shooter: Unit,
  target: Unit,
  reaction: boolean,
): ShotOdds {
  const stats = UNITS[shooter.kind];
  const scopes = shooter.side === 'marine' && state.supply ? SUPPLIES[state.supply].aim : 0;
  const aim = stats.aim + rankOf(shooter.rank).aim + scopes;
  // From the shooter's tile nearest the target that can see it, to that target tile.
  const line = sightLine(state.map, shooter, target) ?? { from: shooter, to: target };
  const dist = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
  const range = -Math.max(0, Math.floor(dist) - SHOOTING.closeRange) * SHOOTING.penaltyPerTile;
  const ability = stats.ability;
  // The boss hides behind nothing: it has armour in front instead (M5.6).
  const boss = target.kind === 'overseer';
  const armoured = boss && fromTheFront(target, line.from);
  // A unit caught by a grenade has no cover to hide behind; claws reach round cover;
  // shots from above make cover count one step less.
  const melee = ability === 'melee';
  const facingCover =
    target.exposed || melee || boss ? null : coverAgainst(state.map, line.to, line.from);
  const cover = ability === 'fromAbove' ? lowerCover(facingCover) : facingCover;
  const coverPenalty = cover ? SHOOTING.cover[cover] : 0;
  // Flanking is about getting round cover with a gun; a claw gets no crit bonus for it.
  // The boss is flanked from behind or beside, never from its armoured front.
  const flanked = cover === null && !melee && !armoured;
  const reactionPenalty = reaction ? OVERWATCH.aimPenalty : 0;
  const hit = Math.min(
    SHOOTING.maxChance,
    Math.max(SHOOTING.minChance, aim + range - coverPenalty - reactionPenalty),
  );
  const critBase = stats.crit + (flanked ? SHOOTING.flankCrit : 0);
  const crit = reaction && !OVERWATCH.canCrit ? 0 : Math.min(100, critBase);
  const exposed = target.exposed;
  return {
    aim,
    range,
    cover,
    coverPenalty,
    flanked,
    reactionPenalty,
    exposed,
    armoured,
    hit,
    crit,
  };
}

function lowerCover(cover: Cover | null): Cover | null {
  return cover === 'full' ? 'half' : null;
}

/** True if the unit can throw a grenade now: its turn, an action point, and a grenade. */
export function canThrow(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  return unit.grenades > 0;
}

/** True if `at` is on the map and within throwing range of the unit. */
export function inThrowRange(state: BattleState, unitId: string, at: Point): boolean {
  const unit = unitById(state, unitId);
  const { cols, rows } = state.map;
  if (!unit || at.x < 0 || at.y < 0 || at.x >= cols || at.y >= rows) return false;
  return Math.hypot(at.x - unit.x, at.y - unit.y) <= GRENADE.range;
}

/** The living units a grenade landing on `at` would hit. */
export function blastTargets(state: BattleState, at: Point): Unit[] {
  return state.units.filter(
    (u) =>
      u.hp > 0 && footprint(u).some((p) => Math.hypot(p.x - at.x, p.y - at.y) <= GRENADE.radius),
  );
}

/**
 * Throws a grenade: fixed damage to everyone in the blast, survivors lose cover, and
 * the cover itself is wrecked (M5.13): small cover blown away, trees blown down.
 */
function throwGrenade(state: BattleState, unitId: string, at: Point): BattleState {
  const thrower = unitById(state, unitId);
  if (!thrower || !canThrow(state, unitId) || !inThrowRange(state, unitId, at)) return state;
  const hits: ThrowResult['hits'] = [];
  let next = state;
  for (const target of blastTargets(state, at)) {
    const hp = Math.max(0, target.hp - GRENADE.damage);
    hits.push({ unitId: target.id, damage: GRENADE.damage, hpAfter: hp, killed: hp === 0 });
    next = replaceUnit(next, { ...target, hp, exposed: hp > 0 });
  }
  const facing = at.x === thrower.x ? thrower.facing : at.x > thrower.x ? 1 : -1;
  // Throwing uses all remaining action points, like a shot. Only enemies count as kills.
  const after = unitById(next, unitId) as Unit;
  const enemyHits = hits.filter((h) => unitById(state, h.unitId)?.side !== thrower.side);
  const kills = enemyHits.filter((h) => h.killed).length;
  next = replaceUnit(next, {
    ...after,
    grenades: after.grenades - 1,
    ap: 0,
    facing,
    freeSteps: 0,
    kills: after.kills + kills,
    hits: after.hits + enemyHits.length,
  });
  // The cover goes before anyone scrambles, so a woken pod can't hide behind it.
  const blasted = blastProps(next.map, at, GRENADE.radius);
  next = { ...next, map: blasted.map };
  // A blast in the fog wakes the pod it lands on, and any pod the squad can now see
  // through the cover it blew away.
  const pods = [
    ...new Set([
      ...blastTargets(state, at)
        .filter((u) => u.dormant && u.pod !== null)
        .map((u) => u.pod as number),
      ...spottedPods(next),
    ]),
  ];
  const woken = pods.length > 0 ? wakePods(next, pods) : { state: next, scampers: [] };
  next = woken.state;
  return {
    ...next,
    lastThrow: {
      unitId,
      at: { x: at.x, y: at.y },
      hits,
      scampers: woken.scampers,
      wrecks: blasted.wrecks,
    },
  };
}

/**
 * True if the boss can start charging its blast now (M5.6): its turn, an action point,
 * hurt enough, not already charging, and rested since its last blast.
 */
export function canCharge(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  if (UNITS[unit.kind].ability !== 'blast' || unit.charging || unit.cooldown > 0) return false;
  return unit.hp <= unit.maxHp * BOSS.chargeBelow;
}

/** The living units the boss's blast centred on `at` would hit: any tile of theirs in range. */
export function blastArea(state: BattleState, at: Point): Unit[] {
  return state.units.filter(
    (u) =>
      u.hp > 0 && footprint(u).some((p) => Math.hypot(p.x - at.x, p.y - at.y) <= BOSS.blast.radius),
  );
}

/**
 * The charged blast goes off (M5.6): fixed damage to everyone in the marked area, and
 * survivors lose their cover for a turn, as with a grenade. The boss then rests.
 */
function fireBlast(state: BattleState, unitId: string): BattleState {
  const boss = unitById(state, unitId);
  if (!boss || boss.hp <= 0 || boss.ap <= 0 || boss.side !== state.turn || !boss.charging) {
    return state;
  }
  const at = boss.charging;
  const hits: BlastResult['hits'] = [];
  let next = state;
  for (const target of blastArea(state, at)) {
    if (target.id === boss.id) continue;
    const hp = Math.max(0, target.hp - BOSS.blast.damage);
    hits.push({ unitId: target.id, damage: BOSS.blast.damage, hpAfter: hp, killed: hp === 0 });
    next = replaceUnit(next, { ...target, hp, exposed: hp > 0, overwatch: false });
  }
  const after = unitById(next, unitId) as Unit;
  const enemyHits = hits.filter((h) => unitById(state, h.unitId)?.side !== boss.side);
  next = replaceUnit(next, {
    ...after,
    charging: null,
    cooldown: BOSS.blast.cooldown,
    ap: 0,
    freeSteps: 0,
    kills: after.kills + enemyHits.filter((h) => h.killed).length,
    hits: after.hits + enemyHits.length,
  });
  return { ...next, lastBlast: { unitId, at: { x: at.x, y: at.y }, hits } };
}

/**
 * How the battle stands: won when every alien is down, or the boss is (M5.6: its
 * escorts don't matter then); lost when every marine is down; otherwise null.
 */
export function battleOutcome(state: BattleState): 'won' | 'lost' | null {
  if (livingUnits(state, 'marine').length === 0) return 'lost';
  const boss = state.units.find((u) => u.kind === 'overseer');
  if (livingUnits(state, 'alien').length === 0 || (boss && boss.hp <= 0)) return 'won';
  return null;
}

function onMap(map: BattleMap, p: Point): boolean {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < map.cols &&
    p.y < map.rows
  );
}

/** True if the unit can go on overwatch now: its turn, an action point, and ammo. */
export function canOverwatch(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  // Watching means shooting at movement: claws can't.
  return unit.ammo !== 0 && !unit.overwatch && UNITS[unit.kind].ability !== 'melee';
}

function shoot(state: BattleState, shooterId: string, targetId: string): BattleState {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  const odds = shotOdds(state, shooterId, targetId);
  if (!shooter || !target || odds === null || shooter.side !== state.turn) return state;
  const fired = rollShot(state, shooter, target, odds, false);
  // An aimed shot uses all remaining action points, as in XCOM.
  const next = replaceUnit(fired.state, {
    ...(unitById(fired.state, shooterId) as Unit),
    ap: 0,
    freeSteps: 0,
  });
  return { ...next, lastShot: fired.shot };
}

/**
 * Rolls a shot: hit, then damage, then crit, from the battle's random state. Spends a
 * round of ammo, turns the shooter toward the target and applies the damage.
 */
function rollShot(
  state: BattleState,
  shooter: Unit,
  target: Unit,
  odds: ShotOdds,
  reaction: boolean,
): { state: BattleState; shot: ShotResult } {
  const roll = rngStep(state.rng);
  const hit = roll.value * 100 < odds.hit;
  let rng = roll.state;
  let damage = 0;
  let crit = false;
  if (hit) {
    const { min, max } = UNITS[shooter.kind].damage;
    const dmgRoll = rngStep(rng);
    const critRoll = rngStep(dmgRoll.state);
    rng = critRoll.state;
    crit = critRoll.value * 100 < odds.crit;
    damage = min + Math.floor(dmgRoll.value * (max - min + 1)) + (crit ? SHOOTING.critDamage : 0);
    // The boss's front plate stops most of a shot from ahead (M5.6).
    if (odds.armoured) damage = Math.min(damage, BOSS.armourCap);
  }
  const hp = Math.max(0, target.hp - damage);
  const facing = target.x === shooter.x ? shooter.facing : target.x > shooter.x ? 1 : -1;
  const ammo = shooter.ammo === null ? null : shooter.ammo - 1;
  const kills = shooter.kills + (hp === 0 && target.hp > 0 ? 1 : 0);
  const hits = shooter.hits + (hit && target.side !== shooter.side ? 1 : 0);
  let next = replaceUnit(state, { ...shooter, facing, ammo, kills, hits });
  next = replaceUnit(next, { ...target, hp });
  // Abilities ride on aimed hits that leave the target standing, not on reactions.
  let pulledTo: Point | null = null;
  let poisoned = false;
  const ability = UNITS[shooter.kind].ability;
  if (hit && hp > 0 && !reaction) {
    if (ability === 'pull') pulledTo = pullSpot(next, shooter, target);
    if (pulledTo) {
      // Dragged out of position: off overwatch, and wherever the tongue drops it.
      next = replaceUnit(next, { ...target, hp, ...pulledTo, overwatch: false });
    }
    if (ability === 'poison') {
      poisoned = true;
      next = replaceUnit(next, {
        ...(unitById(next, target.id) as Unit),
        poison: ABILITIES.poison.turns,
      });
    }
  }
  const shot: ShotResult = {
    shooterId: shooter.id,
    targetId: target.id,
    chance: odds.hit,
    hit,
    crit,
    damage,
    hpAfter: hp,
    killed: hp === 0,
    reaction,
    pulledTo,
    poisoned,
  };
  return { state: { ...next, rng }, shot };
}

/**
 * Where a lizard's tongue drops a marine: the free tile next to the lizard nearest the
 * marine, or null if the marine is already next to it or there's no room.
 */
function pullSpot(state: BattleState, lizard: Unit, target: Unit): Point | null {
  if (Math.hypot(target.x - lizard.x, target.y - lizard.y) <= 1.5) return null;
  let best: Point | null = null;
  let bestDist = Infinity;
  for (const [dx, dy] of NEIGHBOURS) {
    const p = { x: lizard.x + dx, y: lizard.y + dy };
    if (!isWalkable(state.map, p.x, p.y) || unitAt(state, p.x, p.y)) continue;
    const d = Math.hypot(target.x - p.x, target.y - p.y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** The 8 tiles around a tile. */
const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * Moves a unit along its path. At each tile, every enemy on overwatch that can now
 * see it takes one reaction shot (in unit order). A kill stops the move there.
 */
function move(state: BattleState, unitId: string, to: Point): BattleState {
  const unit = unitById(state, unitId);
  if (!unit || unit.side !== state.turn) return state;
  const path = pathFor(state, unit.id, to);
  if (!path) return state;

  let next = state;
  let facing = unit.facing;
  let prev: Point = unit;
  const walked: Point[] = [];
  const reactions: MoveResult['reactions'] = [];
  let spotted: string[] = [];
  let scampers: Scamper[] = [];
  for (const [step, p] of path.entries()) {
    // The path was planned around units the mover's side can see. A hidden one in the
    // way stops the move just before it.
    if (bumpsInto(next, unit, p)) break;
    // Face the way the last sideways step went; straight up or down keeps the old facing.
    if (p.x !== prev.x) facing = p.x > prev.x ? 1 : -1;
    prev = p;
    walked.push(p);
    next = replaceUnit(next, { ...(unitById(next, unitId) as Unit), x: p.x, y: p.y, facing });
    for (const watcher of next.units) {
      const odds = reactionOdds(next, watcher.id, unitId);
      if (!odds) continue;
      const fired = rollShot(next, watcher, unitById(next, unitId) as Unit, odds, true);
      next = replaceUnit(fired.state, {
        ...(unitById(fired.state, watcher.id) as Unit),
        overwatch: false,
      });
      reactions.push({ step, shot: fired.shot });
      if (fired.shot.killed) break;
    }
    if ((unitById(next, unitId) as Unit).hp <= 0) break;
    // A marine who spots a hidden pod stops here, and the pod scrambles to cover.
    if (unit.side === 'marine') {
      const pods = spottedPods(next);
      if (pods.length > 0) {
        spotted = next.units.filter((u) => u.pod !== null && pods.includes(u.pod)).map((u) => u.id);
        const woken = wakePods(next, pods);
        next = woken.state;
        scampers = woken.scampers;
        break;
      }
    }
  }
  // The move costs what was actually walked: a dash cut short by a sighting may cost one,
  // and a walk within the free squares left from an earlier stop costs nothing.
  const after = unitById(next, unitId) as Unit;
  const cost = walked.length === 0 ? 0 : moveCost(unit, walked.length);
  // Stopped short (not by choice): the squares paid for but not walked are kept as a
  // free move. A stop where nothing was walked keeps what the unit had.
  const paidFor = cost === 0 ? unit.freeSteps : cost * unit.move;
  const stoppedShort = walked.length < path.length && after.hp > 0;
  const freeSteps =
    walked.length === 0 ? unit.freeSteps : stoppedShort ? Math.max(0, paidFor - walked.length) : 0;
  next = replaceUnit(next, { ...after, ap: unit.ap - cost, freeSteps });
  return { ...next, lastMove: { unitId, path: walked, reactions, spotted, scampers } };
}

/** Pods with a dormant, living member the squad can now see. */
function spottedPods(state: BattleState): number[] {
  const pods = new Set<number>();
  for (const u of state.units) {
    if (u.dormant && u.hp > 0 && u.pod !== null && unitVisibleTo(state, 'marine', u))
      pods.add(u.pod);
  }
  return [...pods];
}

/**
 * Wakes pods: every member is no longer dormant, and each living one makes a free
 * move (no action points, no overwatch reactions) to the best cover nearby, facing
 * the nearest marine. The aliens' "scamper" in XCOM.
 */
function wakePods(
  state: BattleState,
  spotted: number[],
): { state: BattleState; scampers: Scamper[] } {
  // The boss's escorts wake with it (M5.6).
  const bossSpotted = state.units.some(
    (u) => u.kind === 'overseer' && u.pod !== null && spotted.includes(u.pod),
  );
  const pods = bossSpotted
    ? [...new Set(state.units.flatMap((u) => (u.pod === null ? [] : [u.pod])))]
    : spotted;
  let next: BattleState = {
    ...state,
    units: state.units.map((u) =>
      u.pod !== null && pods.includes(u.pod) ? { ...u, dormant: false } : u,
    ),
  };
  const scampers: Scamper[] = [];
  for (const alien of next.units) {
    if (alien.pod === null || !pods.includes(alien.pod) || alien.hp <= 0) continue;
    const me = unitById(next, alien.id) as Unit;
    const marines = livingUnits(next, 'marine');
    if (marines.length === 0) break;
    // The boss doesn't run for cover: it turns its armour toward the squad (M5.6).
    if (me.kind === 'overseer') {
      const front = frontToward(next, me);
      next = replaceUnit(next, { ...me, front, facing: front });
      continue;
    }
    const nearestTo = (p: Point): Unit =>
      marines.reduce((a, b) =>
        Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a,
      );
    const COVER = { full: 20, half: 10 } as const;
    const score = (p: Point, steps: number): number => {
      const cover = coverAgainst(next.map, p, nearestTo(p));
      return (cover ? COVER[cover] : 0) - steps * 0.1;
    };
    const cols = next.map.cols;
    let best: Point = me;
    let bestScore = score(me, 0);
    const range = reachable(next.map.cols, next.map.rows, passableFor(next, me), me, me.move);
    for (const [key, steps] of range) {
      const p = { x: key % cols, y: Math.floor(key / cols) };
      const sc = score(p, steps);
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    const target = nearestTo(best);
    const facing: 1 | -1 = target.x === best.x ? me.facing : target.x > best.x ? 1 : -1;
    if (best.x === me.x && best.y === me.y) {
      next = replaceUnit(next, { ...me, facing });
      continue;
    }
    const path = findPath(next.map.cols, next.map.rows, passableFor(next, me), me, best);
    if (!path) continue;
    next = replaceUnit(next, { ...me, x: best.x, y: best.y, facing });
    scampers.push({ unitId: me.id, path });
  }
  return { state: next, scampers };
}

/** Tiles a unit could move to with one move action, keyed by `y * cols + x`, with step counts. */
export function moveRange(state: BattleState, unitId: string): Map<number, number> {
  const unit = unitById(state, unitId);
  if (!unit || maxSteps(unit) <= 0) return new Map();
  const steps = maxSteps(unit);
  const range = reachable(state.map.cols, state.map.rows, passableFor(state, unit), unit, steps);
  range.delete(unit.y * state.map.cols + unit.x);
  return range;
}

/**
 * Action points a move of `steps` tiles costs: none within the free squares left
 * from a move cut short, 1 within the unit's move range, 2 for a dash (up to twice as
 * far), which needs both points.
 */
export function moveCost(unit: Unit, steps: number): number {
  if (steps <= unit.freeSteps) return 0;
  return steps <= unit.move ? 1 : 2;
}

/** The farthest a unit can move now: its free squares, or a dash if it has both points. */
function maxSteps(unit: Unit): number {
  if (unit.hp <= 0) return 0;
  const paid = unit.ap >= ACTION_POINTS ? unit.move * 2 : unit.ap > 0 ? unit.move : 0;
  return Math.max(unit.freeSteps, paid);
}

/** True if the unit can still do something this turn: action points or free squares. */
export function hasActions(unit: Unit): boolean {
  return unit.hp > 0 && (unit.ap > 0 || unit.freeSteps > 0);
}

/** The path a unit would run to reach `to` with one move, or null if it can't. */
export function pathFor(state: BattleState, unitId: string, to: Point): Point[] | null {
  const unit = unitById(state, unitId);
  if (!unit || maxSteps(unit) <= 0) return null;
  const { cols, rows } = state.map;
  return findPath(cols, rows, passableFor(state, unit), unit, to, maxSteps(unit));
}

/**
 * Where `mover` may stand, as it plans a move: props block, and so do living units
 * (every tile of theirs), except that marines plan around only the aliens they can see
 * (a hidden one stops the move when reached). Aliens still know where every marine is.
 * For the boss, a spot is its bottom-left tile and its whole square must be free.
 */
function passableFor(state: BattleState, mover: Unit): (x: number, y: number) => boolean {
  const cols = state.map.cols;
  const side = mover.side;
  const blocked = new Set(
    state.units
      .filter(
        (u) =>
          u.hp > 0 &&
          u.id !== mover.id &&
          (side === 'alien' || u.side === side || unitVisibleTo(state, side, u)),
      )
      .flatMap((u) => footprint(u).map((p) => p.y * cols + p.x)),
  );
  const free = (x: number, y: number): boolean =>
    isWalkable(state.map, x, y) && !blocked.has(y * cols + x);
  const size = unitSize(mover);
  if (size === 1) return free;
  return (x, y) => footprintAt({ x, y }, size).every((p) => free(p.x, p.y));
}

/** True if another living unit stands on any tile `mover` would cover at `p`. */
function bumpsInto(state: BattleState, mover: Unit, p: Point): boolean {
  return footprintAt(p, unitSize(mover)).some((t) => {
    const other = unitAt(state, t.x, t.y);
    return other !== undefined && other.id !== mover.id;
  });
}

function replaceUnit(state: BattleState, unit: Unit): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unit.id ? unit : u)) };
}

/** A full clip for this unit's weapon (null: it never needs reloading); ranks add to it. */
export function clipSize(unit: Unit): number | null {
  const base = UNITS[unit.kind].ammo;
  return base === null ? null : base + (unit.side === 'marine' ? rankOf(unit.rank).ammo : 0);
}

/** True if the unit can reload now: its turn, an action point, and a clip that isn't full. */
export function canReload(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  const clip = clipSize(unit);
  return clip !== null && unit.ammo !== null && unit.ammo < clip;
}

/**
 * The next marine after `currentId` (in squad order, wrapping round) that still has
 * action points, or null if none does. `step` -1 goes backwards.
 */
export function nextReadyMarine(
  state: BattleState,
  currentId: string | null,
  step: 1 | -1 = 1,
): string | null {
  const squad = state.units.filter((u) => u.side === 'marine');
  const n = squad.length;
  const start = squad.findIndex((u) => u.id === currentId);
  for (let i = 1; i <= n; i++) {
    // With no current marine, start just before the first (or after the last, going back).
    const from = start === -1 ? (step === 1 ? -1 : n) : start;
    const u = squad[(((from + i * step) % n) + n) % n] as Unit;
    if (hasActions(u)) return u.id;
  }
  return null;
}

/** Enemies the unit could shoot now, best hit chance first (ties in unit order). */
export function shootableTargets(state: BattleState, shooterId: string): string[] {
  return state.units
    .map((u) => ({ id: u.id, chance: hitChance(state, shooterId, u.id) }))
    .filter((t): t is { id: string; chance: number } => t.chance !== null)
    .sort((a, b) => b.chance - a.chance)
    .map((t) => t.id);
}

/** Living units on one side. */
export function livingUnits(state: BattleState, side: Side): Unit[] {
  return state.units.filter((u) => u.side === side && u.hp > 0);
}

/** True if any living unit on the side can still act (action points or free squares). */
export function canAct(state: BattleState, side: Side): boolean {
  return livingUnits(state, side).some(hasActions);
}

export function unitById(state: BattleState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function unitAt(state: BattleState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => u.hp > 0 && footprint(u).some((p) => p.x === x && p.y === y));
}

/** True if the tile next to p, in direction dx, holds a prop (every prop gives cover). */
function coverToward(map: BattleMap, p: Point, dx: number): boolean {
  return tileAt(map, p.x + dx, p.y)?.prop != null;
}

/**
 * Picks spawn tiles in one zone. Tiles with cover facing the enemy come first,
 * and units keep SKIRMISH.minSpacing steps apart where the zone allows it.
 */
function deploy(map: BattleMap, rng: Rng, zone: 'west' | 'east', count: number): Point[] {
  const [minX, maxX] = spawnZone(map.cols, zone);
  const towardEnemy = zone === 'west' ? 1 : -1;
  const candidates: { p: Point; cover: boolean; order: number }[] = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isWalkable(map, x, y)) continue;
      const p = { x, y };
      candidates.push({ p, cover: coverToward(map, p, towardEnemy), order: rng.next() });
    }
  }
  candidates.sort((a, b) => Number(b.cover) - Number(a.cover) || a.order - b.order);
  const chosen: Point[] = [];
  for (const spacing of [SKIRMISH.minSpacing, 1]) {
    for (const c of candidates) {
      if (chosen.length === count) break;
      const tooClose = chosen.some((q) => Math.abs(q.x - c.p.x) + Math.abs(q.y - c.p.y) < spacing);
      if (!tooClose) chosen.push(c.p);
    }
  }
  if (chosen.length < count) throw new Error(`only ${chosen.length} spawn tiles in the ${zone}`);
  return chosen;
}

/**
 * Places the alien pods somewhere in the east of the map, out of the squad's sight:
 * leaders at least PODS.minApart steps apart, members within PODS.spread of their
 * leader. Falls back to closer spacing (or into sight) only if the map is crowded.
 */
function deployPods(
  map: BattleMap,
  rng: Rng,
  marines: readonly Point[],
  pods: { count: number; size: number },
  reserved: readonly Point[] = [],
): (Point & { pod: number })[] {
  const [eastStart, eastEdge] = spawnZone(map.cols, 'east');
  // On small maps (tests) the east spawn zone may start west of westmostColumn.
  const westmost = Math.min(PODS.westmostColumn, eastStart);
  const seen = tilesSeenFrom(map, marines);
  const free: Point[] = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = westmost; x <= eastEdge; x++) if (isWalkable(map, x, y)) free.push({ x, y });
  }
  const order = free.map((p) => ({ p, r: rng.next() })).sort((a, b) => a.r - b.r);
  const dist = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const placed: (Point & { pod: number })[] = [];
  const taken = (p: Point): boolean =>
    placed.some((q) => q.x === p.x && q.y === p.y) ||
    reserved.some((q) => q.x === p.x && q.y === p.y);
  // Out of sight first, even if a pod must spread out to stay hidden (as a last resort,
  // anywhere hidden); into sight only if the east has too few hidden tiles for everyone.
  for (const [hideOnly, spread] of [
    [true, PODS.spread],
    [true, PODS.hiddenSpread],
    [true, map.cols + map.rows],
    [false, PODS.spread],
  ] as const) {
    for (const apart of [PODS.minApart, 1]) {
      for (let pod = placed.length / pods.size; pod < pods.count; pod++) {
        const leader = order.find(
          ({ p }) =>
            !taken(p) &&
            (!hideOnly || !seen.has(p.y * map.cols + p.x)) &&
            placed.every((q) => q.pod === pod || dist(p, q) >= apart),
        );
        if (!leader) break;
        const members = [leader.p];
        for (const { p } of order) {
          if (members.length === pods.size) break;
          if (taken(p) || members.some((m) => m.x === p.x && m.y === p.y)) continue;
          if (dist(p, leader.p) > spread) continue;
          if (hideOnly && seen.has(p.y * map.cols + p.x)) continue;
          members.push(p);
        }
        if (members.length < pods.size) break;
        placed.push(...members.map((m) => ({ ...m, pod })));
      }
      if (placed.length === pods.count * pods.size) return placed;
    }
  }
  throw new Error(`only ${placed.length} alien spawn tiles`);
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A rank index kept within RANKS. */
export function rankIndex(rank: number): number {
  return Math.max(0, Math.min(RANKS.length - 1, Math.floor(rank)));
}

/** The rank's name and bonuses. */
export function rankOf(rank: number): (typeof RANKS)[number] {
  return RANKS[rankIndex(rank)] as (typeof RANKS)[number];
}
