import { describe, expect, it } from 'vitest';
import { FOREST, MAP_COLS, MAP_ROWS } from '../../src/config/tuning';
import {
  chunkCell,
  FOREST_CHUNKS,
  HILLS_CHUNKS,
  COAST_CHUNKS,
  CRASH_CHUNKS,
  SHIP_CHUNKS,
  TOWN_CHUNKS,
  type Chunk,
} from '../../src/logic/chunks';
import { landscapeId } from '../../src/logic/landscapes';
import {
  generateForest,
  generateMap,
  isWalkable,
  PROPS,
  spawnZone,
  tileAt,
  validateMap,
  type BattleMap,
} from '../../src/logic/map';

const gen = (seed: number): BattleMap => generateForest(seed, MAP_COLS, MAP_ROWS);

describe('generateForest', () => {
  it('gives the same map for the same seed', () => {
    expect(gen(1234)).toEqual(gen(1234));
  });

  it('rebuilds a map exactly from its own seed, for 1,000 seeds (M4.4 replay)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = gen(seed);
      expect(gen(map.seed), `seed ${seed} gave map ${map.seed}`).toEqual(map);
    }
  });

  it('gives different maps for different seeds', () => {
    expect(gen(1).tiles).not.toEqual(gen(2).tiles);
  });

  it('gives the squad cover and the sides a fair walk apart on 1,000 maps', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = gen(seed);
      const [w0, w1] = spawnZone(MAP_COLS, 'west');
      let covered = 0;
      for (let y = 0; y < MAP_ROWS; y++) {
        for (let x = w0; x <= w1; x++) {
          if (isWalkable(map, x, y) && tileAt(map, x + 1, y)?.prop) covered++;
        }
      }
      expect(covered, `seed ${seed}`).toBeGreaterThanOrEqual(FOREST.minSquadCover);
    }
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
        const [, westEdge] = spawnZone(MAP_COLS, 'west');
        const [eastEdge] = spawnZone(MAP_COLS, 'east');
        const zones = [...Array(MAP_COLS).keys()].filter((x) => x <= westEdge || x >= eastEdge);
        for (const x of zones) {
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
  // Small maps for the older checks; the squad-cover and distance checks have their own tests.
  const opts = { ...FOREST, spawnCols: 2, minSpawnTiles: 5, minSquadCover: 0, minSpawnSteps: 0 };

  it('accepts an open map', () => {
    expect(validateMap(empty(8, 4), opts)).toEqual([]);
  });

  it('reports tiles cut off by a wall', () => {
    const map = empty(8, 4);
    for (let y = 0; y < 4; y++) map.tiles[y * 8 + 4] = { prop: 'pine', anchor: true };
    expect(validateMap(map, opts)).toEqual(['12 walkable tiles are cut off']);
  });

  it('reports a crowded spawn zone', () => {
    // 8 x 4 map with spawnCols 2: the west zone is columns 1-2, the east zone 5-6.
    const map = empty(8, 4);
    const block = (x: number, y: number): void => {
      map.tiles[y * 8 + x] = { prop: 'bush', anchor: true };
    };
    for (const [x, y] of [
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
    ] as const)
      block(x, y);
    expect(validateMap(map, opts)).toEqual(['west spawn zone has only 4 free tiles']);
    for (const [x, y] of [
      [5, 0],
      [6, 0],
      [5, 1],
      [6, 1],
      [1, 2],
    ] as const)
      block(x, y);
    expect(validateMap(map, opts)).toEqual([
      'west spawn zone has only 3 free tiles',
      'east spawn zone has only 4 free tiles',
    ]);
  });

  it('reports a squad spawn zone without enough cover facing the enemy', () => {
    // 8 x 4, west zone columns 1-2: a bush east of (2,0) covers that tile only.
    const map = empty(8, 4);
    map.tiles[0 * 8 + 3] = { prop: 'bush', anchor: true };
    const strict = { ...opts, minSquadCover: 2 };
    expect(validateMap(map, strict)).toEqual([
      'only 1 squad spawn tiles have cover facing the enemy',
    ]);
    map.tiles[1 * 8 + 3] = { prop: 'rocks', anchor: true };
    expect(validateMap(map, strict)).toEqual([]);
  });

  it('reports spawn zones too few steps apart, counting the walk around props', () => {
    // 10 x 4: the west zone is columns 1-2, the east zone 7-8: 5 steps in a straight line.
    const map = empty(10, 4);
    expect(validateMap(map, { ...opts, minSpawnSteps: 6 })).toEqual([
      'spawn zones are only 5 steps apart',
    ]);
    // Walls in columns 4 (gap at the top) and 6 (gap at the bottom) make it a zig-zag:
    // (2,0) east to (5,0), down to (5,3), east to (7,3) is 8 steps.
    for (const y of [1, 2, 3]) map.tiles[y * 10 + 4] = { prop: 'oak', anchor: true };
    for (const y of [0, 1, 2]) map.tiles[y * 10 + 6] = { prop: 'oak', anchor: true };
    expect(validateMap(map, { ...opts, minSpawnSteps: 8 })).toEqual([]);
    expect(validateMap(map, { ...opts, minSpawnSteps: 9 })).toEqual([
      'spawn zones are only 8 steps apart',
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

describe('map chunks (ADR-E3)', () => {
  const all = [...FOREST_CHUNKS.spawn, ...FOREST_CHUNKS.field];

  it('are all the chunk size, in the legend, with whole boulders', () => {
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      for (const row of c.rows) {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        for (const ch of row) expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
        // A boulder is 'B-': two tiles, so every 'B' has a '-' after it and nothing else does.
        expect(row.replace(/B-/g, ''), c.name).not.toMatch(/[B-]/);
      }
    }
  });

  it('keep trees out of the spawn chunks', () => {
    for (const c of FOREST_CHUNKS.spawn) expect(c.rows.join(''), c.name).not.toMatch(/[po#B]/);
  });

  /** The fixed props of a chunk, as (dx, dy, kind), mirrored as asked. */
  function fixed(c: Chunk, flipX: boolean, flipY: boolean): string[] {
    const w = FOREST.chunk.width;
    const h = FOREST.chunk.height;
    const out: string[] = [];
    c.rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        const cell = chunkCell(ch);
        if (cell.kind !== 'prop') return;
        const x = cell.prop === 'boulder' && flipX ? w - 2 - i : flipX ? w - 1 - i : i;
        out.push(`${x},${flipY ? h - 1 - j : j},${cell.prop}`);
      }),
    );
    return out;
  }

  it('builds every slot of the field from a chunk, mirrored or not', () => {
    const { width: w, height: h } = FOREST.chunk;
    for (let seed = 1; seed <= 100; seed++) {
      const map = gen(seed);
      for (let cy = 0; FOREST.treeLineRows + (cy + 1) * h <= MAP_ROWS; cy++) {
        for (let cx = 0; (cx + 1) * w <= MAP_COLS; cx++) {
          const x0 = cx * w;
          const y0 = FOREST.treeLineRows + cy * h;
          const anchorAt = (dx: number, dy: number): string | null => {
            const t = tileAt(map, x0 + dx, y0 + dy);
            return t?.prop && t.anchor ? t.prop : null;
          };
          // Some chunk, in some mirroring, has all its fixed props in this slot.
          const fits = all.some((c) =>
            [false, true].some((fx) =>
              [false, true].some((fy) =>
                fixed(c, fx, fy).every((f) => {
                  const [dx, dy, kind] = f.split(',');
                  return anchorAt(Number(dx), Number(dy)) === kind;
                }),
              ),
            ),
          );
          expect(fits, `seed ${map.seed} slot ${cx},${cy}`).toBe(true);
        }
      }
    }
  });

  it('keeps every boulder whole on 200 maps, mirrored or not', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = gen(seed);
      map.tiles.forEach((t, i) => {
        if (t.prop !== 'boulder' || !t.anchor) return;
        expect(tileAt(map, (i % map.cols) + 1, Math.floor(i / map.cols))).toEqual({
          prop: 'boulder',
          anchor: false,
        });
      });
      const anchors = map.tiles.filter((t) => t.prop === 'boulder' && t.anchor).length;
      expect(map.tiles.filter((t) => t.prop === 'boulder').length).toBe(anchors * 2);
    }
  });

  it('rejects a typo in a chunk picture', () => {
    expect(() => chunkCell('x')).toThrow(/unknown chunk character/);
  });
});

describe('town landscape (M4.3)', () => {
  const town = (seed: number): BattleMap => generateMap(seed, MAP_COLS, MAP_ROWS, 'town');
  const all = [...TOWN_CHUNKS.spawn, ...TOWN_CHUNKS.field];

  it('makes a valid town map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = town(seed);
      expect(map.landscape).toBe('town');
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  });

  it('has chunks of the right size whose houses fill exactly their 5 x 3 footprint', () => {
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      const cells = c.rows.map((row) => [...row]);
      const covered = new Set<string>();
      cells.forEach((row, j) => {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        row.forEach((ch, i) => {
          expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
          if (ch !== 'H') return;
          expect(c.upright, `${c.name} has a house, so it must stay upright`).toBe(true);
          for (let dy = 0; dy < PROPS.house.height; dy++) {
            for (let dx = 0; dx < PROPS.house.width; dx++) {
              expect(cells[j - dy]?.[i + dx], `${c.name} footprint`).toBe(dx || dy ? '=' : 'H');
              covered.add(`${i + dx},${j - dy}`);
            }
          }
        });
      });
      // Every '=' belongs to a house.
      cells.forEach((row, j) =>
        row.forEach((ch, i) => {
          if (ch === '=') expect(covered.has(`${i},${j}`), `${c.name} stray '='`).toBe(true);
        }),
      );
    }
  });

  it('keeps trees and houses out of the spawn chunks', () => {
    for (const c of TOWN_CHUNKS.spawn) expect(c.rows.join(''), c.name).not.toMatch(/[acH#]/);
  });

  it('keeps every house whole and upright on 300 maps', () => {
    let houses = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const map = town(seed);
      map.tiles.forEach((t, i) => {
        if (t.prop !== 'house' || !t.anchor) return;
        houses++;
        const x = i % map.cols;
        const y = Math.floor(i / map.cols);
        for (let dy = 0; dy < PROPS.house.height; dy++) {
          for (let dx = 0; dx < PROPS.house.width; dx++) {
            expect(tileAt(map, x + dx, y - dy)?.prop, `seed ${seed}`).toBe('house');
          }
        }
      });
      const anchors = map.tiles.filter((t) => t.prop === 'house' && t.anchor).length;
      const tiles = map.tiles.filter((t) => t.prop === 'house').length;
      expect(tiles).toBe(anchors * PROPS.house.width * PROPS.house.height);
    }
    expect(houses).toBeGreaterThan(100); // houses do show up
  });

  it('leaves forest maps exactly as they were', () => {
    const map = gen(1234);
    expect(map.landscape).toBeUndefined();
    expect(generateMap(1234, MAP_COLS, MAP_ROWS, 'forest')).toEqual(map);
  });

  it('only accepts known landscape names from the URL', () => {
    expect(landscapeId('town')).toBe('town');
    expect(landscapeId('forest')).toBe('forest');
    for (const bad of [null, '', 'moon', '__proto__', 'constructor', 'toString']) {
      expect(landscapeId(bad), String(bad)).toBeNull();
    }
  });
});

