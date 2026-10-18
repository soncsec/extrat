import { FOREST } from '../config/tuning';
import { chunkCell, FOREST_CHUNKS, type Chunk, type ChunkSet } from './chunks';
import { reachable, type Point } from './grid';
import { createRng, type Rng } from './rng';

/** Things that stand on a tile. */
export type PropKind = 'pine' | 'oak' | 'boulder' | 'rocks' | 'bush';
export type Cover = 'half' | 'full';

export interface PropInfo {
  /** Footprint in tiles, growing right from the anchor tile. */
  width: number;
  cover: Cover;
}

export const PROPS: Readonly<Record<PropKind, PropInfo>> = {
  pine: { width: 1, cover: 'full' },
  oak: { width: 1, cover: 'full' },
  boulder: { width: 2, cover: 'full' },
  rocks: { width: 1, cover: 'half' },
  bush: { width: 1, cover: 'half' },
};

export interface Tile {
  prop: PropKind | null;
  /** True on the tile where the prop's sprite is drawn (the left end of its footprint). */
  anchor: boolean;
}

/** A walkable dirt patch drawn on the ground; `kind` picks the art. */
export interface Decal extends Point {
  kind: 0 | 1;
}

export interface BattleMap {
  cols: number;
  rows: number;
  /** The seed that produced this map (may differ from the one asked for, see generateForest). */
  seed: number;
  /** Row-major: tile (x, y) is at y * cols + x. */
  tiles: Tile[];
  decals: Decal[];
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
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const s = (seed + attempt * 7919) >>> 0;
    const map = buildForest(s, cols, rows, opts);
    if (validateMap(map, opts).length === 0) return map;
  }
  throw new Error(`no valid forest map for seed ${seed}`);
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

function buildForest(seed: number, cols: number, rows: number, opts: ForestOptions): BattleMap {
  const rng = createRng(seed);
  const map: BattleMap = {
    cols,
    rows,
    seed,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  };
  const place = (x: number, y: number, kind: PropKind): boolean => {
    const width = PROPS[kind].width;
    for (let i = 0; i < width; i++) if (!isWalkable(map, x + i, y)) return false;
    for (let i = 0; i < width; i++) {
      map.tiles[y * cols + x + i] = { prop: kind, anchor: i === 0 };
    }
    return true;
  };
  const top = opts.treeLineRows;

  // Dense pines along the top edge. Every tile is blocked; only every other one is drawn,
  // since each pine is three tiles wide.
  for (let y = 0; y < top; y++) {
    for (let x = 0; x < cols; x++) {
      map.tiles[y * cols + x] = { prop: 'pine', anchor: (x + y) % 2 === 1 };
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
      const set: ChunkSet = FOREST_CHUNKS;
      const chunk = rng.pick(inSpawn ? set.spawn : set.field);
      stamp(chunk, x0, top + cy * h, rng, opts, place);
    }
  }

  scatter(opts.scatter.bushes, () => place(rng.int(0, cols - 1), rng.int(top, rows - 1), 'bush'));
  scatter(opts.scatter.rocks, () => place(rng.int(0, cols - 1), rng.int(top, rows - 1), 'rocks'));

  for (let i = 0; i < opts.dirtPatches; i++) {
    map.decals.push({
      x: rng.int(0, cols - 3),
      y: rng.int(top, rows - 3),
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
  place: (x: number, y: number, kind: PropKind) => boolean,
): void {
  const flipX = rng.next() < 0.5;
  const flipY = rng.next() < 0.5;
  const w = chunk.rows[0]?.length ?? 0;
  const h = chunk.rows.length;
  const mx = (i: number): number => x0 + (flipX ? w - 1 - i : i);
  const my = (j: number): number => y0 + (flipY ? h - 1 - j : j);
  chunk.rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const cell = chunkCell(ch);
      const y = my(j);
      if (cell.kind === 'prop') {
        // A boulder's anchor is its left tile, which mirroring moves to the other end.
        const x = cell.prop === 'boulder' && flipX ? mx(i + 1) : mx(i);
        place(x, y, cell.prop);
      } else if (cell.kind === 'maybeCover') {
        const r = rng.next();
        const { bush, rocks } = opts.maybeCover;
        if (r < bush) place(mx(i), y, 'bush');
        else if (r < bush + rocks) place(mx(i), y, 'rocks');
      } else if (cell.kind === 'maybeTree') {
        const r = rng.next();
        const { pine, oak } = opts.maybeTree;
        if (r < pine) place(mx(i), y, 'pine');
        else if (r < pine + oak) place(mx(i), y, 'oak');
      }
    });
  });
}

/** Calls `tryPlace` until it succeeds `count` times, with a cap on attempts. */
function scatter(count: number, tryPlace: () => boolean): void {
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) if (tryPlace()) placed++;
}
