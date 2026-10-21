import type { BattleState } from './battle';

/*
 * The battle's mood, for its music (M7.2, owner 2026-10-20): calm while every living
 * alien still waits hidden in its group, tense once any of them is awake and hunting
 * the squad (from the moment its group is spotted until it dies).
 */

export type BattleMood = 'calm' | 'tense' | 'boss';

/** Once the Overseer is awake, its own track (M7.3) until it falls (which ends the battle). */
export function battleMood(state: BattleState): BattleMood {
  const awake = state.units.filter((u) => u.side === 'alien' && u.hp > 0 && !u.dormant);
  if (awake.some((u) => u.kind === 'overseer')) return 'boss';
  return awake.length > 0 ? 'tense' : 'calm';
}
