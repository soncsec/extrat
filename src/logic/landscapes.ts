import {
  COAST_CHUNKS,
  CRASH_CHUNKS,
  FOREST_CHUNKS,
  HILLS_CHUNKS,
  SHIP_CHUNKS,
  TOWN_CHUNKS,
  type ChunkSet,
} from './chunks';
import type { PropKind } from './map';

/** The landscapes a mission can be fought in (M4.3). */
export type LandscapeId = 'forest' | 'town' | 'coast' | 'hills' | 'crash' | 'ship';

/** What a landscape's maps are made of. The art for each prop is in the scenes. */
export interface Landscape {
  id: LandscapeId;
  name: string;
  /** The dense trees along the top edge. */
  edge: PropKind;
  /** How the edge is drawn: wide trees on every other tile (default), or a wall on every tile. */
  edgeDrawn?: 'trees' | 'wall';
  chunks: ChunkSet;
  /** What a chunk's '#' becomes: the first, the second (by FOREST.maybeTree), or nothing. */
  maybeTree: readonly [PropKind, PropKind];
  /** What a chunk's '*' becomes: the first, the second (by FOREST.maybeCover), or nothing. */
  maybeCover: readonly [PropKind, PropKind];
  /** The light cover scattered on top of the chunks (FOREST.scatter counts). */
  scatter: readonly [PropKind, PropKind];
  /**
   * Rows below the edge kept free of decals (the coast's beach: its dirt patches have
   * grass drawn round them). Missing: decals may go anywhere below the edge.
   */
  bareRows?: number;
}

export const LANDSCAPES: Readonly<Record<LandscapeId, Landscape>> = {
  forest: {
    id: 'forest',
    name: 'Forest',
    edge: 'pine',
    chunks: FOREST_CHUNKS,
    maybeTree: ['pine', 'oak'],
    maybeCover: ['bush', 'rocks'],
    scatter: ['bush', 'rocks'],
  },
  town: {
    id: 'town',
    name: 'Town',
    edge: 'autumn',
    chunks: TOWN_CHUNKS,
    maybeTree: ['autumn', 'cypress'],
    maybeCover: ['shrub', 'stone'],
    scatter: ['shrub', 'stone'],
  },
  coast: {
    id: 'coast',
    name: 'Coast',
    edge: 'sea',
    edgeDrawn: 'wall',
    chunks: COAST_CHUNKS,
    maybeTree: ['pine', 'oak'],
    maybeCover: ['bush', 'rocks'],
    scatter: ['bush', 'rocks'],
    // The beach (three rows) and the row where it meets the grass.
    bareRows: 4,
  },
  hills: {
    id: 'hills',
    name: 'Rocky hills',
    edge: 'cliff',
    edgeDrawn: 'wall',
    chunks: HILLS_CHUNKS,
    // Mostly bare rock: a pine where the forest would have either tree.
    maybeTree: ['pine', 'pine'],
    maybeCover: ['scree', 'bush'],
    scatter: ['scree', 'scree'],
  },
  crash: {
    id: 'crash',
    name: 'Crash site',
    edge: 'pine',
    chunks: CRASH_CHUNKS,
    maybeTree: ['pine', 'oak'],
    // Rocks first: a little less scrap than the forest has bushes, so the field isn't cluttered.
    maybeCover: ['rocks', 'scrap'],
    scatter: ['rocks', 'scrap'],
  },
  ship: {
    id: 'ship',
    name: 'Alien ship',
    edge: 'hull',
    edgeDrawn: 'wall',
    chunks: SHIP_CHUNKS,
    maybeTree: ['pillar', 'pillar'],
    maybeCover: ['crate', 'console'],
    scatter: ['crate', 'console'],
  },
};

/** A landscape id from untrusted text (the URL), or null if it isn't one. */
export function landscapeId(text: string | null): LandscapeId | null {
  return text !== null && Object.hasOwn(LANDSCAPES, text) ? (text as LandscapeId) : null;
}
