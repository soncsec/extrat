import type Phaser from 'phaser';
import { FOREST_SHEET, HILLS_KEY } from './art';

/*
 * The rocky hills' art (M4.3): the Tiny RPG Mountain tileset (gravel, crags, slabs,
 * scree, cliffs and a mine entrance), with the forest's pines and bushes. Both sheets
 * go into one canvas texture, with two fixes made while loading:
 * - the mountain's props are painted on gravel, so that gravel colour is made clear
 *   (a crag drawn taller than its tiles would otherwise hide what's behind it);
 * - the forest's pine and bushes have a ring of grass drawn round them, which shows as
 *   a green halo on gravel, so copies are made with gravel colours instead.
 */

/** The mountain tileset sits below the forest sheet in the texture. */
export const HILLS_SOURCE = {
  key: 'hills-tiles',
  url: 'assets/hills/tiny-rpg-mountain-tileset.png',
  y: 176,
} as const;

export const HILLS_TEXTURE = { key: HILLS_KEY, width: 432, height: 304 } as const;

/** The mountain tileset's gravel: clear in its props' frames. */
export const GRAVEL = '#635c56';

/** Grass and grass-shadow colours in the forest art, and the gravel colours they become. */
export const GRAVEL_FOR_GRASS: Readonly<Record<string, string>> = {
  '#187454': GRAVEL, // grass -> gravel
  '#197e52': GRAVEL, // grass, lit -> gravel
  '#1a5f5a': '#423b35', // shadow on grass -> the tileset's shadow on gravel
  '#195e59': '#423b35',
};

const M = HILLS_SOURCE.y;

/** Frames in the hills texture: [x, y, width, height]. */
export const HILLS_FRAMES = {
  ...FOREST_SHEET.frames,
  // Ground, and decals laid on it.
  gravel: [48, M + 16, 16, 16],
  tuftA: [48, M + 96, 16, 16],
  tuftB: [64, M + 96, 16, 16],
  pebbles: [80, M + 96, 16, 16],
  patch: [64, M + 16, 32, 32],
  // The cliff along the top: one tile wide and two tall, side by side.
  cliffA: [288, M + 72, 16, 32],
  cliffB: [304, M + 72, 16, 32],
  // Props, with their gravel cleared.
  crag: [16, M + 16, 32, 32],
  slabs: [16, M + 48, 32, 16],
  scree: [32, M + 96, 16, 16],
  mine: [48, M + 48, 48, 48],
  // The forest's pine and bushes, recoloured for gravel, in the free corner.
  pineGravel: [368, M, 48, 48],
  bushGravelA: [368, M + 48, 16, 16],
  bushGravelB: [384, M + 48, 16, 16],
} as const;

type HillsFrame = keyof typeof HILLS_FRAMES;

/** Props whose gravel is made clear. */
const CLEARED: readonly HillsFrame[] = ['crag', 'slabs', 'scree', 'mine'];

/** Forest frames copied with gravel colours: [from, to]. */
const ON_GRAVEL: readonly [HillsFrame, HillsFrame][] = [
  ['pine', 'pineGravel'],
  ['bushA', 'bushGravelA'],
  ['bushB', 'bushGravelB'],
];

const hexOf = (d: Uint8ClampedArray, i: number): string =>
  `#${[d[i], d[i + 1], d[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;

/** Builds the hills texture from the loaded forest and mountain sheets (once). */
export function buildHillsTexture(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(HILLS_TEXTURE.key, HILLS_TEXTURE.width, HILLS_TEXTURE.height);
  if (!tex) throw new Error('could not create the hills texture');
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const image = (key: string): CanvasImageSource =>
    textures.get(key).getSourceImage() as CanvasImageSource;
  ctx.drawImage(image(FOREST_SHEET.key), 0, 0);
  ctx.drawImage(image(HILLS_SOURCE.key), 0, HILLS_SOURCE.y);
  for (const name of CLEARED) {
    const [x, y, w, h] = HILLS_FRAMES[name];
    const img = ctx.getImageData(x, y, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      if (hexOf(img.data, i) === GRAVEL) img.data[i + 3] = 0;
    }
    ctx.putImageData(img, x, y);
  }
  for (const [from, to] of ON_GRAVEL) {
    const [fx, fy, w, h] = HILLS_FRAMES[from];
    const [tx, ty] = HILLS_FRAMES[to];
    const img = ctx.getImageData(fx, fy, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const gravel = d[i + 3] === 0 ? undefined : GRAVEL_FOR_GRASS[hexOf(d, i)];
      if (!gravel) continue;
      d[i] = parseInt(gravel.slice(1, 3), 16);
      d[i + 1] = parseInt(gravel.slice(3, 5), 16);
      d[i + 2] = parseInt(gravel.slice(5, 7), 16);
    }
    ctx.putImageData(img, tx, ty);
  }
  tex.refresh();
}
