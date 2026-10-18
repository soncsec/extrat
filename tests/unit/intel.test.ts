import { describe, expect, it } from 'vitest';
import { ABILITIES, MISSIONS } from '../../src/config/tuning';
import { listKinds, missionIntel } from '../../src/logic/intel';

describe('mission intel', () => {
  it('lists kinds in plain English', () => {
    expect(listKinds([])).toBe('aliens');
    expect(listKinds(['walker'])).toBe('walkers');
    expect(listKinds(['walker', 'flyer'])).toBe('walkers and flyers');
    expect(listKinds(['walker', 'flyer', 'lizard'])).toBe('walkers, flyers and lizards');
  });

  it('warns about each kind the first time it appears, and never again', () => {
    const warned: string[] = [];
    for (let i = 0; i < MISSIONS.length; i++) {
      const lines = missionIntel(i);
      const m = MISSIONS[i] as (typeof MISSIONS)[number];
      expect(lines[0]).toBe(`Intel: ${m.pods.count} groups of ${m.pods.size}.`);
      expect(lines[1]?.toLowerCase()).toContain(listKinds(m.kinds));
      const news = lines.slice(2);
      for (const n of news) {
        expect(n).toMatch(/^New: /);
        expect(warned).not.toContain(n);
        warned.push(n);
      }
    }
    expect(missionIntel(0)[2]).toContain('Walkers');
    expect(warned).toHaveLength(4);
    expect(warned.some((w) => w.includes(`${ABILITIES.poison.turns} turns`))).toBe(true);
  });

  it('fits the briefing panel: at most 46 characters a line, at most 3 lines', () => {
    for (let i = 0; i < MISSIONS.length; i++) {
      const lines = missionIntel(i);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(46);
    }
    expect(missionIntel(99)).toEqual(missionIntel(MISSIONS.length - 1));
  });
});
