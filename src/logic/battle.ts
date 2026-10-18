import { ACTION_POINTS, GRENADE, OVERWATCH, SHOOTING, SKIRMISH, UNITS } from '../config/tuning';
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
  /** Watching for enemies who move into sight; cleared when this unit's turn comes round. */
  overwatch: boolean;
  /** Grenades left. */
  grenades: number;
  /** Caught by a grenade: no cover bonus until the thrower's side starts its next turn. */
  exposed: boolean;
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
  /** What the most recent grenade did. */
  lastThrow: ThrowResult | null;
}

export interface ThrowResult {
  unitId: string;
  at: Point;
  /** Everyone caught in the blast (friend or foe), in unit order. */
  hits: { unitId: string; damage: number; hpAfter: number; killed: boolean }[];
}

export interface MoveResult {
  unitId: string;
  /** The tiles actually walked, which stop early if a reaction shot kills the mover. */
  path: Point[];
  /** Reaction shots, each fired when the mover reached path[step]. */
  reactions: { step: number; shot: ShotResult }[];
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
}

export type Action =
  | { type: 'select'; unitId: string }
  | { type: 'deselect' }
  | { type: 'move'; unitId: string; to: Point }
  | { type: 'shoot'; unitId: string; targetId: string }
  | { type: 'reload'; unitId: string }
  | { type: 'overwatch'; unitId: string }
  | { type: 'throw'; unitId: string; at: Point }
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
    overwatch: false,
    grenades: GRENADE.perMarine,
    exposed: false,
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
    overwatch: false,
    grenades: 0,
    exposed: false,
  }));
  return {
    map,
    units: [...marines, ...aliens],
    turn: 'marine',
    round: 1,
    selected: null,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    lastShot: null,
    lastMove: null,
    lastThrow: null,
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
    case 'move':
      return move(state, action.unitId, action.to);
    case 'overwatch': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canOverwatch(state, unit.id)) return state;
      return replaceUnit(state, { ...unit, overwatch: true, ap: 0 });
    }
    case 'shoot':
      return shoot(state, action.unitId, action.targetId);
    case 'throw':
      return throwGrenade(state, action.unitId, action.at);
    case 'reload': {
      const unit = unitById(state, action.unitId);
      if (!unit || !canReload(state, unit.id)) return state;
      return replaceUnit(state, { ...unit, ammo: clipSize(unit), ap: unit.ap - 1 });
    }
    case 'endTurn': {
      // The other side's living units get their action points back.
      const turn: Side = state.turn === 'marine' ? 'alien' : 'marine';
      // Their overwatch ends: it only lasts through the other side's turn. The other
      // side's exposure ends too: it lasted until this side's turn came round again.
      const units = state.units.map((u) => {
        if (u.side !== turn) return u.exposed ? { ...u, exposed: false } : u;
        return u.hp > 0 ? { ...u, ap: ACTION_POINTS, overwatch: false } : u;
      });
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
  /** Taken off for an overwatch reaction shot (zero for aimed shots). */
  reactionPenalty: number;
  /** The target was caught by a grenade: its cover doesn't count. */
  exposed: boolean;
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
  if (Math.hypot(target.x - shooter.x, target.y - shooter.y) > UNITS[shooter.kind].range)
    return null;
  if (!canSee(state.map, shooter, target)) return null;
  return oddsBetween(state, shooter, target, true);
}

function oddsBetween(state: BattleState, shooter: Unit, target: Unit, reaction: boolean): ShotOdds {
  const stats = UNITS[shooter.kind];
  const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  const range = -Math.max(0, Math.floor(dist) - SHOOTING.closeRange) * SHOOTING.penaltyPerTile;
  // A unit caught by a grenade has no cover to hide behind.
  const cover = target.exposed ? null : coverAgainst(state.map, target, shooter);
  const coverPenalty = cover ? SHOOTING.cover[cover] : 0;
  const flanked = cover === null;
  const reactionPenalty = reaction ? OVERWATCH.aimPenalty : 0;
  const hit = Math.min(
    SHOOTING.maxChance,
    Math.max(SHOOTING.minChance, stats.aim + range - coverPenalty - reactionPenalty),
  );
  const critBase = stats.crit + (flanked ? SHOOTING.flankCrit : 0);
  const crit = reaction && !OVERWATCH.canCrit ? 0 : Math.min(100, critBase);
  const exposed = target.exposed;
  return {
    aim: stats.aim,
    range,
    cover,
    coverPenalty,
    flanked,
    reactionPenalty,
    exposed,
    hit,
    crit,
  };
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
    (u) => u.hp > 0 && Math.hypot(u.x - at.x, u.y - at.y) <= GRENADE.radius,
  );
}

/** Throws a grenade: fixed damage to everyone in the blast, survivors lose cover. */
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
  // Throwing uses all remaining action points, like a shot.
  const after = unitById(next, unitId) as Unit;
  next = replaceUnit(next, { ...after, grenades: after.grenades - 1, ap: 0, facing });
  return { ...next, lastThrow: { unitId, at: { x: at.x, y: at.y }, hits } };
}

/** True if the unit can go on overwatch now: its turn, an action point, and ammo. */
export function canOverwatch(state: BattleState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.hp <= 0 || unit.ap <= 0 || unit.side !== state.turn) return false;
  return unit.ammo !== 0 && !unit.overwatch;
}

function shoot(state: BattleState, shooterId: string, targetId: string): BattleState {
  const shooter = unitById(state, shooterId);
  const target = unitById(state, targetId);
  const odds = shotOdds(state, shooterId, targetId);
  if (!shooter || !target || odds === null || shooter.side !== state.turn) return state;
  const fired = rollShot(state, shooter, target, odds, false);
  // An aimed shot uses all remaining action points, as in XCOM.
  const next = replaceUnit(fired.state, { ...(unitById(fired.state, shooterId) as Unit), ap: 0 });
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
  }
  const hp = Math.max(0, target.hp - damage);
  const facing = target.x === shooter.x ? shooter.facing : target.x > shooter.x ? 1 : -1;
  const ammo = shooter.ammo === null ? null : shooter.ammo - 1;
  let next = replaceUnit(state, { ...shooter, facing, ammo });
  next = replaceUnit(next, { ...target, hp });
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
  };
  return { state: { ...next, rng }, shot };
}

/**
 * Moves a unit along its path. At each tile, every enemy on overwatch that can now
 * see it takes one reaction shot (in unit order). A kill stops the move there.
 */
function move(state: BattleState, unitId: string, to: Point): BattleState {
  const unit = unitById(state, unitId);
  if (!unit || unit.side !== state.turn) return state;
  const path = pathFor(state, unit.id, to);
  if (!path) return state;
  const ap = unit.ap - moveCost(unit, path.length);

  let next = state;
  let facing = unit.facing;
  let prev: Point = unit;
  const walked: Point[] = [];
  const reactions: MoveResult['reactions'] = [];
  for (const [step, p] of path.entries()) {
    // Face the way the last sideways step went; straight up or down keeps the old facing.
    if (p.x !== prev.x) facing = p.x > prev.x ? 1 : -1;
    prev = p;
    walked.push(p);
    next = replaceUnit(next, { ...(unitById(next, unitId) as Unit), x: p.x, y: p.y, facing, ap });
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
  }
  return { ...next, lastMove: { unitId, path: walked, reactions } };
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
    if (u.hp > 0 && u.ap > 0) return u.id;
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
