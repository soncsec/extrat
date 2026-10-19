import { FOREST } from '../config/tuning';
import { chunkCell, type Chunk } from './chunks';
import { reachable, type Point } from './grid';
import { LANDSCAPES, type Landscape, type LandscapeId } from './landscapes';
import { createRng, type Rng } from './rng';

/** Things that stand on a tile. */
export type PropKind =
  | 'pine'
  | 'oak'
  | 'boulder'
  | 'rocks'
  | 'bush'
  | 'house'
  | 'autumn'
  | 'cypress'
  | 'stump'
  | 'shrub'
  | 'stone'
  | 'ledge'
  | 'hull'
  | 'tank'
  | 'pillar'
  | 'crate'
  | 'console'
  | 'wreck'
  | 'scrap'
  | 'trunk'
  | 'sea'
  | 'driftwood'
  | 'boat';
export type Cover = 'half' | 'full';

export interface PropInfo {
  /** Footprint in tiles: `width` right and `height` up from the anchor tile. */
  width: number;
  height: number;
  cover: Cover;
  /**
   * What a grenade does to it (M5.13, owner 2026-10-19): 'cleared' (small cover is
   * blown away), 'trunk' (a tree is blown down to its trunk) or 'stands' (too big).
   */
  blast: 'cleared' | 'trunk' | 'stands';
}

export const PROPS: Readonly<Record<PropKind, PropInfo>> = {
  pine: { width: 1, height: 1, cover: 'full', blast: 'trunk' },
  oak: { width: 1, height: 1, cover: 'full', blast: 'trunk' },
  boulder: { width: 2, height: 1, cover: 'full', blast: 'stands' },
  rocks: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  bush: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  // Town (M4.3). A house's walls fill its footprint; its roof is drawn above it.
  house: { width: 5, height: 3, cover: 'full', blast: 'stands' },
  autumn: { width: 1, height: 1, cover: 'full', blast: 'trunk' },
  cypress: { width: 1, height: 1, cover: 'full', blast: 'trunk' },
  stump: { width: 2, height: 1, cover: 'half', blast: 'stands' },
  shrub: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  stone: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  ledge: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  // Alien ship (M4.3). The hull wall lines the top; a specimen tank stands on 3 x 2.
  hull: { width: 1, height: 1, cover: 'full', blast: 'stands' },
  tank: { width: 3, height: 2, cover: 'full', blast: 'stands' },
  pillar: { width: 1, height: 1, cover: 'full', blast: 'stands' },
  crate: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  console: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  // Crash site (M4.3): a torn hull section on 3 x 2, and scrap strewn around it.
  wreck: { width: 3, height: 2, cover: 'full', blast: 'stands' },
  scrap: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  // What's left of a tree a grenade blew down: half cover, cleared by another blast.
  trunk: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  // Coast (M4.3): the sea along the top edge, driftwood and boats pulled up the beach.
  sea: { width: 1, height: 1, cover: 'full', blast: 'stands' },
  driftwood: { width: 1, height: 1, cover: 'half', blast: 'cleared' },
  boat: { width: 2, height: 1, cover: 'full', blast: 'stands' },
};

export interface Tile {
  prop: PropKind | null;
  /**
   * True on the tile where the prop's sprite is drawn: the bottom-left of its
   * footprint (the left end, for props one tile deep).
   */
  anchor: boolean;
}

/** A walkable dirt patch drawn on the ground; `kind` picks the art. */
export interface Decal extends Point {
  kind: 0 | 1;
}

export interface BattleMap {
  cols: number;
  rows: number;
  /** Which landscape's art and props (forest when missing). */
  landscape?: LandscapeId;
  /** The seed that produced this map (may differ from the one asked for, see generateForest). */
  seed: number;
  /** Row-major: tile (x, y) is at y * cols + x. */
  tiles: Tile[];
  decals: Decal[];
  /**
   * Tiles (y * cols + x) where a grenade wrecked cover (M5.13), in the order it
   * happened, each once: drawn scorched, and saved, since the map is rebuilt from its
   * seed. Missing until a blast changes something.
   */
  wrecked?: number[];
}

