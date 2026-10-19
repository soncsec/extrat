import type Phaser from 'phaser';
import { COAST_KEY, FOREST_SHEET } from './art';

/*
 * The coast's art (M4.3): the sea along the top, a beach below it, then the forest's
 * grass, trees and rocks. The pack's only sea is world-map scale, so the sea, sand,
 * driftwood and boats are drawn here, in the Tiny RPG overworld's sea and sand colours
 * and the forest's grass. Painted into one canvas texture with the forest sheet.
 */

/** Colours by the letter used in the pictures below. */
export const COAST_PALETTE: Readonly<Record<string, string>> = {
  D: '#1e445e', // sea, deep
  M: '#16698a', // sea
  H: '#62bed8', // wave crest
  F: '#e6f2ee', // surf
  W: '#a17c48', // wet sand
  S: '#cba957', // sand
  L: '#dcc283', // sand, lit
  s: '#8c6e3f', // sand in shadow
  g: '#187454', // grass (the forest's)
  G: '#197e52', // grass, lit
  h: '#24875c', // grass, bright
  k: '#2b231b', // outline
  n: '#4a3f33', // weathered wood, dark
  b: '#6b5d49', // weathered wood
  B: '#8a7a62', // weathered wood, lit
  P: '#a8987c', // bleached wood
  r: '#7a3b2a', // boat paint
  R: '#9c5236', // boat paint, lit
};

type CoastPicture = 'seaA' | 'seaB' | 'seaC' | 'sandA' | 'sandB' | 'shore' | 'driftwood' | 'boat';

/**
 * One picture per drawn piece; '.' is transparent. Sea pieces are one tile wide and two
 * tall (the top edge's two rows) and repeat side by side; 'shore' is where the beach
 * meets the grass; a boat lies on two tiles.
 */
