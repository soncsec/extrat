import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS, SKIRMISH, UNITS } from '../../src/config/tuning';
import { apply, createBattle, unitAt, unitById, type BattleState } from '../../src/logic/battle';
import { generateForest, isWalkable, spawnZone, type BattleMap } from '../../src/logic/map';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

const battle = (seed: number): BattleState =>
  createBattle(generateForest(seed, MAP_COLS, MAP_ROWS), seed);

/** An open map with optional props: '#' is a pine, 'b' a bush, anything else is free. */
function openMap(rows: string[]): BattleMap {
  const cols = (rows[0] as string).length;
  return {
    cols,
    rows: rows.length,
    seed: 0,
    tiles: rows.flatMap((r) =>
      [...r].map((c) => ({
        prop: c === '#' ? ('pine' as const) : c === 'b' ? ('bush' as const) : null,
        anchor: c !== '.',
      })),
    ),
    decals: [],
  };
}

describe('createBattle', () => {
  it('deploys the squad in the west and the aliens in the east', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = battle(seed);
      const marines = s.units.filter((u) => u.side === 'marine');
      const aliens = s.units.filter((u) => u.side === 'alien');
      expect(marines).toHaveLength(SKIRMISH.marines);
      expect(aliens).toHaveLength(SKIRMISH.aliens);
      const [wMin, wMax] = spawnZone(MAP_COLS, 'west');
      const [eMin, eMax] = spawnZone(MAP_COLS, 'east');
      for (const m of marines) expect(m.x >= wMin && m.x <= wMax, `seed ${seed}`).toBe(true);
      for (const a of aliens) expect(a.x >= eMin && a.x <= eMax, `seed ${seed}`).toBe(true);
    }
  });

  it('puts every unit on its own walkable tile', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = battle(seed);
      const tiles = new Set(s.units.map((u) => `${u.x},${u.y}`));
      expect(tiles.size).toBe(s.units.length);
      for (const u of s.units) expect(isWalkable(s.map, u.x, u.y)).toBe(true);
    }
  });

  it('keeps squadmates apart on the forest maps', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const marines = battle(seed).units.filter((u) => u.side === 'marine');
      for (const a of marines) {
        for (const b of marines) {
          if (a === b) continue;
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(SKIRMISH.minSpacing);
        }
      }
    }
  });

  it('starts the marines turn with full health, facing the enemy, nothing selected', () => {
    const s = battle(3);
    expect(s.turn).toBe('marine');
    expect(s.selected).toBeNull();
    for (const u of s.units) {
      const hp = u.side === 'marine' ? UNITS.marine.hp : UNITS.walker.hp;
      expect(u).toMatchObject({ hp, maxHp: hp, facing: u.side === 'marine' ? 1 : -1 });
    }
  });

  it('gives each marine a different name', () => {
    const names = battle(8)
      .units.filter((u) => u.side === 'marine')
      .map((u) => u.name);
    expect(new Set(names).size).toBe(SKIRMISH.marines);
  });

  it('is the same for the same seed', () => {
    expect(battle(55)).toEqual(battle(55));
  });

  it('prefers tiles with cover facing the enemy', () => {
    // Only (2,1) has a bush to its east inside the west zone (columns 1-4).
    const map = openMap([
      '..........',
      '..b.......',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
    ]);
    map.tiles[1 * 10 + 2] = { prop: null, anchor: false };
    map.tiles[1 * 10 + 3] = { prop: 'bush', anchor: true };
    for (let seed = 1; seed <= 20; seed++) {
      const s = createBattle(map, seed);
      expect(s.units.some((u) => u.side === 'marine' && u.x === 2 && u.y === 1)).toBe(true);
    }
  });

  it('packs units closer when the zone is too small to keep them apart', () => {
    // A narrow map: each zone has only one column of free tiles.
    const map = openMap(['......', '......', '......', '......']);
    const s = createBattle(map, 1);
    expect(s.units.filter((u) => u.side === 'marine')).toHaveLength(SKIRMISH.marines);
  });

  it('throws if a spawn zone cannot hold everyone', () => {
    // One row: the west zone (columns 1-4) has only two free tiles.
    const map = openMap(['.##...']);
    expect(() => createBattle(map, 1)).toThrow(/spawn tiles/);
  });
});

describe('apply select and deselect', () => {
  const s = battle(12);
  const marine = must(s.units.find((u) => u.side === 'marine'));
  const alien = must(s.units.find((u) => u.side === 'alien'));

  it('selects a living marine on the marines turn', () => {
    const next = apply(s, { type: 'select', unitId: marine.id });
    expect(next.selected).toBe(marine.id);
    expect(s.selected).toBeNull(); // the old state is unchanged
  });

  it('ignores aliens, unknown ids, dead marines and the alien turn', () => {
    expect(apply(s, { type: 'select', unitId: alien.id })).toBe(s);
    expect(apply(s, { type: 'select', unitId: 'nobody' })).toBe(s);
    const dead = { ...s, units: s.units.map((u) => (u.id === marine.id ? { ...u, hp: 0 } : u)) };
    expect(apply(dead, { type: 'select', unitId: marine.id })).toBe(dead);
    const alienTurn: BattleState = { ...s, turn: 'alien' };
    expect(apply(alienTurn, { type: 'select', unitId: marine.id })).toBe(alienTurn);
  });

  it('returns the same state when selecting the selected marine again', () => {
    const once = apply(s, { type: 'select', unitId: marine.id });
    expect(apply(once, { type: 'select', unitId: marine.id })).toBe(once);
  });

  it('deselects, and does nothing when nothing is selected', () => {
    const once = apply(s, { type: 'select', unitId: marine.id });
    expect(apply(once, { type: 'deselect' }).selected).toBeNull();
    expect(apply(s, { type: 'deselect' })).toBe(s);
  });
});

describe('unit lookups', () => {
  const s = battle(4);
  const u = must(s.units[0]);

  it('finds units by id and by tile', () => {
    expect(unitById(s, u.id)).toBe(u);
    expect(unitAt(s, u.x, u.y)).toBe(u);
    expect(unitAt(s, -1, -1)).toBeUndefined();
  });

  it('ignores dead units on a tile', () => {
    const dead = { ...s, units: s.units.map((x) => (x.id === u.id ? { ...x, hp: 0 } : x)) };
    expect(unitAt(dead, u.x, u.y)).toBeUndefined();
  });
});
