import { SKIRMISH, UNITS } from '../config/tuning';
import type { Point } from './grid';
import { isWalkable, spawnZone, tileAt, type BattleMap } from './map';
import { createRng, type Rng } from './rng';

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
}

export interface BattleState {
  map: BattleMap;
  units: Unit[];
  /** Whose turn it is. */
  turn: Side;
  /** The marine the player is commanding, if any. */
  selected: string | null;
}

export type Action = { type: 'select'; unitId: string } | { type: 'deselect' };

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
  }));
  return { map, units: [...marines, ...aliens], turn: 'marine', selected: null };
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
  }
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