describe('alien ship landscape (M4.3)', () => {
  const ship = (seed: number): BattleMap => generateMap(seed, MAP_COLS, MAP_ROWS, 'ship');
  const all = [...SHIP_CHUNKS.spawn, ...SHIP_CHUNKS.field];

  // 1,000 maps: a few seconds on CI runners, like the other landscapes' tests.
  it('makes a valid ship map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = ship(seed);
      expect(map.landscape).toBe('ship');
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it('has chunks of the right size whose tanks fill exactly their 3 x 2 footprint', () => {
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      const cells = c.rows.map((row) => [...row]);
      const covered = new Set<string>();
      cells.forEach((row, j) => {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        row.forEach((ch, i) => {
          expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
          if (ch !== 'T') return;
          expect(c.upright, `${c.name} has a tank, so it must stay upright`).toBe(true);
          for (let dy = 0; dy < PROPS.tank.height; dy++) {
            for (let dx = 0; dx < PROPS.tank.width; dx++) {
              expect(cells[j - dy]?.[i + dx], `${c.name} footprint`).toBe(dx || dy ? '=' : 'T');
              covered.add(`${i + dx},${j - dy}`);
            }
          }
        });
      });
      cells.forEach((row, j) =>
        row.forEach((ch, i) => {
          if (ch === '=') expect(covered.has(`${i},${j}`), `${c.name} stray '='`).toBe(true);
        }),
      );
    }
  });

  it('keeps tanks and pillars out of the spawn chunks', () => {
    for (const c of SHIP_CHUNKS.spawn) expect(c.rows.join(''), c.name).not.toMatch(/[TP#]/);
  });

  it('lines the top with hull wall drawn on every tile of its bottom row', () => {
    const map = ship(7);
    const top = FOREST.treeLineRows;
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < map.cols; x++) {
        expect(tileAt(map, x, y)).toEqual({ prop: 'hull', anchor: y === top - 1 });
      }
    }
  });

  it('keeps every tank whole on 300 maps, and tanks do show up', () => {
    let tanks = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const map = ship(seed);
      const anchors = map.tiles.filter((t) => t.prop === 'tank' && t.anchor).length;
      const tiles = map.tiles.filter((t) => t.prop === 'tank').length;
      expect(tiles, `seed ${seed}`).toBe(anchors * PROPS.tank.width * PROPS.tank.height);
      tanks += anchors;
    }
    expect(tanks).toBeGreaterThan(300);
  });

  it('is a landscape name the URL accepts', () => {
    expect(landscapeId('ship')).toBe('ship');
  });
});

