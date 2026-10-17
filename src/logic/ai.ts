import {
  canSee,
  coverAgainst,
  hitChance,
  livingUnits,
  moveRange,
  unitById,
  type Action,
  type BattleState,
} from './battle';
import type { Point } from './grid';
import { UNITS } from '../config/tuning';

/**
 * The aliens' choices for the skirmish: shoot if possible, otherwise move toward
 * the squad, preferring a tile with a clear shot and cover facing the squad.
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
  const dist = (p: Point, q: Point): number => Math.hypot(q.x - p.x, q.y - p.y);
  const COVER_SCORE = { full: 20, half: 10 } as const;
  const FLANK_SCORE = 5;
  const DASH_PENALTY = 50;
  // A tile with a clear shot beats one without; then cover facing the nearest marine;
  // then fewer steps. Without a shot, closer is better.
  const score = (p: Point, steps: number): number => {
    const nearest = marines.reduce((a, b) => (dist(p, b) < dist(p, a) ? b : a));
    const shot = marines.some((m) => dist(p, m) <= range && canSee(state.map, p, m));
    if (!shot) return -dist(p, nearest);
    const cover = coverAgainst(state.map, p, nearest);
    // A bonus for a tile that flanks a marine it can shoot: crits are likelier.
    const flanks = marines.some(
      (m) =>
        dist(p, m) <= range && canSee(state.map, p, m) && coverAgainst(state.map, m, p) === null,
    );
    // Dashing into position leaves no action point to shoot with this turn.
    const dash = steps > alien.move ? DASH_PENALTY : 0;
    return 100 + (cover ? COVER_SCORE[cover] : 0) + (flanks ? FLANK_SCORE : 0) - dash - steps * 0.1;
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
