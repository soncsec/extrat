import { ABILITIES, MISSIONS } from '../config/tuning';
import type { AlienKind, DifficultyId } from './battle';
import { missionPods } from './campaign';

/** Plural names for the briefing. */
const PLURAL: Record<AlienKind, string> = {
  walker: 'walkers',
  flyer: 'flyers',
  lizard: 'lizards',
  snake: 'snakes',
};

/** One line that teaches a kind's ability the first time the player will meet it. */
const WARNING: Record<AlienKind, string> = {
  walker: 'New: Walkers claw up close, through cover.',
  flyer: 'New: Flyers fire from above, past cover.',
  lizard: 'New: Lizards drag you out of cover.',
  snake: `New: Snakes poison you for ${ABILITIES.poison.turns} turns.`,
};

/** 'walkers', 'walkers and flyers', 'walkers, flyers and lizards'. */
export function listKinds(kinds: readonly AlienKind[]): string {
  const names = kinds.map((k) => PLURAL[k]);
  if (names.length <= 1) return names[0] ?? 'aliens';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The briefing's intel for a mission (M5.8): how many aliens, which kinds, and a
 * warning about any kind the campaign hasn't fielded before.
 */
export function missionIntel(mission: number, difficulty: DifficultyId = 'veteran'): string[] {
  const m = MISSIONS[
    Math.min(Math.max(mission, 0), MISSIONS.length - 1)
  ] as (typeof MISSIONS)[number];
  const seen = new Set<AlienKind>(
    mission > 0 ? MISSIONS.slice(0, mission).flatMap((p) => p.kinds) : [],
  );
  const fresh = m.kinds.filter((k) => !seen.has(k));
  // The final mission (M5.6): what the player must know to beat the boss.
  if ('boss' in m && m.boss) {
    return [
      `Intel: the Overseer and ${m.pods.count} groups of ${m.pods.size}.`,
      'Its front is armoured: flank it.',
      'When it charges, leave the red squares.',
    ];
  }
  const list = listKinds(m.kinds);
  const pods = missionPods(m, difficulty);
  const groups =
    pods.count === 1 ? `one group of ${pods.size}` : `${pods.count} groups of ${pods.size}`;
  const lines = [`Intel: ${groups}.`, `Expect ${list}.`];
  for (const k of fresh) lines.push(WARNING[k]);
  return lines;
}
