import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS, MISSIONS } from '../../src/config/tuning';
import { createBattle, footprint, unitVisibleTo, type Unit } from '../../src/logic/battle';
import { generateMap } from '../../src/logic/map';

/** Fewest steps (no diagonals) between a marine and any tile the alien stands on. */
const gap = (m: Unit, a: Unit): number =>
  Math.min(...footprint(a).map((t) => Math.abs(m.x - t.x) + Math.abs(m.y - t.y)));

/** No alien is closer than this when a battle starts (owner, 2026-10-19). */
const MIN_START_STEPS = 8;

describe('a battle never starts with aliens near the squad (owner, 2026-10-19)', () => {
  MISSIONS.forEach((mission, i) => {
    it(`mission ${i + 1}: every alien out of sight and at least ${MIN_START_STEPS} steps away, on 500 maps`, () => {
      for (let seed = 1; seed <= 500; seed++) {
        const map = generateMap(seed, MAP_COLS, MAP_ROWS, mission.landscape);
        const s = createBattle(map, map.seed, {
          pods: mission.pods,
          kinds: mission.kinds,
          boss: 'boss' in mission && mission.boss,
        });
        const marines = s.units.filter((u) => u.side === 'marine');
        expect(marines.length).toBe(4);
        for (const a of s.units.filter((u) => u.side === 'alien')) {
          expect(a.dormant, `seed ${seed} ${a.id} asleep`).toBe(true);
          expect(unitVisibleTo(s, 'marine', a), `seed ${seed} ${a.id} in sight`).toBe(false);
          for (const m of marines) {
            expect(gap(m, a), `seed ${seed} ${a.id} near ${m.id}`).toBeGreaterThanOrEqual(
              MIN_START_STEPS,
            );
          }
        }
      }
    });
  });
});
