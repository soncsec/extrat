import { FOREST_CHUNKS, TOWN_CHUNKS, type ChunkSet } from './chunks';
import type { PropKind } from './map';

/** The landscapes a mission can be fought in (more come with M4.3). */
export type LandscapeId = 'forest' | 'town';

/** What a landscape's maps are made of. The art for each prop is in the scenes. */
export interface Landscape {
  id: LandscapeId;
  name: string;
  /** The dense trees along the top edge. */
  edge: PropKind;
  chunks: ChunkSet;
  /** What a chunk's '#' becomes: the first, the second (by FOREST.maybeTree), or nothing. */
  maybeTree: readonly [PropKind, PropKind];
  /** What a chunk's '*' becomes: the first, the second (by FOREST.maybeCover), or nothing. */
  maybeCover: readonly [PropKind, PropKind];
  /** The light cover scattered on top of the chunks (FOREST.scatter counts). */
  scatter: readonly [PropKind, PropKind];
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
};

/** A landscape id from untrusted text (the URL), or null if it isn't one. */
export function landscapeId(text: string | null): LandscapeId | null {
  return text !== null && Object.hasOwn(LANDSCAPES, text) ? (text as LandscapeId) : null;
}
