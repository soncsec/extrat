import { ACTION_POINTS, SHOOTING, SKIRMISH, UNITS } from '../config/tuning';
import { findPath, hasLineOfSight, reachable, type Point } from './grid';
import {
  blocksSight,
  isWalkable,
  PROPS,
  spawnZone,
  tileAt,
  type BattleMap,
  type Cover,
} from './map';
import { createRng, rngStep, type Rng } from './rng';

/**
 * Battle state and the actions that change it (ADR-E2).
 * Scenes never edit this directly: they call apply() and draw the result.
 */

export type Side = 'marine' | 'alien';
export type UnitKind = 'marine' | 'walker';

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
  killed: boolean;
}

export type Action =
  | { type: 'select'; unitId: string }
  | { type: 'deselect' }
  | { type: 'move'; unitId: string; to: Point }
  | { type: 'shoot'; unitId: string; targetId: string }
  | { type: 'reload'; unitId: string }
  | { type: 'endTurn' };

const MARINE_NAMES = ['Vasquez', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Reyes'];

/** A new skirmish: marines deploy in the west spawn zone, aliens in the east. */
export function createBattle(map: BattleMap, seed: number): BattleState {
  const rng = createRng(seed);
  const names = shuffled(rng, MARINE_NAMES);
  const marines = deploy(map, rng, 'west', SKIRMISH.marines).map((p, i): Unit => ({
    ...p,
    id: `m${i + 1}`,
    side: 'marine',
    kind: 'marine',
    name: names[i] ?? `Marine ${i + 1}`,
    hp: UNITS.marine.hp,
    maxHp: UNITS.marine.hp,
    facing: 1,
    ap: ACTION_POINTS,
    move: UNITS.marine.move,
    ammo: UNITS.marine.ammo,
  }));
  const aliens = deploy(map, rng, 'east', SKIRMISH.aliens).map((p, i): Unit => ({
    ...p,
    id: `a${i + 1}`,
    side: 'alien',
    kind: 'walker',
    name: 'Walker',
    hp: UNITS.walker.hp,
    maxHp: UNITS.walker.hp,
    facing: -1,
    ap: ACTION_POINTS,
    move: UNITS.walker.move,
    ammo: UNITS.walker.ammo,
  }));
  return {
    map,
    units: [...marines, ...aliens],
    turn: 'marine',
    round: 1,
    selected: null,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    lastShot: null,
  };
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
    case 'move': {
      const unit = unitById(state, action.unitId);
      if (!unit || unit.side !== state.turn) return state;
      const path = pathFor(state, unit.id, action.to);
      if (!path) return state;
      // Face the way the last sideways step went; straight up or down keeps the old facing.
      let facing = unit.facing;
      let prev: Point = unit;
      for (const p of path) {
        if (p.x !== prev.x) facing = p.x > prev.x ? 1 : -1;
        prev = p;
      }
      const { x, y } = action.to;
      const ap = unit.ap - moveCost(unit, path.length);
      return replaceUnit(state, { ...unit, x, y, facing, ap });
    }
    case 'shoot':
      return shoot(state, action.unitId, action.targetId);
    case 'reload': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canReload(state, unit.id)) return state;
      return replaceUnit(state, { ...unit, ammo: clipSize(unit), ap: unit.ap - 1 });
    }
    case 'endTurn': {
      // The other side's living units get their action points back.
      const turn: Side = state.turn === 'marine' ? 'alien' : 'marine';
      const units = state.units.map((u) =>
        u.side === turn && u.hp > 0 ? { ...u, ap: ACTION_POINTS } : u,
      );
      const round = turn === 'marine' ? state.round + 1 : state.round;
      return { ...state, units, turn, round, selected: null };
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
  const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  if (dist > UNITS[shooter.kind].range) return 'range';
  if (!canSee(state.map, shooter, target)) return 'sight';
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
  /** The shooter's base aim. */
  aim: number;
  /** Lost to distance beyond close range (zero or negative). */
  range: number;
  /** The target's cover facing the shooter, and what it costs. */
  cover: Cover | null;
  coverPenalty: number;
  /** No cover facing the shooter: the shot gets the flanking crit bonus. */
  flanked: boolean;
  /** Final chances in percent. */
  hit: number;
  crit: number;
}

