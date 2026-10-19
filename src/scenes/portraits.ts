import type Phaser from 'phaser';
import { MARINE_NAMES } from '../logic/battle';

/*
 * Squad portraits (M6.2, owner 2026-10-19: the pack has none, so drawn in code). One
 * 24 x 24 head and shoulders in the marine sprite's own colours: the cream helmet, its
 * dark round visor, the orange suit. Each marine has their own colour on the helmet's
 * stripe and in the visor's glint, so they're told apart at a glance.
 */

/** Colours by letter; 'S' and 'G' are each marine's own (see PORTRAIT_COLOURS). */
export const PORTRAIT_PALETTE: Readonly<Record<string, string>> = {
  B: '#11141b', // background (the HUD's)
  k: '#160a1f', // outline
  H: '#dec4b3', // helmet, lit
  h: '#caa492', // helmet
  m: '#93675b', // helmet, shaded
  V: '#160a1f', // visor
  v: '#291b34', // visor, centre
  W: '#fff2f9', // visor shine
  O: '#e0802f', // suit
  o: '#c45b1e', // suit, shaded
  r: '#9b3813', // suit, dark
  d: '#460c1f', // collar
};

/** Each marine's stripe and visor glint. */
export const PORTRAIT_COLOURS: Readonly<
  Record<(typeof MARINE_NAMES)[number], { stripe: string; glint: string }>
> = {
  Vasquez: { stripe: '#d94a3a', glint: '#ff8a7a' },
  Okafor: { stripe: '#3a7ad9', glint: '#7ab4ff' },
  Lindqvist: { stripe: '#3aa85a', glint: '#7ae09a' },
  Moreau: { stripe: '#d9b23a', glint: '#ffe07a' },
  Tanaka: { stripe: '#8a4ad9', glint: '#c09aff' },
  Reyes: { stripe: '#2ab5c0', glint: '#7ae8ef' },
};

/** The portrait, one letter per pixel. */
export const PORTRAIT_PICTURE: readonly string[] = [
  'BBBBBBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBBBBBBBBBBBBBBBBB',
  'BBBBBBBBkkkkkkkkBBBBBBBB',
  'BBBBBBkkShhhhhhhkkBBBBBB',
  'BBBBBkhSSHHHhhhhhhkBBBBB',
  'BBBBkhhSSHHHhhhhhhhkBBBB',
  'BBBBkhHSSHHHhhhhhhhkBBBB',
  'BBBkhhHSSHHHVVVVVVhhkBBB',
  'BBBkmHHSSHHVWVVVVVVmkBBB',
  'BBBkmHHSSHHVVVGvVVVmkBBB',
  'BBBkmhhhhhVVVGGGvVVVkBBB',
  'BBBkmhhhhhVVVvGvvVVVkBBB',
  'BBBkmhhhhhhVVVvvVVVmkBBB',
  'BBBkmmhhhhhVVVVVVVVmkBBB',
  'BBBBkmhhhhhhVVVVVVmkBBBB',
  'BBBBkmmhhhhhhhhhhmmkBBBB',
  'BBBBBkmmmhhhhhhmmmkBBBBB',
  'BBBBBOOOmmmmmmmmOOOBBBBB',
  'BBBrOOOOOOOOOOOOOOOOrBBB',
  'BBrrooooOOOOOOOOoooorrBB',
  'BBrrooooOOOOOOOOoooorrBB',
  'BBrrooooOOOOOOOOoooorrBB',
  'BBrrooooOOOOOOOOoooorrBB',
  'BBrrooooOOOOOOOOoooorrBB',
];

export const PORTRAIT_SIZE = 24;
export const PORTRAIT_TEXTURE = {
  key: 'portraits',
  width: PORTRAIT_SIZE * MARINE_NAMES.length,
  height: PORTRAIT_SIZE,
} as const;

/** Builds the portraits texture: one frame per marine, named after them (once). */
export function buildPortraits(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(
    PORTRAIT_TEXTURE.key,
    PORTRAIT_TEXTURE.width,
    PORTRAIT_TEXTURE.height,
  );
  if (!tex) throw new Error('could not create the portraits texture');
  const ctx = tex.getContext();
  MARINE_NAMES.forEach((name, n) => {
    // Every marine has colours (a test checks); grey would show if one were missing.
    const own = PORTRAIT_COLOURS[name] ?? { stripe: '#7a7f8c', glint: '#dfe4ec' };
    const x0 = n * PORTRAIT_SIZE;
    PORTRAIT_PICTURE.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        ctx.fillStyle =
          ch === 'S' ? own.stripe : ch === 'G' ? own.glint : (PORTRAIT_PALETTE[ch] ?? '#000');
        ctx.fillRect(x0 + x, y, 1, 1);
      });
    });
    tex.add(name, 0, x0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  });
  tex.refresh();
}
