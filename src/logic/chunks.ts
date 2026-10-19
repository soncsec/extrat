import type { PropKind } from './map';

/**
 * Hand-made map pieces (ADR-E3). Each is a picture, one string per row:
 *
 *   .  open ground          p  pine        o  oak
 *   b  bush (half cover)    r  rocks (half cover)
 *   B  boulder: two tiles wide, with '-' on its right-hand tile
 *   *  maybe half cover (forest: a bush or rocks; town: a shrub or a stone) or nothing
 *   #  maybe a tree (forest: a pine or an oak; town: an autumn tree or a cypress) or nothing
 *
 * Town (M4.3):
 *   H  house: its bottom-left tile, with '=' on the rest of its 5 x 3 footprint
 *   a  autumn tree    c  cypress    s  shrub (half)    n  stone (half)
 *   l  low earth wall (half)        t  stump: two tiles wide, 't-' (half)
 *
 * Alien ship (M4.3):
 *   T  specimen tank: its bottom-left tile, with '=' on the rest of its 3 x 2 footprint
 *   P  bulkhead pillar    k  crate (half)    v  console (half)
 *   *  a crate or a console    #  maybe a pillar
 *
 * Crash site (M4.3), with the forest's trees and rocks:
 *   W  wreck: its bottom-left tile, with '=' on the rest of its 3 x 2 footprint
 *   j  scrap, junk from the wreck (half)    *  scrap or rocks    #  maybe a tree
 *
 * Coast (M4.3), with the forest's trees, rocks and bushes:
 *   d  driftwood (half)    R  rowboat: two tiles wide, 'R-' (full)
 *   Driftwood and boats only in the beach (shore) chunks, so they stay on the sand.
 *
 * Rocky hills (M4.3), with the forest's pines:
 *   C  crag: two tiles wide, 'C-' (full)     S  slab pile: two tiles wide, 'S-' (half)
 *   q  scree (half)    M  mine entrance: its bottom-left tile, '=' on the rest of 3 x 2
 *   *  scree or a bush    #  maybe a pine
 *
 * All chunks of a landscape are the same size (CHUNK in tuning.ts). The generator may
 * mirror each one left to right, and top to bottom unless it's `upright` (a house).
 */
export interface Chunk {
  name: string;
  rows: readonly string[];
  /** Never mirrored top to bottom: a house's roof stays above its walls. */
  upright?: boolean;
}

/** The chunks a landscape is built from. */
export interface ChunkSet {
  /** Light cover, for the columns where the two sides deploy. */
  spawn: readonly Chunk[];
  /** Everything else: the ground the fight crosses. */
  field: readonly Chunk[];
  /** Field chunks for the top row instead, where it differs (the coast's beach). */
  shore?: readonly Chunk[];
}

/** What a picture character means. Random ones are settled by the generator. */
export type ChunkCell =
  | { kind: 'open' }
  | { kind: 'prop'; prop: PropKind }
  | { kind: 'rest' }
  | { kind: 'maybeCover' }
  | { kind: 'maybeTree' };

const LEGEND: Readonly<Record<string, ChunkCell>> = {
  '.': { kind: 'open' },
  p: { kind: 'prop', prop: 'pine' },
  o: { kind: 'prop', prop: 'oak' },
  b: { kind: 'prop', prop: 'bush' },
  r: { kind: 'prop', prop: 'rocks' },
  B: { kind: 'prop', prop: 'boulder' },
  '-': { kind: 'rest' },
  H: { kind: 'prop', prop: 'house' },
  '=': { kind: 'rest' },
  a: { kind: 'prop', prop: 'autumn' },
  c: { kind: 'prop', prop: 'cypress' },
  s: { kind: 'prop', prop: 'shrub' },
  n: { kind: 'prop', prop: 'stone' },
  l: { kind: 'prop', prop: 'ledge' },
  t: { kind: 'prop', prop: 'stump' },
  T: { kind: 'prop', prop: 'tank' },
  P: { kind: 'prop', prop: 'pillar' },
  k: { kind: 'prop', prop: 'crate' },
  v: { kind: 'prop', prop: 'console' },
  W: { kind: 'prop', prop: 'wreck' },
  j: { kind: 'prop', prop: 'scrap' },
  d: { kind: 'prop', prop: 'driftwood' },
  R: { kind: 'prop', prop: 'boat' },
  C: { kind: 'prop', prop: 'crag' },
  S: { kind: 'prop', prop: 'slabs' },
  q: { kind: 'prop', prop: 'scree' },
  M: { kind: 'prop', prop: 'mine' },
  '*': { kind: 'maybeCover' },
  '#': { kind: 'maybeTree' },
};