/** The odds of a shot now, or null if it isn't allowed (see shotBlock). */
export function shotOdds(state: BattleState, shooterId: string, targetId: string): ShotOdds | null {
  if (shotBlock(state, shooterId, targetId) !== null) return null;
  const shooter = unitById(state, shooterId) as Unit;
  const target = unitById(state, targetId) as Unit;
  const stats = UNITS[shooter.kind];
  const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  const range = -Math.max(0, Math.floor(dist) - SHOOTING.closeRange) * SHOOTING.penaltyPerTile;
  const cover = coverAgainst(state.map, target, shooter);
  const coverPenalty = cover ? SHOOTING.cover[cover] : 0;
  const flanked = cover === null;
  const hit = Math.min(
    SHOOTING.maxChance,
    Math.max(SHOOTING.minChance, stats.aim + range - coverPenalty),
  );
  const crit = Math.min(100, stats.crit + (flanked ? SHOOTING.flankCrit : 0));
  return { aim: stats.aim, range, cover, coverPenalty, flanked, hit, crit };
}

function shoot(state: BattleState, shooterId: string, targetId: string): BattleState {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  const odds = shotOdds(state, shooterId, targetId);
  if (!shooter || !target || odds === null || shooter.side !== state.turn) return state;
  const chance = odds.hit;
  const roll = rngStep(state.rng);
  const hit = roll.value * 100 < chance;
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
  }
  const hp = Math.max(0, target.hp - damage);
  const facing = target.x === shooter.x ? shooter.facing : target.x > shooter.x ? 1 : -1;
  // A shot uses all remaining action points, as in XCOM.
  const ammo = shooter.ammo === null ? null : shooter.ammo - 1;
  let next = replaceUnit(state, { ...shooter, facing, ap: 0, ammo });
  next = replaceUnit(next, { ...target, hp });
  const lastShot = { shooterId, targetId, chance, hit, crit, damage, killed: hp === 0 };
  return { ...next, rng, lastShot };
}

/** Tiles a unit could move to with one move action, keyed by `y * cols + x`, with step counts. */
export function moveRange(state: BattleState, unitId: string): Map<number, number> {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0) return new Map();
  const steps = maxSteps(unit);
  const range = reachable(state.map.cols, state.map.rows, passableFor(state), unit, steps);
  range.delete(unit.y * state.map.cols + unit.x);
  return range;
}

/**
 * Action points a move of `steps` tiles costs: 1 within the unit's move range,
 * 2 for a dash (up to twice as far), which needs both points.
 */
export function moveCost(unit: Unit, steps: number): number {
  return steps <= unit.move ? 1 : 2;
}

/** The farthest a unit can move now: a dash if it has both action points. */
function maxSteps(unit: Unit): number {
  return unit.ap >= ACTION_POINTS ? unit.move * 2 : unit.move;
}

/** The path a unit would run to reach `to` with one move, or null if it can't. */
export function pathFor(state: BattleState, unitId: string, to: Point): Point[] | null {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0) return null;
  const { cols, rows } = state.map;
  return findPath(cols, rows, passableFor(state), unit, to, maxSteps(unit));
}

/** Units block movement (living ones only); so do props. */
function passableFor(state: BattleState): (x: number, y: number) => boolean {
  return (x, y) => isWalkable(state.map, x, y) && unitAt(state, x, y) === undefined;
}

function replaceUnit(state: BattleState, unit: Unit): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unit.id ? unit : u)) };
}

/** A full clip for this unit's weapon (null: it never needs reloading). */
export function clipSize(unit: Unit): number | null {
  return UNITS[unit.kind].ammo;
}

/** True if the unit can reload now: its turn, an action point, and a clip that isn't full. */
export function canReload(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  const clip = clipSize(unit);
  return clip !== null && unit.ammo !== null && unit.ammo < clip;
}

/** Living units on one side. */
export function livingUnits(state: BattleState, side: Side): Unit[] {
  return state.units.filter((u) => u.side === side && u.hp > 0);
}

/** True if any living unit on the side still has action points. */
export function canAct(state: BattleState, side: Side): boolean {
  return livingUnits(state, side).some((u) => u.ap > 0);
}

export function unitById(state: BattleState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function unitAt(state: BattleState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => u.x === x && u.y === y && u.hp > 0);
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

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
