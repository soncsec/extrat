import {
  canOverwatch,
  canSee,
  hitChance,
  isVisibleTo,
  livingUnits,
  moveCost,
  moveRange,
  oddsBetween,
  pathFor,
  reactionOdds,
  unitById,
  type Action,
  type BattleState,
  type ShotOdds,
  type Unit,
} from './battle';
import { reachable, type Point } from './grid';
import { isWalkable } from './map';
import { rngStep } from './rng';
import { ACTION_POINTS, AI, UNITS } from '../config/tuning';

/**
 * Utility AI (ADR-E4). Each alien scores staying put and every tile it could move to:
 * the shot it would have from there, the danger from marines who would see it there,
 * overwatch fire on the way, staying near its pod, and a small seeded nudge. It goes to
 * the best tile; if that is where it stands, it shoots, or else watches.
 *
 * Awake aliens know where every marine is (the squad gave itself away when it spotted
 * them), but they shoot only what they can see, like the marines.
 */

/** The next action for one alien, or null when it has nothing useful to do. */
export function planAlienAction(state: BattleState, alienId: string): Action | null {
  const alien = unitById(state, alienId);
  if (!alien || alien.side !== 'alien' || alien.hp <= 0 || alien.ap <= 0) return null;
  // A dormant pod waits, unseen, until the squad spots it.
  if (alien.dormant) return null;
  if (state.turn !== 'alien') return null;
  const marines = livingUnits(state, 'marine');
  if (marines.length === 0) return null;

  const shot = bestShotNow(state, alien, marines);
  const shoot: Action | null = shot ? { type: 'shoot', unitId: alien.id, targetId: shot } : null;
  const watch: Action | null = canOverwatch(state, alien.id)
    ? { type: 'overwatch', unitId: alien.id }
    : null;
  // After moving, the last point goes on the shot the move was for, or on watching.
  if (alien.ap < ACTION_POINTS && (shoot ?? watch)) return shoot ?? watch;

  const cols = state.map.cols;
  let to: Point | null = null;
  let best = scoreTile(state, alien, marines, alien, 0);
  for (const [key, steps] of moveRange(state, alien.id)) {
    const p = { x: key % cols, y: Math.floor(key / cols) };
    const s = scoreTile(state, alien, marines, p, steps);
    if (s > best) {
      best = s;
      to = p;
    }
  }
  if (to) return { type: 'move', unitId: alien.id, to };
  return shoot ?? watch;
}

/**
 * How good it is for `alien` to end up at `p` after walking `steps` (0: staying put).
 * Exported for tests, which check how the parts of the score compare.
 */
export function scoreTile(
  state: BattleState,
  alien: Unit,
  marines: readonly Unit[],
  p: Point,
  steps: number,
): number {
  const at: Unit = { ...alien, x: p.x, y: p.y };
  const apLeft = steps === 0 ? alien.ap : alien.ap - moveCost(alien, steps);
  const range = UNITS[alien.kind].range;
  const inReach = marines.filter((m) => dist(p, m) <= range && canSee(state.map, p, m));

  let score: number;
  if (inReach.length > 0 && apLeft > 0) {
    score = Math.max(...inReach.map((m) => shotValue(oddsBetween(state, at, m, false), at, m)));
  } else if (inReach.length > 0) {
    score = AI.setupValue;
  } else {
    // Closing in is measured on foot: a pocket behind trees isn't close, however near
    // it looks in a straight line.
    const walk = walkingDistance(state, marines, p);
    const nearest = Number.isFinite(walk) ? walk : Math.min(...marines.map((m) => dist(p, m)));
    score = -AI.approachCost * Math.max(0, nearest - range);
  }
  return (
    score -
    AI.threatCost * threatAt(state, at, marines) -
    AI.overwatchCost * (steps > 0 ? overwatchOnTheWay(state, alien, p) : 0) -
    AI.groupCost * strayFromPod(state, at) -
    AI.stepCost * steps +
    AI.noise * nudge(state, alien, p)
  );
}

