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
      // The boss mission has its own briefing (tested below).
      if ('boss' in m && m.boss) continue;
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

  it('tells the player how to beat the boss before the final mission (M5.6)', () => {
    const last = MISSIONS.length - 1;
    const lines = missionIntel(last);
    expect(lines[0]).toMatch(/^Intel: the Overseer and 2 groups of 2\.$/);
    expect(lines.join(' ')).toMatch(/armoured: flank it/);
    expect(lines.join(' ')).toMatch(/leave the red squares/);
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

describe('intel on RECRUIT (M6.3)', () => {
  it('counts the groups the mission fields at that difficulty', () => {
    expect(missionIntel(0, 'recruit')[0]).toBe('Intel: one group of 2.');
    expect(missionIntel(0, 'veteran')[0]).toBe('Intel: 2 groups of 2.');
    expect(missionIntel(2, 'recruit')[0]).toBe('Intel: 2 groups of 2.');
    expect(missionIntel(2, 'veteran')[0]).toBe('Intel: 3 groups of 2.');
  });

  it('counts the boss`s escort groups at that difficulty', () => {
    const last = MISSIONS.length - 1;
    expect(missionIntel(last, 'recruit')[0]).toBe('Intel: the Overseer and one group of 2.');
    expect(missionIntel(last, 'veteran')[0]).toBe('Intel: the Overseer and 2 groups of 2.');
  });

  it('fits the briefing panel on RECRUIT too', () => {
    for (let i = 0; i < MISSIONS.length; i++) {
      for (const l of missionIntel(i, 'recruit')) expect(l.length, l).toBeLessThanOrEqual(46);
    }
  });
});
