import Phaser from 'phaser';
import { GLYPH_CHARS, GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS, toFontText } from './glyphs';

/**
 * Extrat's pixel font (see glyphs.ts), drawn into a texture at startup and used as a
 * Phaser RetroFont. Each glyph sits on whole game pixels, so it scales up sharp,
 * unlike small browser fonts drawn into the low-resolution canvas.
 */
export const PIXEL_FONT = 'pixel-font';
/** A glyph plus one pixel of spacing to the right and below. */
export const CELL_W = GLYPH_WIDTH + 1;
export const CELL_H = GLYPH_HEIGHT + 1;
const PER_ROW = 16;

/** Draws the glyphs into a texture and registers the font, once. */
export function buildPixelFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(PIXEL_FONT)) return;
  const chars = GLYPH_CHARS;
  const rows = Math.ceil(chars.length / PER_ROW);
  const tex = scene.textures.createCanvas(PIXEL_FONT, PER_ROW * CELL_W, rows * CELL_H);
  if (!tex) throw new Error('could not create the pixel font texture');
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  [...chars].forEach((ch, i) => {
    const ox = (i % PER_ROW) * CELL_W;
    const oy = Math.floor(i / PER_ROW) * CELL_H;
    (GLYPHS[ch] ?? []).forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (c === '1') ctx.fillRect(ox + x, oy + y, 1, 1);
      });
    });
  });
  tex.refresh();
  // Phaser 4's Parse returns the whole cache entry ({ data, frame, texture }), although
  // its TypeScript types say it returns only the font data.
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: PIXEL_FONT,
    width: CELL_W,
    height: CELL_H,
    chars,
    charsPerRow: PER_ROW,
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 3,
  }) as unknown as { data: Phaser.Types.GameObjects.BitmapText.BitmapFontData };
  scene.cache.bitmapFont.add(PIXEL_FONT, entry);
}

/**
 * Centred pixel text at a whole-number `scale`, in `color`, with a one-pixel dark
 * shadow (at that scale) so it reads on any background.
 */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: number,
  scale = 1,
  shadow = true,
): Phaser.GameObjects.Container {
  const make = (dx: number, dy: number, tint: number): Phaser.GameObjects.BitmapText =>
    scene.add
      .bitmapText(dx, dy, PIXEL_FONT, toFontText(text))
      .setScale(scale)
      .setCenterAlign()
      .setOrigin(0.5)
      .setTint(tint);
  const parts = shadow ? [make(scale, scale, 0x05070f), make(0, 0, color)] : [make(0, 0, color)];
  return scene.add.container(Math.round(x), Math.round(y), parts);
}

/** A clickable pixel-font button with a hover colour. */
export function pixelButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  primary = true,
): Phaser.GameObjects.Rectangle {
  const colors = primary
    ? { fg: 0x11141b, bg: 0xf2a33a, hover: 0xffc266 }
    : { fg: 0xdfe4ec, bg: 0x2b3242, hover: 0x3d4760 };
  const w = label.length * CELL_W + 11;
  const h = CELL_H + 7;
  const box = scene.add
    .rectangle(Math.round(x), Math.round(y), w, h, colors.bg)
    .setInteractive({ useHandCursor: true });
  box.on('pointerover', () => box.setFillStyle(colors.hover));
  box.on('pointerout', () => box.setFillStyle(colors.bg));
  box.on('pointerdown', onClick);
  pixelText(scene, x, y + 1, label, colors.fg, 1, false);
  return box;
}
