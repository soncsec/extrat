import {
  hitChance,
  livingUnits,
  moveRange,
  unitById,
  type Action,
  type BattleState,
} from './battle';
import type { Point } from './grid';
import { tileAt } from './map';
import { UNITS } from '../config/tuning';

/**
 * The aliens' choices for the M1 skirmish: shoot if possible, otherwise move
 * toward the squad, preferring a tile in range with cover next to it.
 * The utility-scoring AI of ADR-E4 replaces this in M3.
 */

/** The next action for one alien, or null when it has nothing useful to do. */
export function planAlienAction(state: BattleState, alienId: string): Action | null {
  const alien = unitById(state, alienId);
  if (!alien || alien.side !== 'alien' || alien.hp <= 0 || alien.ap <= 0) return null;
  if (state.turn !== 'alien') return null;
  const marines = livingUnits(state, 'marine');
  if (marines.length === 0) return null;

  // Shoot the easiest target; among equals, the most wounded.
  const shots = marines
    .map((m) => ({ m, chance: hitChance(state, alien.id, m.id) }))
    .filter((s): s is { m: (typeof marines)[number]; chance: number } => s.chance !== null)
    .sort((a, b) => b.chance - a.chance || a.m.hp - b.m.hp);
  const best = shots[0];
  if (best) return { type: 'shoot', unitId: alien.id, targetId: best.m.id };

  const range = UNITS[alien.kind].range;
  const nearest = (p: Point): number =>
    Math.min(...marines.map((m) => Math.hypot(m.x - p.x, m.y - p.y)));
  const hasCover = (p: Point): boolean =>
    [-1, 1].some((dx) => tileAt(state.map, p.x + dx, p.y)?.prop != null);
  // In range beats out of range; then cover; then fewer steps. Out of range: closer is better.
  const score = (p: Point, steps: number): number => {
    const d = nearest(p);
    return d <= range ? 100 + (hasCover(p) ? 10 : 0) - steps * 0.1 : -d;
  };

  const cols = state.map.cols;
  let to: Point | null = null;
  let bestScore = score(alien, 0);
  for (const [key, steps] of moveRange(state, alien.id)) {
    const p = { x: key % cols, y: Math.floor(key / cols) };
    const s = score(p, steps);
    if (s > bestScore) {
      bestScore = s;
      to = p;
    }
  }
  return to ? { type: 'move', unitId: alien.id, to } : null;
}