export interface ForestOptions {
  treeLineRows: number;
  spawnCols: number;
  chunk: { width: number; height: number };
  maybeCover: { bush: number; rocks: number };
  maybeTree: { pine: number; oak: number };
  scatter: { bushes: number; rocks: number };
  dirtPatches: number;
  minSpawnTiles: number;
  minSquadCover: number;
  minSpawnSteps: number;
  maxAttempts: number;
}

/**
 * The columns (inclusive) where one side deploys. The outermost column is left
 * out so character sprites aren't cut off by the screen edge.
 */
export function spawnZone(
  cols: number,
  side: 'west' | 'east',
  opts: ForestOptions = FOREST,
): [number, number] {
  return side === 'west' ? [1, opts.spawnCols] : [cols - 1 - opts.spawnCols, cols - 2];
}

export function tileAt(map: BattleMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return undefined;
  return map.tiles[y * map.cols + x];
}

/** Full cover (trees, boulders) blocks sight; half cover (rocks, bushes) doesn't. */
export function blocksSight(map: BattleMap, x: number, y: number): boolean {
  const prop = tileAt(map, x, y)?.prop;
  return prop != null && PROPS[prop].cover === 'full';
}

export function isWalkable(map: BattleMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t !== undefined && t.prop === null;
}

/**
 * A seeded forest map. If a seed gives a map that fails validation, the next
 * derived seed is tried, so the same input seed always gives the same map.
 */
export function generateForest(
  seed: number,
  cols: number,
  rows: number,
  opts: ForestOptions = FOREST,
): BattleMap {
  return generateMap(seed, cols, rows, 'forest', opts);
}

/** A seeded map of any landscape, checked like generateForest. */
export function generateMap(
  seed: number,
  cols: number,
  rows: number,
  landscape: LandscapeId,
  opts: ForestOptions = FOREST,
): BattleMap {
  const land = LANDSCAPES[landscape];
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const map = buildMap(s, cols, rows, land, opts);
    if (validateMap(map, opts).length === 0) return map;
  }
  throw new Error(`no valid ${land.name.toLowerCase()} map for seed ${seed}`);
}

/** Problems that make a map unplayable; an empty list means the map is fine. */
export function validateMap(map: BattleMap, opts: ForestOptions = FOREST): string[] {
  const problems: string[] = [];
  const free: Point[] = [];
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) if (isWalkable(map, x, y)) free.push({ x, y });
  }
  const first = free[0];
  if (!first) return ['no walkable tiles'];
  const reached = reachable(map.cols, map.rows, (x, y) => isWalkable(map, x, y), first);
  if (reached.size !== free.length) {
    problems.push(`${free.length - reached.size} walkable tiles are cut off`);
  }
  const inZone = (p: Point, [min, max]: [number, number]): boolean => p.x >= min && p.x <= max;
  const west = free.filter((p) => inZone(p, spawnZone(map.cols, 'west', opts))).length;
  const east = free.filter((p) => inZone(p, spawnZone(map.cols, 'east', opts))).length;
  if (west < opts.minSpawnTiles) problems.push(`west spawn zone has only ${west} free tiles`);
  if (east < opts.minSpawnTiles) problems.push(`east spawn zone has only ${east} free tiles`);

  // The squad deploys in the west facing east: it needs cover on the east side of
  // enough tiles to start behind something.
  const westZone = spawnZone(map.cols, 'west', opts);
  const covered = free.filter(
    (p) => inZone(p, westZone) && tileAt(map, p.x + 1, p.y)?.prop != null,
  ).length;
  if (covered < opts.minSquadCover) {
    problems.push(`only ${covered} squad spawn tiles have cover facing the enemy`);
  }

  // The sides must start a fair walk apart.
  const steps = stepsBetween(map, free, westZone, spawnZone(map.cols, 'east', opts));
  if (steps < opts.minSpawnSteps) problems.push(`spawn zones are only ${steps} steps apart`);
  return problems;
}

