import type { PropKind } from './map';

/**
 * Hand-made map pieces (ADR-E3). Each is a picture, one string per row:
 *
 *   .  open ground          p  pine        o  oak
 *   b  bush (half cover)    r  rocks (half cover)
 *   B  boulder: two tiles wide, with '-' on its right-hand tile
 *   *  maybe half cover: a bush, rocks or nothing, picked by the seed
 *   #  maybe a tree: a pine, an oak or nothing, picked by the seed
 *
 * All chunks of a landscape are the same size (CHUNK in tuning.ts). The generator may
 * mirror each one left to right and top to bottom.
 */
export interface Chunk {
  name: string;
  rows: readonly string[];
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
  | { kind: 'boulderRest' }
  | { kind: 'maybeCover' }
  | { kind: 'maybeTree' };

const LEGEND: Readonly<Record<string, ChunkCell>> = {
  '.': { kind: 'open' },
  p: { kind: 'prop', prop: 'pine' },
  o: { kind: 'prop', prop: 'oak' },
  b: { kind: 'prop', prop: 'bush' },
  r: { kind: 'prop', prop: 'rocks' },
  B: { kind: 'prop', prop: 'boulder' },
  '-': { kind: 'boulderRest' },
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
