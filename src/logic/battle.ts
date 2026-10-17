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
  damage: number;
  killed: boolean;
}

export type Action =
  | { type: 'select'; unitId: string }
  | { type: 'deselect' }
  | { type: 'move'; unitId: string; to: Point }
  | { type: 'shoot'; unitId: string; targetId: string }
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
      return replaceUnit(state, { ...unit, x, y, facing, ap: unit.ap - 1 });
    }
    case 'shoot':
      return shoot(state, action.unitId, action.targetId);
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
export type ShotBlock = 'range' | 'sight' | 'other';

export function shotBlock(
  state: BattleState,
  shooterId: string,
  targetId: string,
): ShotBlock | null {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  if (!shooter || !target || shooter.hp <= 0 || target.hp <= 0) return 'other';
  if (shooter.side === target.side || shooter.ap <= 0) return 'other';
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
  if (shotBlock(state, shooterId, targetId) !== null) return null;
  const shooter = unitById(state, shooterId) as Unit;
  const target = unitById(state, targetId) as Unit;
  const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  const range = Math.max(0, Math.floor(dist) - SHOOTING.closeRange) * SHOOTING.penaltyPerTile;
  const cover = coverAgainst(state.map, target, shooter);
  const coverPenalty = cover ? SHOOTING.cover[cover] : 0;
  const chance = UNITS[shooter.kind].aim - range - coverPenalty;
  return Math.min(SHOOTING.maxChance, Math.max(SHOOTING.minChance, chance));
}

function shoot(state: BattleState, shooterId: string, targetId: string): BattleState {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  const chance = hitChance(state, shooterId, targetId);
  if (!shooter || !target || chance === null || shooter.side !== state.turn) return state;
  const roll = rngStep(state.rng);
  const hit = roll.value * 100 < chance;
  let rng = roll.state;
  let damage = 0;
  if (hit) {
    const { min, max } = UNITS[shooter.kind].damage;
    const dmgRoll = rngStep(rng);
    rng = dmgRoll.state;
    damage = min + Math.floor(dmgRoll.value * (max - min + 1));
  }
  const hp = Math.max(0, target.hp - damage);
  const facing = target.x === shooter.x ? shooter.facing : target.x > shooter.x ? 1 : -1;
  // A shot uses all remaining action points, as in XCOM.
  let next = replaceUnit(state, { ...shooter, facing, ap: 0 });
  next = replaceUnit(next, { ...target, hp });
  const lastShot = { shooterId, targetId, chance, hit, damage, killed: hp === 0 };
  return { ...next, rng, lastShot };
}

/** Tiles a unit could move to with one move action, keyed by `y * cols + x`, with step counts. */
export function moveRange(state: BattleState, unitId: string): Map<number, number> {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0) return new Map();
  const range = reachable(state.map.cols, state.map.rows, passableFor(state), unit, unit.move);
  range.delete(unit.y * state.map.cols + unit.x);
  return range;
}

/** The path a unit would run to reach `to` with one move action, or null if it can't. */
export function pathFor(state: BattleState, unitId: string, to: Point): Point[] | null {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0) return null;
  const { cols, rows } = state.map;
  return findPath(cols, rows, passableFor(state), unit, to, unit.move);
}

/** Units block movement (living ones only); so do props. */
function passableFor(state: BattleState): (x: number, y: number) => boolean {
  return (x, y) => isWalkable(state.map, x, y) && unitAt(state, x, y) === undefined;
}

function replaceUnit(state: BattleState, unit: Unit): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unit.id ? unit : u)) };
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
