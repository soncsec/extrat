/** All gameplay numbers live here so they can be tuned in one place. */

/** Size of one map tile in art pixels. */
export const TILE = 16;

/** The battle map, in tiles. */
export const MAP_COLS = 24;
export const MAP_ROWS = 14;

/** Height of the info bar under the map, in art pixels. */
export const HUD_HEIGHT = 32;

export const GAME_WIDTH = MAP_COLS * TILE;
export const GAME_HEIGHT = MAP_ROWS * TILE + HUD_HEIGHT;

/** Seed for the random number generator; override with ?seed= in the URL. */
export const DEFAULT_SEED = 1;

/** The forest map generator (M1; replaced by the chunk-based generator in M4). */
export const FOREST = {
  /** Rows of dense pine forest along the top edge. */
  treeLineRows: 2,
  /** Columns at each side kept as spawn zones: no tree clusters there. */
  spawnCols: 4,
  clusters: { min: 3, max: 4 },
  clusterSize: { min: 3, max: 5 },
  boulders: 2,
  bushes: 7,
  rocks: 5,
  dirtPatches: 3,
  /** Each spawn zone needs at least this many free tiles. */
  minSpawnTiles: 12,
  /** Seeds tried before giving up on a valid map. */
  maxAttempts: 50,
} as const;

/** Squad and enemy sizes for the M1 skirmish. */
export const SKIRMISH = {
  marines: 4,
  aliens: 2,
  /** Units on the same side start at least this many steps apart. */
  minSpacing: 3,
} as const;

/** Unit stats. */
export const UNITS = {
  /** move: tiles per move action. */
  marine: { hp: 4, move: 5 },
  walker: { hp: 3, move: 4 },
} as const;

/** Action points each unit gets at the start of its side's turn. A move costs 1. */
export const ACTION_POINTS = 2;

/** Presentation speeds. */
export const ANIMATION = {
  /** Tiles per second when a unit runs along a path. */
  runSpeed: 6,
} as const;