export const COAST_PICTURES: Readonly<Record<CoastPicture, readonly string[]>> = {
  seaA: [
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDMMMMMMMDDDDD',
    'DDMMMDDDDDMMMDDD',
    'MMHDDDDDDDDDHMMM',
    'HHDDDDDDDDDDDHHH',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'MDDDDDDDDDDDDDDD',
    'MMMMDDDDDDDDDMMM',
    'DDDMMMDDDDDMMMDD',
    'DDDDDHMMMMMHDDDD',
    'DDDDDDHHHHHDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDMMMDDDDD',
    'DDDDDDMMDDDMMDDD',
    'DDDDDMDDDDDDDMDD',
    'DDDMMDDDDDDDDDMM',
    'MMMHHDDDDDDDDDHH',
    'HHHDDDDDDDMMMMMD',
    'MMDDDDDMMMMFFFMM',
    'MMMMMMMMMFFFFFFF',
    'FFFMMMFFFFWWWWWF',
    'WFFFFFFFWWWWWWWW',
    'WWWWFWWWWWWWWWWW',
    'WWWWWWWWWWSSSSSW',
    'SSWWWWWSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
  ],
  seaB: [
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'MMMMMMDDDDDDDDDM',
    'DDDDDMMMDDDDDMMM',
    'DDDDDDDHMMMMMHDD',
    'DDDDDDDDHHHHHDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDMDDDD',
    'DDDDDDDDMMMMMMMD',
    'MDDDDDMMMDDDDDMM',
    'HMMMMMHDDDDDDDDD',
    'DHHHHHDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDMMMDDDDDDDDDD',
    'DMMDDDMMDDDDDDDD',
    'MDDDDDDDMDDDDDDD',
    'DDDDDDDDDMMDDDMM',
    'DDDDDDDDDHHMMMHH',
    'DDDDDDDMMMMHHHDD',
    'DDDDMMMMFFFMMMMD',
    'MMMMMMFFFFFFFMMM',
    'MMMFFFFWWWWWFFFF',
    'FFFFFWWWWWWWWWFF',
    'WFWWWWWWWWWWWWWW',
    'WWWWWWWSSSSSWWWW',
    'WWWWSSSSSSSSSSSW',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
  ],
  seaC: [
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'MDDDDDDDDDMMMMMM',
    'MMMDDDDDMMMDDDDD',
    'DDHMMMMMHDDDDDDD',
    'DDDHHHHHDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDMDDDDDDDDD',
    'DDDMMMMMMMDDDDDD',
    'DMMMDDDDDMMMDDDD',
    'MHDDDDDDDDDHMMMM',
    'HDDDDDDDDDDDHHHH',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'MDDDDDDDDDDDDDMM',
    'DMMDDDDDDDDDMMDD',
    'DDDMDDDDDDDMDDDD',
    'DDDDMMDDDMMDDDDD',
    'DDDDHHMMMHHDDDDD',
    'DDDDMMHHHDDDDDDD',
    'DMMMMFFFMMMMDDDD',
    'MMMFFFFFFFMMMMMM',
    'FFFFWWWWWFFFFMMM',
    'FFWWWWWWWWWFFFFF',
    'WWWWWWWWWWWWWWFW',
    'WWWWSSSSSWWWWWWW',
    'WSSSSSSSSSSSWWWW',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
  ],
  sandA: [
    'SSSSSSSSSSLSSSSS',
    'SSSSSSSSSsSSSSSS',
    'LSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSLSSS',
    'SSSSSSsSSSSSSSSS',
    'SSSSSSSSSSSSSLSS',
    'LSSSSSSSSsSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSLSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSsSSsSSS',
    'SSSsSLSSSSLLSSSS',
    'SSSLSSSSSSSSSSSS',
    'SsSSSSSSSSSSSSSS',
    'sSSSSSSSSSsSSSSS',
  ],
  sandB: [
    'SSSSSSSSSSSSSSSS',
    'SSSSSLSSSSSSSsSS',
    'SSSSSSSSSSSSSLSS',
    'SSSSSSLSSSSSSSSS',
    'SSSSSSLSSSSSSSSS',
    'LSSSSSSSsSSSSSSS',
    'SSsSsLSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSsSSSSSSSSSSSSL',
    'SSSSSSSSSSSsSSSS',
    'SSSSSSSSSSSSSSSS',
    'SLSSSSSSSSSSSSSS',
    'SSSSSSsSSsSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'sSSSSSSsSSSSSSSS',
  ],
  shore: [
    'SSSSSSSSSSSSSSSS',
    'SSSSSsSSSSSSSSSS',
    'SSSSSSSsSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'sSSSSSSSSSSSSSSS',
    'SSSSSSSSSSSSSSSS',
    'SSSSSSSSSShGhSGS',
    'GSSSSSSShhggGhgh',
    'ghSSSSSGGgGgGggg',
    'hGShhShGghgGgGgG',
    'hGGgGhgghhgggggG',
    'GGGggggGGggGGGGG',
    'gghGgggGggggggGG',
    'gghGggGggggggggG',
    'GgGGGgGggGgGgGGg',
    'GGGGhggGhGGGgGGG',
  ],
  driftwood: [
    '................',
    '................',
    '................',
    '................',
    '...........k....',
    '..........kBk...',
    '.........kbk....',
    '..kkkkkkkbk.....',
    '.kbBBBBBkkkkkk..',
    '.kPbbnbbBBBBBbk.',
    '.kbnnnnnbnbbbPk.',
    '..kkkkkknnnnnbk.',
    '..sssssskkkkkks.',
    '..sssssssssssss.',
    '....sssssssss...',
    '................',
  ],
  boat: [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '.....kkkkkkkkkkk................',
    '..kkkRRRRRRRRRRRkkkk............',
    '.kRRRRbbbbPbbRRRRRRRkk..........',
    '.kRRbbbbbbPbbbbbbbRRRRkk........',
    '.kbbbnBBBBPBBBBnbbPbbRRRkk......',
    '.kBBBnBBBBPBBBBnBBPBbbbRRRk.....',
    '.kBBBnBBBBPBBBBnBBPBnBbbbRRk....',
    '.kBBBnBBBBPBBBBnBBPBnBBBbbRRkk..',
    '.kBBBnBBBBPBBBBnBBPBnBBBBnbbRRk.',
    '.kBBBnBBBBPBBBBnBBPBnBBBbbrrkk..',
    '.kBBBnBBBBPBBBBnBBPBnBbbbrrk....',
    '.kBBBnBBBBPBBBBnBBPBbbbrrrk.....',
    '.kbbbnBBBBPBBBBnbbPbbrrrkksss...',
    '.krrbbbbbbPbbbbbbbrrrrkksssssss.',
    '.krrrrbbbbPbbrrrrrrrkksssssssss.',
    '..kkkrrrrrrrrrrrkkkksssssssssss.',
    '....skkkkkkkkkkksssssssssssss...',
    '.......sssssssssssssssssss......',
    '................................',
  ],
};