/** The marine worth shooting most from where the alien stands, if it can shoot now. */
function bestShotNow(state: BattleState, alien: Unit, marines: readonly Unit[]): string | null {
  let best: { id: string; value: number } | null = null;
  for (const m of marines) {
    if (hitChance(state, alien.id, m.id) === null) continue;
    const value = shotValue(oddsBetween(state, alien, m, false), alien, m);
    if (!best || value > best.value) best = { id: m.id, value };
  }
  return best?.id ?? null;
}

/**
 * What an attack is worth: likelier hits, possible kills and likely crits score
 * higher, and so does a hit whose ability would do something (each kind's preference).
 */
function shotValue(odds: ShotOdds, shooter: Unit, target: Unit): number {
  const stats = UNITS[shooter.kind];
  const adjacent = Math.hypot(target.x - shooter.x, target.y - shooter.y) <= 1.5;
  let extra = 0;
  if (target.hp <= stats.damage.max) extra = AI.killValue;
  else if (stats.ability === 'pull' && !adjacent) extra = AI.pullValue;
  else if (stats.ability === 'poison' && target.poison === 0) extra = AI.poisonValue;
  return (odds.hit / 100) * (AI.hitValue + extra + (odds.crit / 100) * AI.critValue);
}

/**
 * Total hit chance, in percent, of the marines who could shoot the alien at this tile
 * next turn. None if the squad couldn't see it there.
 */
function threatAt(state: BattleState, at: Unit, marines: readonly Unit[]): number {
  if (!isVisibleTo(state, 'marine', at)) return 0;
  let total = 0;
  for (const m of marines) {
    if (dist(m, at) > UNITS[m.kind].range || !canSee(state.map, m, at)) continue;
    total += oddsBetween(state, m, at, false).hit;
  }
  return total;
}

/**
 * Total hit chance, in percent, of the overwatch shots the alien would draw walking to
 * `to`: each watching marine fires once, at the first tile it can shoot.
 */
function overwatchOnTheWay(state: BattleState, alien: Unit, to: Point): number {
  const watchers = livingUnits(state, 'marine').filter((m) => m.overwatch);
  if (watchers.length === 0) return 0;
  const path = pathFor(state, alien.id, to) ?? [];
  const fired = new Set<string>();
  let total = 0;
  for (const p of path) {
    const there: BattleState = {
      ...state,
      units: state.units.map((u) => (u.id === alien.id ? { ...u, x: p.x, y: p.y } : u)),
    };
    for (const w of watchers) {
      if (fired.has(w.id)) continue;
      const odds = reactionOdds(there, w.id, alien.id);
      if (!odds) continue;
      fired.add(w.id);
      total += odds.hit;
    }
  }
  return total;
}

/** Tiles beyond the group range to the nearest awake pod mate (0 with none). */
function strayFromPod(state: BattleState, at: Unit): number {
  const mates = livingUnits(state, 'alien').filter(
    (u) => u.id !== at.id && u.pod !== null && u.pod === at.pod && !u.dormant,
  );
  if (mates.length === 0) return 0;
  const nearest = Math.min(...mates.map((u) => dist(at, u)));
  return Math.max(0, nearest - AI.groupRange);
}

/**
 * A number in [0, 1) fixed by the battle's random state, the alien and the tile. It
 * nudges near-ties without using up a roll, so planning never changes the state.
 */
function nudge(state: BattleState, alien: Unit, p: Point): number {
  let h = state.rng;
  for (const ch of alien.id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  h ^= Math.imul(p.y * state.map.cols + p.x + 1, 0x9e3779b1);
  return rngStep(h >>> 0).value;
}

/** Steps on foot from each tile to the nearest marine, worked out once per list of marines. */
const walkCache = new WeakMap<readonly Unit[], Map<number, number>>();

/** Steps on foot from `p` to the nearest marine (around props, ignoring units). */
function walkingDistance(state: BattleState, marines: readonly Unit[], p: Point): number {
  let steps = walkCache.get(marines);
  if (!steps) {
    const found = new Map<number, number>();
    const { cols, rows } = state.map;
    for (const m of marines) {
      const from = reachable(cols, rows, (x, y) => isWalkable(state.map, x, y), m);
      for (const [key, d] of from) found.set(key, Math.min(d, found.get(key) ?? Infinity));
    }
    walkCache.set(marines, found);
    steps = found;
  }
  return steps.get(p.y * state.map.cols + p.x) ?? Infinity;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