describe('crash site landscape (M4.3)', () => {
  const crash = (seed: number): BattleMap => generateMap(seed, MAP_COLS, MAP_ROWS, 'crash');
  const all = [...CRASH_CHUNKS.spawn, ...CRASH_CHUNKS.field];

  it('makes a valid crash site map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = crash(seed);
      expect(map.landscape).toBe('crash');
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it('has chunks of the right size whose wrecks fill exactly their 3 x 2 footprint', () => {
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      const cells = c.rows.map((row) => [...row]);
      const covered = new Set<string>();
      cells.forEach((row, j) => {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        row.forEach((ch, i) => {
          expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
          if (ch !== 'W') return;
          expect(c.upright, `${c.name} has a wreck, so it must stay upright`).toBe(true);
          for (let dy = 0; dy < PROPS.wreck.height; dy++) {
            for (let dx = 0; dx < PROPS.wreck.width; dx++) {
              expect(cells[j - dy]?.[i + dx], `${c.name} footprint`).toBe(dx || dy ? '=' : 'W');
              covered.add(`${i + dx},${j - dy}`);
            }
          }
        });
      });
      cells.forEach((row, j) =>
        row.forEach((ch, i) => {
          if (ch === '=') expect(covered.has(`${i},${j}`), `${c.name} stray '='`).toBe(true);
        }),
      );
    }
  });

  it('keeps wrecks and trees out of the spawn chunks', () => {
    for (const c of CRASH_CHUNKS.spawn) expect(c.rows.join(''), c.name).not.toMatch(/[Wpo#]/);
  });

  it('keeps every wreck whole on 300 maps; wrecks and scrap do show up', () => {
    let wrecks = 0;
    let scrap = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const map = crash(seed);
      map.tiles.forEach((t, i) => {
        if (t.prop === 'scrap') scrap++;
        if (t.prop !== 'wreck' || !t.anchor) return;
        wrecks++;
        const x = i % map.cols;
        const y = Math.floor(i / map.cols);
        for (let dy = 0; dy < PROPS.wreck.height; dy++) {
          for (let dx = 0; dx < PROPS.wreck.width; dx++) {
            expect(tileAt(map, x + dx, y - dy)?.prop, `seed ${seed}`).toBe('wreck');
          }
        }
      });
      const anchors = map.tiles.filter((t) => t.prop === 'wreck' && t.anchor).length;
      const tiles = map.tiles.filter((t) => t.prop === 'wreck').length;
      expect(tiles).toBe(anchors * PROPS.wreck.width * PROPS.wreck.height);
    }
    expect(wrecks).toBeGreaterThan(100);
    expect(scrap).toBeGreaterThan(300);
  });

  it('is a known landscape name in the URL', () => {
    expect(landscapeId('crash')).toBe('crash');
  });
});

describe('coast landscape (M4.3)', () => {
  const coast = (seed: number): BattleMap => generateMap(seed, MAP_COLS, MAP_ROWS, 'coast');
  const shore = COAST_CHUNKS.shore ?? [];
  const all = [...COAST_CHUNKS.spawn, ...shore, ...COAST_CHUNKS.field];

  it('makes a valid coast map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = coast(seed);
      expect(map.landscape).toBe('coast');
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it('has chunks of the right size, and boats two tiles wide', () => {
    expect(shore.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      for (const row of c.rows) {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        for (const ch of row) expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
        // Every boat 'R' has its rest '-' beside it, and every '-' follows an 'R' or 'B'.
        [...row].forEach((ch, i) => {
          if (ch === 'R') expect(row[i + 1], c.name).toBe('-');
          if (ch === '-') expect('RB', c.name).toContain(row[i - 1]);
        });
      }
    }
  });

  it('keeps boats and driftwood on the beach: only in its chunks', () => {
    for (const c of [...COAST_CHUNKS.spawn, ...COAST_CHUNKS.field]) {
      expect(c.rows.join(''), c.name).not.toMatch(/[Rd]/);
    }
    for (let seed = 1; seed <= 200; seed++) {
      const map = coast(seed);
      map.tiles.forEach((t, i) => {
        const y = Math.floor(i / map.cols);
        if (t.prop === 'boat' || t.prop === 'driftwood') {
          expect(y, `seed ${seed}`).toBeLessThan(FOREST.treeLineRows + FOREST.chunk.height);
        }
      });
    }
  });

  it('lines the top with sea, drawn on every tile of its bottom row', () => {
    const map = coast(7);
    const top = FOREST.treeLineRows;
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < map.cols; x++) {
        expect(tileAt(map, x, y)).toEqual({ prop: 'sea', anchor: y === top - 1 });
      }
    }
  });

  it('keeps dirt patches off the beach', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const d of coast(seed).decals) {
        expect(d.y, `seed ${seed}`).toBeGreaterThanOrEqual(FOREST.treeLineRows + 4);
      }
    }
  });

  it('leaves the other landscapes` maps exactly as they were', () => {
    // The shore chunks and decal rows are the coast's own: the forest's map 1234 is fixed.
    expect(generateMap(1234, MAP_COLS, MAP_ROWS, 'forest')).toEqual(gen(1234));
  });

  it('is a known landscape name in the URL', () => {
    expect(landscapeId('coast')).toBe('coast');
  });
});

