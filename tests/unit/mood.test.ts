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

  it('plays the boss track once the Overseer is awake, over its escorts (M7.3)', () => {
    const b = createBattle(generateForest(3, MAP_COLS, MAP_ROWS), 3, { boss: true });
    const boss = b.units.find((u) => u.kind === 'overseer');
    const escort = b.units.find((u) => u.side === 'alien' && u.kind !== 'overseer');
    if (!boss || !escort) throw new Error('no boss or escort');
    expect(battleMood(b)).toBe('calm');
    expect(battleMood(change(b, escort.id, { dormant: false }))).toBe('tense');
    const awake = change(change(b, boss.id, { dormant: false }), escort.id, { dormant: false });
    expect(battleMood(awake)).toBe('boss');
  });

  it('ignores the squad: marines are never dormant', () => {
    const b = start();
    expect(b.units.some((u) => u.side === 'marine' && !u.dormant)).toBe(true);
    expect(battleMood(b)).toBe('calm');
  });
});