/**
 * The fewest steps on foot from a free tile in columns `from` to one in columns `to`
 * (Infinity if none connects).
 */
function stepsBetween(
  map: BattleMap,
  free: readonly Point[],
  from: [number, number],
  to: [number, number],
): number {
  // One search from all the starting tiles at once.
  const dist = new Map<number, number>();
  const queue: Point[] = [];
  for (const p of free) {
    if (p.x < from[0] || p.x > from[1]) continue;
    dist.set(p.y * map.cols + p.x, 0);
    queue.push(p);
  }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head] as Point;
    const d = dist.get(p.y * map.cols + p.x) as number;
    if (p.x >= to[0] && p.x <= to[1]) return d;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const q = { x: p.x + dx, y: p.y + dy };
      const key = q.y * map.cols + q.x;
      if (dist.has(key) || !isWalkable(map, q.x, q.y)) continue;
      dist.set(key, d + 1);
      queue.push(q);
    }
  }
  return Infinity;
}

function buildMap(
  seed: number,
  cols: number,
  rows: number,
  land: Landscape,
  opts: ForestOptions,
): BattleMap {
  const rng = createRng(seed);
  const map: BattleMap = {
    cols,
    rows,
    seed,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  };
  if (land.id !== 'forest') map.landscape = land.id;
  // (x, y) is the bottom-left of the footprint, which grows right and up.
  const place = (x: number, y: number, kind: PropKind): boolean => {
    const { width, height } = PROPS[kind];
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) if (!isWalkable(map, x + i, y - j)) return false;
    }
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        map.tiles[(y - j) * cols + x + i] = { prop: kind, anchor: i === 0 && j === 0 };
      }
    }
    return true;
  };
  const top = opts.treeLineRows;

  // Dense trees along the top edge. Every tile is blocked; only every other one is drawn,
  // since each tree is about three tiles wide. A wall (the ship's hull) is drawn on every
  // tile of the bottom row instead: each piece is one tile wide and covers the row above.
  for (let y = 0; y < top; y++) {
    for (let x = 0; x < cols; x++) {
      const anchor = land.edgeDrawn === 'wall' ? y === top - 1 : (x + y) % 2 === 1;
      map.tiles[y * cols + x] = { prop: land.edge, anchor };
    }
  }

  // The field below is a grid of chunks: light ones where the sides deploy, varied
  // ones between. Leftover columns or rows (on maps that don't divide evenly) stay open.
  const { width: w, height: h } = opts.chunk;
  const [, westEdge] = spawnZone(cols, 'west', opts);
  const [eastEdge] = spawnZone(cols, 'east', opts);
  for (let cy = 0; top + (cy + 1) * h <= rows; cy++) {
    for (let cx = 0; (cx + 1) * w <= cols; cx++) {
      const x0 = cx * w;
      const inSpawn = x0 <= westEdge || x0 + w - 1 >= eastEdge;
      // The top row of the field may have its own chunks (the coast's beach).
      const shore = cy === 0 ? land.chunks.shore : undefined;
      const chunk = rng.pick(inSpawn ? land.chunks.spawn : (shore ?? land.chunks.field));
      stamp(chunk, x0, top + cy * h, rng, opts, land, place);
    }
  }

  const [lightA, lightB] = land.scatter;
  scatter(opts.scatter.bushes, () => place(rng.int(0, cols - 1), rng.int(top, rows - 1), lightA));
  scatter(opts.scatter.rocks, () => place(rng.int(0, cols - 1), rng.int(top, rows - 1), lightB));

  for (let i = 0; i < opts.dirtPatches; i++) {
    map.decals.push({
      x: rng.int(0, cols - 3),
      y: rng.int(top + (land.bareRows ?? 0), rows - 3),
      kind: rng.pick([0, 1] as const),
    });
  }
  return map;
}