/** Where each drawn piece goes in the coast texture, right of the forest sheet. */
const DRAWN_AT: Readonly<Record<CoastPicture, readonly [number, number]>> = {
  seaA: [432, 0],
  seaB: [448, 0],
  seaC: [464, 0],
  boat: [480, 0],
  sandA: [432, 32],
  sandB: [448, 32],
  shore: [464, 32],
  driftwood: [480, 32],
};

/**
 * The forest's rocks and boulder have a ring of grass and its shadow drawn around them,
 * which shows as a green halo on sand. The beach gets copies with those colours swapped
 * for sand's: [forest frame, where the copy goes, its frame name].
 */
const ON_SAND = [
  ['rocks', [496, 32], 'rocksSand'],
  ['boulder', [432, 48], 'boulderSand'],
] as const;

/** Grass and grass-shadow colours in the forest art, and the sand colours they become. */
export const SAND_FOR_GRASS: Readonly<Record<string, string>> = {
  '#197e52': '#cba957', // grass, lit -> sand
  '#187454': '#cba957', // grass -> sand
  '#195e59': '#8c6e3f', // shadow on grass -> shadow on sand
  '#1a5f5a': '#8c6e3f',
};

export const COAST_TEXTURE = { key: COAST_KEY, width: 512, height: 176 } as const;

/** Frames in the coast texture: [x, y, width, height]. The forest's keep their places. */
export const COAST_FRAMES = {
  ...FOREST_SHEET.frames,
  ...Object.fromEntries(
    Object.entries(DRAWN_AT).map(([name, [x, y]]) => {
      const rows = COAST_PICTURES[name as CoastPicture];
      return [name, [x, y, rows[0]?.length ?? 0, rows.length] as const];
    }),
  ),
  ...Object.fromEntries(
    ON_SAND.map(([from, [x, y], name]) => {
      const [, , w, h] = FOREST_SHEET.frames[from];
      return [name, [x, y, w, h] as const];
    }),
  ),
} as Readonly<Record<string, readonly [number, number, number, number]>>;

/** Builds the coast texture from the loaded forest sheet and the drawn pieces (once). */
export function buildCoastTexture(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(COAST_TEXTURE.key, COAST_TEXTURE.width, COAST_TEXTURE.height);
  if (!tex) throw new Error('could not create the coast texture');
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(textures.get(FOREST_SHEET.key).getSourceImage() as CanvasImageSource, 0, 0);
  for (const [name, [x, y]] of Object.entries(DRAWN_AT)) {
    COAST_PICTURES[name as CoastPicture].forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const color = COAST_PALETTE[ch];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(x + i, y + j, 1, 1);
      });
    });
  }
  for (const [from, [x, y]] of ON_SAND) {
    const [fx, fy, w, h] = FOREST_SHEET.frames[from];
    const img = ctx.getImageData(fx, fy, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const hex = `#${[d[i], d[i + 1], d[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
      const sand = SAND_FOR_GRASS[hex];
      if (!sand || d[i + 3] === 0) continue;
      d[i] = parseInt(sand.slice(1, 3), 16);
      d[i + 1] = parseInt(sand.slice(3, 5), 16);
      d[i + 2] = parseInt(sand.slice(5, 7), 16);
    }
    ctx.putImageData(img, x, y);
  }
  tex.refresh();
}
