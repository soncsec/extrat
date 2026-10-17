import type Phaser from 'phaser';
import type { PropKind } from '../logic/map';

/** Where each piece of art sits in its sheet. Pixel rectangles measured from the files. */
export const FOREST_SHEET = {
  key: 'forest',
  url: 'assets/forest/top-down-forest-tileset.png',
  frames: {
    grass: [128, 32, 16, 16],
    bushA: [128, 64, 16, 16],
    bushB: [128, 128, 16, 16],
    rocks: [128, 96, 16, 16],
    oak: [160, 48, 48, 48],
    pine: [160, 112, 48, 48],
    boulder: [224, 64, 32, 32],
    dirt0: [64, 32, 48, 48],
    dirt1: [64, 96, 48, 64],
  },
} as const;

export type ForestFrame = keyof typeof FOREST_SHEET.frames;

/** The frame drawn for a prop. Bushes alternate between two pictures by position. */
export function propFrame(kind: PropKind, x: number, y: number): ForestFrame {
  if (kind === 'bush') return (x * 31 + y * 17) % 2 === 0 ? 'bushA' : 'bushB';
  return kind;
}

/** Adds the named frames to a loaded sheet's texture. */
export function addFrames(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frames: Readonly<Record<string, readonly [number, number, number, number]>>,
): void {
  const tex = textures.get(key);
  for (const [name, [x, y, w, h]] of Object.entries(frames)) tex.add(name, 0, x, y, w, h);
}