/** The meaning of one picture character; throws on a typo so a bad chunk fails fast. */
export function chunkCell(ch: string): ChunkCell {
  const cell = LEGEND[ch];
  if (!cell) throw new Error(`unknown chunk character '${ch}'`);
  return cell;
}

export const FOREST_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'open ground', rows: ['......', '.b....', '....*.', '......'] },
    { name: 'scattered rocks', rows: ['..r...', '......', '.b..*.', '......'] },
    { name: 'bush row', rows: ['......', '..*b..', '......', '.r....'] },
    { name: 'quiet corner', rows: ['....*.', '......', '.*....', '...b..'] },
  ],
  field: [
    { name: 'tree clump', rows: ['.pp...', '.opp..', '..#.b.', '......'] },
    { name: 'clearing', rows: ['..b...', '......', '...*..', '.*....'] },
    { name: 'boulder field', rows: ['.B-...', '......', '....r.', '*..B-.'] },
    { name: 'tree line', rows: ['pp....', '.op.b.', '..#p..', '...o..'] },
    { name: 'copse', rows: ['..bb..', '.pop..', '.p#o..', '..*...'] },
    { name: 'rocky glade', rows: ['r...*.', '..o...', '......', '.r..b.'] },
    { name: 'thicket', rows: ['.o..#.', 'p#..pp', '......', '.b..*.'] },
    { name: 'lone oak', rows: ['......', '..o*..', '.*....', '....r.'] },
    { name: 'twin stands', rows: ['p...#.', 'o...pp', '.*....', '...b..'] },
  ],
};

/**
 * Town: houses (full cover, and they block sight like a wall), garden walls, shrubs,
 * stumps and autumn trees. Spawn chunks stay light, as in the forest.
 */
export const TOWN_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'village green', rows: ['......', '.s....', '....*.', '......'] },
    { name: 'garden wall', rows: ['......', '.ll...', '....*.', '.s....'] },
    { name: 'stump and shrubs', rows: ['..t-..', '......', '.*..s.', '......'] },
    { name: 'stones', rows: ['....n.', '......', '.*....', '...s..'] },
  ],
  field: [
    { name: 'cottage', rows: ['=====.', '=====.', 'H====.', '.s..l.'], upright: true },
    { name: 'cottage by the trees', rows: ['.=====', '.=====', '.H====', 'a..*..'], upright: true },
    { name: 'walled garden', rows: ['llll..', '...*..', '.s..#.', '..lll.'] },
    { name: 'orchard', rows: ['a..a..', '..*...', '.a..c.', '....s.'] },
    { name: 'square', rows: ['..n...', '......', '..t-..', '.*..s.'] },
    { name: 'hedges', rows: ['.ss...', '...*..', '..#.ss', '......'] },
    { name: 'cypress row', rows: ['c.c.c.', '......', '.*..l.', '..s...'] },
  ],
};

/**
 * Alien ship: specimen tanks (full cover, and they block sight), bulkhead pillars,
 * crates and consoles. A tank's glass rises far above its footprint, like a house's
 * roof, so tank chunks stay upright. Spawn chunks stay light, as in the forest.
 */
export const SHIP_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'airlock', rows: ['......', '.k....', '....*.', '......'] },
    { name: 'cargo', rows: ['..kk..', '......', '.*..v.', '......'] },
    { name: 'terminals', rows: ['....v.', '......', '.*....', '...k..'] },
    { name: 'deck', rows: ['......', '.v....', '....*.', '.k....'] },
  ],
  field: [
    { name: 'specimen tank', rows: ['===...', 'T==.*.', '......', '.k..#.'], upright: true },
    { name: 'twin tanks', rows: ['===...', 'T==...', '...===', '.*.T=='], upright: true },
    { name: 'pillar hall', rows: ['P...P.', '......', '.*..*.', 'P...P.'] },
    { name: 'cargo bay', rows: ['kk..#.', 'k.....', '...*..', '.v..kk'] },
    { name: 'control room', rows: ['.vvv..', '......', '..#...', '.k..v.'] },
    { name: 'bulkheads', rows: ['PP....', '......', '...#P.', '.*....'] },
    { name: 'machinery', rows: ['..#...', '.k..P.', '...*..', '#.....'] },
  ],
};

/**
 * Crash site: a forest clearing strewn with the alien ship's wreckage. A wreck is full
 * cover and blocks sight; scrap is half cover. A wreck rises above its footprint, so
 * wreck chunks stay upright. Spawn chunks stay light, as in the forest.
 */
