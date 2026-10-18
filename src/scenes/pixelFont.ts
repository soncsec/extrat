import Phaser from 'phaser';
import { GLYPH_CHARS, GLYPH_HEIGHT, GLYPH_WIDTH, GLYPHS, toFontText } from './glyphs';

/**
 * Extrat's pixel font (see glyphs.ts), drawn into a texture at startup and used as a
 * Phaser RetroFont. Each glyph sits on whole game pixels, so it scales up sharp,
 * unlike small browser fonts drawn into the low-resolution canvas. All game text uses it.
 */
export const PIXEL_FONT = 'pixel-font';
/** A glyph plus one pixel of spacing to the right and below. */
export const CELL_W = GLYPH_WIDTH + 1;
export const CELL_H = GLYPH_HEIGHT + 1;
/** Extra pixels between lines of text... */
const LINE_SPACING = 3;
/** ...so lines are this far apart. */
export const LINE_H = CELL_H + LINE_SPACING;
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
    lineSpacing: LINE_SPACING,
  }) as unknown as { data: Phaser.Types.GameObjects.BitmapText.BitmapFontData };
  scene.cache.bitmapFont.add(PIXEL_FONT, entry);
}

export interface PixelTextStyle {
  color?: number;
  /** Whole-number scale: 1 is the font's native 5 x 7 pixels. */
  scale?: number;
  /** A one-pixel (at this scale) dark shadow, for reading on any background. */
  shadow?: boolean;
  /** Which edge of the text sits at x. */
  align?: 'left' | 'center' | 'right';
  /** Which edge of the text sits at y. */
  valign?: 'top' | 'middle' | 'bottom';
  /** A panel behind the text. */
  background?: number | null;
  backgroundAlpha?: number;
  padding?: number;
}

/** Pixel-font text that can be changed later. */
export class PixelText extends Phaser.GameObjects.Container {
  private lastText = '';
  private readonly main: Phaser.GameObjects.BitmapText;
  private readonly shade: Phaser.GameObjects.BitmapText | null;
  private readonly panel: Phaser.GameObjects.Rectangle | null;
  private readonly style: Required<PixelTextStyle>;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, style: PixelTextStyle = {}) {
    super(scene, Math.round(x), Math.round(y));
    this.style = {
      color: 0xdfe4ec,
      scale: 1,
      shadow: true,
      align: 'center',
      valign: 'middle',
      background: null,
      backgroundAlpha: 0.92,
      padding: 3,
      ...style,
    };
    const { scale, background, backgroundAlpha } = this.style;
    this.panel =
      background === null ? null : scene.add.rectangle(0, 0, 1, 1, background, backgroundAlpha);
    const make = (offset: number, tint: number): Phaser.GameObjects.BitmapText =>
      scene.add.bitmapText(offset, offset, PIXEL_FONT, '').setScale(scale).setTint(tint);
    this.shade = this.style.shadow ? make(scale, 0x05070f) : null;
    this.main = make(0, this.style.color);
    this.add([this.panel, this.shade, this.main].filter((o) => o !== null));
    scene.add.existing(this);
    this.setText(text);
  }

  /** Width and height of the text itself, in game pixels. */
  get textWidth(): number {
    return this.main.width;
  }

  get textHeight(): number {
    return this.main.height;
  }

  /** The text as last set, before the font's own substitutions. */
  get text(): string {
    return this.lastText;
  }

  setText(text: string): this {
    this.lastText = text;
    const t = toFontText(text);
    const { align, valign, padding, scale } = this.style;
    for (const b of [this.main, this.shade]) {
      if (!b) continue;
      b.setText(t).setOrigin(0, 0);
      if (align === 'left') b.setLeftAlign();
      else if (align === 'right') b.setRightAlign();
      else b.setCenterAlign();
    }
    // Place the text at whole-pixel offsets. A 0.5 origin can land glyphs on half
    // pixels, and pixel-sharp scaling then drops a column (N turns into H).
    const w = Math.round(this.main.width);
    const h = Math.round(this.main.height);
    const x = align === 'left' ? 0 : align === 'right' ? -w : -Math.round(w / 2);
    const y = valign === 'top' ? 0 : valign === 'bottom' ? -h : -Math.round(h / 2);
    this.main.setPosition(x, y);
    this.shade?.setPosition(x + scale, y + scale);
    if (this.panel) {
      this.panel
        .setOrigin(0, 0)
        .setPosition(x - padding, y - padding)
        .setSize(w + padding * 2, h + padding * 2)
        .setVisible(t.trim().length > 0);
    }
    return this;
  }

  setColor(color: number): this {
    this.main.setTint(color);
    return this;
  }
}

/** Centred pixel text (a shortcut for screens that never change it). */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: number,
  scale = 1,
  shadow = true,
): PixelText {
  return new PixelText(scene, x, y, text, { color, scale, shadow });
}

/** A clickable pixel-font button with a hover colour; its label can change. */
export class PixelButton extends Phaser.GameObjects.Container {
  private readonly box: Phaser.GameObjects.Rectangle;
  private readonly label: PixelText;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    primary = true,
  ) {
    super(scene, Math.round(x), Math.round(y));
    const colors = primary
      ? { fg: 0x11141b, bg: 0xf2a33a, hover: 0xffc266 }
      : { fg: 0xdfe4ec, bg: 0x2b3242, hover: 0x3d4760 };
    this.box = scene.add.rectangle(0, 0, 1, CELL_H + 7, colors.bg);
    this.box.setInteractive({ useHandCursor: true });
    this.box.on('pointerover', () => this.box.setFillStyle(colors.hover));
    this.box.on('pointerout', () => this.box.setFillStyle(colors.bg));
    this.box.on('pointerdown', onClick);
    this.label = new PixelText(scene, 0, 1, '', { color: colors.fg, shadow: false });
    this.add([this.box, this.label]);
    scene.add.existing(this);
    this.setLabel(label);
  }

  /**
   * Also runs `onRelease` when the press ends on the button. Browsers allow some things
   * (like fullscreen) only from a release, not a press.
   */
  onRelease(onRelease: () => void): this {
    this.box.on('pointerup', onRelease);
    return this;
  }

  /** Width of the button in game pixels. */
  get buttonWidth(): number {
    return this.box.width;
  }

  setLabel(label: string): this {
    this.label.setText(label);
    this.box.setSize(label.length * CELL_W + 11, CELL_H + 7);
    // Keep the click area in step with the new size.
    this.box.input?.hitArea.setTo(0, 0, this.box.width, this.box.height);
    return this;
  }
}

/** A centred button (a shortcut for screens). */
export function pixelButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  primary = true,
): PixelButton {
  return new PixelButton(scene, x, y, label, onClick, primary);
}