/**
 * Draws a chunk with its top-left at (x0, y0), mirrored at random, settling its
 * maybe-tiles with the seed.
 */
function stamp(
  chunk: Chunk,
  x0: number,
  y0: number,
  rng: Rng,
  opts: ForestOptions,
  land: Landscape,
  place: (x: number, y: number, kind: PropKind) => boolean,
): void {
  const flipX = rng.next() < 0.5;
  // Drawn either way, so every chunk uses the seed the same: a house's roof must stay up.
  const flipY = rng.next() < 0.5 && !chunk.upright;
  const w = chunk.rows[0]?.length ?? 0;
  const h = chunk.rows.length;
  const mx = (i: number): number => x0 + (flipX ? w - 1 - i : i);
  const my = (j: number): number => y0 + (flipY ? h - 1 - j : j);
  chunk.rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const cell = chunkCell(ch);
      const y = my(j);
      if (cell.kind === 'prop') {
        // A wide prop's anchor is its left tile, which mirroring moves to the other end.
        const x = flipX ? mx(i + PROPS[cell.prop].width - 1) : mx(i);
        place(x, y, cell.prop);
      } else if (cell.kind === 'maybeCover') {
        const r = rng.next();
        const { bush, rocks } = opts.maybeCover;
        const [a, b] = land.maybeCover;
        if (r < bush) place(mx(i), y, a);
        else if (r < bush + rocks) place(mx(i), y, b);
      } else if (cell.kind === 'maybeTree') {
        const r = rng.next();
        const { pine, oak } = opts.maybeTree;
        const [a, b] = land.maybeTree;
        if (r < pine) place(mx(i), y, a);
        else if (r < pine + oak) place(mx(i), y, b);
      }
    });
  });
}

/** Calls `tryPlace` until it succeeds `count` times, with a cap on attempts. */
function scatter(count: number, tryPlace: () => boolean): void {
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) if (tryPlace()) placed++;
}

/** A tile whose prop a blast changed: blown away (null) or down to a trunk. */
export interface Wreck extends Point {
  to: 'trunk' | null;
}

/**
 * What a blast does to the props within `radius` of `at` (M5.13): small cover is blown
 * away, trees are blown down to a trunk (half cover), a trunk is blown away. Props
 * bigger than a tile (houses, wrecks, tanks, boulders) and the edge rows stand.
 */
export function blastProps(
  map: BattleMap,
  at: Point,
  radius: number,
  opts: ForestOptions = FOREST,
): { map: BattleMap; wrecks: Wreck[] } {
  const wrecks: Wreck[] = [];
  const tiles = [...map.tiles];
  const wrecked = [...(map.wrecked ?? [])];
  const r = Math.ceil(radius);
  for (let y = Math.max(opts.treeLineRows, at.y - r); y <= Math.min(map.rows - 1, at.y + r); y++) {
    for (let x = Math.max(0, at.x - r); x <= Math.min(map.cols - 1, at.x + r); x++) {
      if (Math.hypot(x - at.x, y - at.y) > radius) continue;
      const i = y * map.cols + x;
      const to = blastOutcome(tiles[i]?.prop ?? null);
      if (to === undefined) continue;
      tiles[i] = to === null ? { prop: null, anchor: false } : { prop: to, anchor: true };
      if (!wrecked.includes(i)) wrecked.push(i);
      wrecks.push({ x, y, to });
    }
  }
  if (wrecks.length === 0) return { map, wrecks };
  return { map: { ...map, tiles, wrecked }, wrecks };
}

/** What a blast leaves of a prop: null (nothing), 'trunk', or undefined (unchanged). */
export function blastOutcome(prop: PropKind | null): 'trunk' | null | undefined {
  if (prop === null) return undefined;
  const info = PROPS[prop];
  if (info.width !== 1 || info.height !== 1 || info.blast === 'stands') return undefined;
  return info.blast === 'trunk' ? 'trunk' : null;
}