describe('rocky hills landscape (M4.3)', () => {
  const hills = (seed: number): BattleMap => generateMap(seed, MAP_COLS, MAP_ROWS, 'hills');
  const all = [...HILLS_CHUNKS.spawn, ...HILLS_CHUNKS.field];

  it('makes a valid rocky hills map for 1,000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const map = hills(seed);
      expect(map.landscape).toBe('hills');
      expect(validateMap(map), `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it('has chunks of the right size, mines that fill their 3 x 2, and two-tile rocks', () => {
    for (const c of all) {
      expect(c.rows, c.name).toHaveLength(FOREST.chunk.height);
      const cells = c.rows.map((row) => [...row]);
      const covered = new Set<string>();
      cells.forEach((row, j) => {
        expect(row, c.name).toHaveLength(FOREST.chunk.width);
        row.forEach((ch, i) => {
          expect(() => chunkCell(ch), `${c.name}: '${ch}'`).not.toThrow();
          if (ch === 'C' || ch === 'S') expect(row[i + 1], c.name).toBe('-');
          if (ch !== 'M') return;
          expect(c.upright, `${c.name} has a mine, so it must stay upright`).toBe(true);
          for (let dy = 0; dy < PROPS.mine.height; dy++) {
            for (let dx = 0; dx < PROPS.mine.width; dx++) {
              expect(cells[j - dy]?.[i + dx], `${c.name} footprint`).toBe(dx || dy ? '=' : 'M');
              covered.add(`${i + dx},${j - dy}`);
            }
          }
        });
      });
      cells.forEach((row, j) =>
        row.forEach((ch, i) => {
          if (ch === '=') expect(covered.has(`${i},${j}`), `${c.name} stray '='`).toBe(true);
        }),
      );
    }
  });

  it('keeps mines, crags and pines out of the spawn chunks', () => {
    for (const c of HILLS_CHUNKS.spawn) expect(c.rows.join(''), c.name).not.toMatch(/[MCp#]/);
  });

  it('lines the top with cliff, drawn on every tile of its bottom row', () => {
    const map = hills(7);
    const top = FOREST.treeLineRows;
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < map.cols; x++) {
        expect(tileAt(map, x, y)).toEqual({ prop: 'cliff', anchor: y === top - 1 });
      }
    }
  });

  it('keeps every mine whole on 300 maps; mines and crags do show up', () => {
    let mines = 0;
    let crags = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const map = hills(seed);
      crags += map.tiles.filter((t) => t.prop === 'crag' && t.anchor).length;
      const anchors = map.tiles.filter((t) => t.prop === 'mine' && t.anchor).length;
      mines += anchors;
      const tiles = map.tiles.filter((t) => t.prop === 'mine').length;
      expect(tiles, `seed ${seed}`).toBe(anchors * PROPS.mine.width * PROPS.mine.height);
    }
    expect(mines).toBeGreaterThan(50);
    expect(crags).toBeGreaterThan(300);
  });

  it('is a known landscape name in the URL', () => {
    expect(landscapeId('hills')).toBe('hills');
  });
});
