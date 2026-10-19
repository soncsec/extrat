import type Phaser from 'phaser';

/*
 * What grenades leave behind (M5.13): a tree blown down to its trunk, and a scorch
 * mark where cover was wrecked. Not in the pack, so drawn here, in the forest's bark
 * browns and the crash site's soot. Every landscape draws them from this texture.
 */

/** Colours by the letter used in the pictures below. */
export const BLAST_PALETTE: Readonly<Record<string, string>> = {
  k: '#1a120c', // outline
  L: '#b07d4b', // splintered wood, lit
  B: '#8a5a32', // bark, lit
  b: '#6b4426', // bark
  n: '#4a2e1a', // bark, shaded
  s: '#17130f', // soot
  c: '#2a2119', // charred ground
  e: '#43362a', // scorched earth
  o: '#e8742a', // ember
};

/** One picture per piece, one tile each; '.' is transparent. */
export const BLAST_PICTURES: Readonly<Record<'trunk' | 'scorch', readonly string[]>> = {
  trunk: [
    '................',
    '................',
    '................',
    '................',
    '.......k..k.....',
    '.....kkbkkBk....',
    '....knBbBkBk....',
    '...kBnbbbLBk....',
    '...knnbbbbBLk...',
    '...knnbbbbBnk...',
    '...knnbnbbBnk...',
    '..cknnbbnbBnk...',
    'ccsknnnbboBnkcc.',
    'cssknnnnnnnnkscc',
    '.csskkkkkkkkscc.',
    '...ccssssssc....',
  ],
  scorch: [
    '................',
    '................',
    '................',
    '......eeeeee....',
    '....eeeeeeeee...',
    '..eeccccccccee..',
    '.eeccsssssccce..',
    'eeccssssssscce..',
    'eccsssssssscce..',
    'eeccssssssscce..',
    '.eecccsssccee...',
    '..eeccccccee....',
    '....eeeeee......',
    '................',
    '................',
    '................',
  ],
};

export const BLAST_TEXTURE = { key: 'blast', width: 32, height: 16 } as const;

/** Frames in the blast texture: [x, y, width, height]. */
export const BLAST_FRAMES = {
  trunk: [0, 0, 16, 16],
  scorch: [16, 0, 16, 16],
} as const;

/** Builds the blast texture (call once, while loading). */
export function buildBlastTexture(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(BLAST_TEXTURE.key, BLAST_TEXTURE.width, BLAST_TEXTURE.height);
  if (!tex) throw new Error('could not create the blast texture');
  const ctx = tex.getContext();
  for (const [name, [x0, y0]] of Object.entries(BLAST_FRAMES)) {
    BLAST_PICTURES[name as keyof typeof BLAST_PICTURES].forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const color = BLAST_PALETTE[ch];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(x0 + i, y0 + j, 1, 1);
      });
    });
  }
  tex.refresh();
}
