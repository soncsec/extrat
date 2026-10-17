import { describe, expect, it } from 'vitest';
import { FOREST, MAP_COLS, MAP_ROWS } from '../../src/config/tuning';
import {
  generateForest,
  isWalkable,
  PROPS,
  tileAt,
  validateMap,
  type BattleMap,
} from '../../src/logic/map';

const gen = (seed: number): BattleMap => generateForest(seed, MAP_COLS, MAP_ROWS);

describe('generateForest', () => {
  it('gives the same map for the same seed', () => {
    expect(gen(1234)).toEqual(gen(1234));
  });

  it('gives different maps for different seeds', () => {
    expect(gen(1).tiles).not.toEqual(gen(2).tiles);
  });

  it('makes a valid map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = gen(seed);
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  });

  it('blocks the tree line along the top edge', () => {
    const map = gen(7);
    for (let y = 0; y < FOREST.treeLineRows; y++) {
      for (let x = 0; x < MAP_COLS; x++) expect(tileAt(map, x, y)?.prop).toBe('pine');
    }
  });

  it('keeps tree clusters out of the spawn zones', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = gen(seed);
      for (let y = FOREST.treeLineRows; y < MAP_ROWS; y++) {
        for (const x of [0, 1, 2, 3, MAP_COLS - 4, MAP_COLS - 3, MAP_COLS - 2, MAP_COLS - 1]) {
          const prop = tileAt(map, x, y)?.prop;
          expect(prop === 'pine' || prop === 'oak', `seed ${seed} at ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it('gives every prop a complete footprint with one anchor', () => {
    const map = gen(99);
    map.tiles.forEach((t, i) => {
      if (!t.prop || !t.anchor) return;
      const x = i % map.cols;
      const y = Math.floor(i / map.cols);
      for (let k = 1; k < PROPS[t.prop].width; k++) {
        expect(tileAt(map, x + k, y)).toEqual({ prop: t.prop, anchor: false });
      }
    });
    const boulderAnchors = map.tiles.filter((t) => t.prop === 'boulder' && t.anchor).length;
    const boulderTiles = map.tiles.filter((t) => t.prop === 'boulder').length;
    expect(boulderTiles).toBe(boulderAnchors * 2);
  });

  it('places cover in the middle of the map', () => {
    const map = gen(5);
    const cover = map.tiles.filter((t) => t.prop === 'bush' || t.prop === 'rocks').length;
    expect(cover).toBeGreaterThan(0);
  });

  it('throws if no attempt gives a valid map', () => {
    const impossible = { ...FOREST, minSpawnTiles: 10_000, maxAttempts: 3 };
    expect(() => generateForest(1, MAP_COLS, MAP_ROWS, impossible)).toThrow(/no valid forest map/);
  });
});

describe('validateMap', () => {
  const empty = (cols: number, rows: number): BattleMap => ({
    cols,
    rows,
    seed: 0,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  });
  const opts = { ...FOREST, spawnCols: 2, minSpawnTiles: 5 };

  it('accepts an open map', () => {
    expect(validateMap(empty(8, 4), opts)).toEqual([]);
  });

  it('reports tiles cut off by a wall', () => {
    const map = empty(8, 4);
    for (let y = 0; y < 4; y++) map.tiles[y * 8 + 4] = { prop: 'pine', anchor: true };
    expect(validateMap(map, opts)).toEqual(['12 walkable tiles are cut off']);
  });

  it('reports a crowded spawn zone', () => {
    const map = empty(8, 4);
    for (let y = 0; y < 4; y++) map.tiles[y * 8] = { prop: 'bush', anchor: true };
    expect(validateMap(map, opts)).toEqual(['west spawn zone has only 4 free tiles']);
    for (let y = 0; y < 4; y++) map.tiles[y * 8 + 7] = { prop: 'bush', anchor: true };
    map.tiles[1] = { prop: 'rocks', anchor: true };
    expect(validateMap(map, opts)).toEqual([
      'west spawn zone has only 3 free tiles',
      'east spawn zone has only 4 free tiles',
    ]);
  });

  it('reports a map with nothing walkable', () => {
    const map = empty(2, 1);
    map.tiles = map.tiles.map(() => ({ prop: 'oak' as const, anchor: true }));
    expect(validateMap(map, opts)).toEqual(['no walkable tiles']);
  });

  it('treats tiles off the map as not walkable', () => {
    const map = empty(2, 2);
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 0, 2)).toBe(false);
    expect(isWalkable(map, 1, 1)).toBe(true);
  });
});
