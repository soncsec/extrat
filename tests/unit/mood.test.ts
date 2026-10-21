import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS } from '../../src/config/tuning';
import { createBattle, type BattleState } from '../../src/logic/battle';
import { generateForest } from '../../src/logic/map';
import { battleMood } from '../../src/logic/mood';

const start = (): BattleState => createBattle(generateForest(3, MAP_COLS, MAP_ROWS), 3);
const change = (b: BattleState, id: string, f: object): BattleState => ({
  ...b,
  units: b.units.map((u) => (u.id === id ? { ...u, ...f } : u)),
});

describe('battle mood for the music (M7.2)', () => {
  it('is calm while every alien waits hidden', () => {
    const b = start();
    expect(b.units.filter((u) => u.side === 'alien').every((u) => u.dormant)).toBe(true);
    expect(battleMood(b)).toBe('calm');
  });

  it('is tense while any alien is awake, and calm again once the awake ones are dead', () => {
    const b = start();
    const alien = b.units.find((u) => u.side === 'alien');
    if (!alien) throw new Error('no alien');
    const awake = change(b, alien.id, { dormant: false });
    expect(battleMood(awake)).toBe('tense');
    expect(battleMood(change(awake, alien.id, { hp: 0 }))).toBe('calm');
  });

  it('ignores the squad: marines are never dormant', () => {
    const b = start();
    expect(b.units.some((u) => u.side === 'marine' && !u.dormant)).toBe(true);
    expect(battleMood(b)).toBe('calm');
  });
});
