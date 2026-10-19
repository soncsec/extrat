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