export const CRASH_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'scorched ground', rows: ['......', '.j....', '....*.', '......'] },
    { name: 'scattered scrap', rows: ['..r...', '......', '.j..*.', '......'] },
    { name: 'burnt bushes', rows: ['......', '..*b..', '......', '.j....'] },
    { name: 'quiet edge', rows: ['....*.', '......', '.*....', '...r..'] },
  ],
  field: [
    { name: 'hull section', rows: ['===...', 'W==.*.', '......', '.j..#.'], upright: true },
    { name: 'wreck in the trees', rows: ['p.....', 'o.===.', '..W==.', '.*....'], upright: true },
    { name: 'two wrecks', rows: ['===...', 'W==...', '...===', '.*.W=='], upright: true },
    { name: 'debris field', rows: ['j...*.', '..j...', '.*..j.', '......'] },
    { name: 'broken trees', rows: ['pp....', '.o..j.', '..#...', '.j..p.'] },
    { name: 'impact', rows: ['......', '.j..j.', '......', '..*.#.'] },
    { name: 'copse', rows: ['..bb..', '.pop..', '.p#o..', '..*...'] },
    { name: 'rocky glade', rows: ['r...*.', '..o...', '......', '.r..j.'] },
  ],
};

/**
 * Coast: a beach below the sea, then woods. The top row of chunks is the beach, with
 * boats pulled up the sand and driftwood; below it, the forest's trees and rocks.
 * Spawn chunks stay light, as in the forest.
 */
export const COAST_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'dunes', rows: ['......', '.b....', '....*.', '......'] },
    { name: 'stones', rows: ['..r...', '......', '.b..*.', '......'] },
    { name: 'scrub', rows: ['......', '..*b..', '......', '.r....'] },
    { name: 'quiet stretch', rows: ['....*.', '......', '.*....', '...b..'] },
  ],
  shore: [
    { name: 'boats', rows: ['......', '.R-...', '...*..', '..R-..'] },
    { name: 'flotsam', rows: ['.d....', '...*..', '.d..r.', '......'] },
    { name: 'beached boat', rows: ['..R-..', '......', '.*..d.', '......'] },
    { name: 'rocky beach', rows: ['r...*.', '..B-..', '......', '.d..r.'] },
    { name: 'open sand', rows: ['......', '..d...', '......', '...*..'] },
  ],
  field: [
    { name: 'tree clump', rows: ['.pp...', '.opp..', '..#.b.', '......'] },
    { name: 'clearing', rows: ['..b...', '......', '...*..', '.*....'] },
    { name: 'boulders', rows: ['.B-...', '......', '....r.', '*..B-.'] },
    { name: 'copse', rows: ['..bb..', '.pop..', '.p#o..', '..*...'] },
    { name: 'rocky glade', rows: ['r...*.', '..o...', '......', '.r..b.'] },
    { name: 'lone oak', rows: ['......', '..o*..', '.*....', '....r.'] },
    { name: 'pines', rows: ['p...#.', 'o...pp', '.*....', '...b..'] },
  ],
};

/**
 * Rocky hills: a cliff along the top, crags, slab piles, scree, a few pines, and now
 * and then an old mine entrance (full cover that blocks sight; its chunks stay
 * upright). Spawn chunks stay light, as in the forest.
 */
export const HILLS_CHUNKS: ChunkSet = {
  spawn: [
    { name: 'scree slope', rows: ['......', '.q....', '....*.', '......'] },
    { name: 'slabs', rows: ['..S-..', '......', '.*..q.', '......'] },
    { name: 'stony ground', rows: ['....q.', '......', '.*....', '...q..'] },
    { name: 'open ground', rows: ['......', '..*...', '......', '.q..*.'] },
  ],
  field: [
    { name: 'crags', rows: ['.C-...', '......', '...*..', '*..C-.'] },
    { name: 'old mine', rows: ['===...', 'M==.*.', '......', '.q..#.'], upright: true },
    { name: 'slab field', rows: ['S-..q.', '......', '..S-..', '.*....'] },
    { name: 'pines on the slope', rows: ['.p..#.', '..q...', '.#..p.', '...*..'] },
    { name: 'boulder run', rows: ['C-....', '...*..', '..C-..', '....q.'] },
    { name: 'gully', rows: ['q..q..', '.C-...', '....*.', '..S-..'] },
    { name: 'lone pine', rows: ['......', '..p*..', '.*....', '....q.'] },
  ],
};
