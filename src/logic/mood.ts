import type { BattleState } from './battle';

/*
 * The battle's mood, for its music (M7.2, owner 2026-10-20): calm while every living
 * alien still waits hidden in its group, tense once any of them is awake and hunting
 * the squad (from the moment its group is spotted until it dies).
 */

export type BattleMood = 'calm' | 'tense';

export function battleMood(state: BattleState): BattleMood {
  return state.units.some((u) => u.side === 'alien' && u.hp > 0 && !u.dormant) ? 'tense' : 'calm';
}
