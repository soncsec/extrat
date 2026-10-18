import Phaser from 'phaser';
import { PixelText } from './pixelFont';

/** Small visual effects used by the battle scene. They don't touch game state. */

/** Text that rises and fades out, such as damage numbers or "MISS". */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
  depth: number,
): void {
  const t = new PixelText(scene, x, y, text, {
    color: Phaser.Display.Color.HexStringToColor(color).color,
    valign: 'bottom',
    background: 0x11141b,
    backgroundAlpha: 0.7,
    padding: 1,
  }).setDepth(depth);
  scene.tweens.add({
    targets: t,
    y: y - 12,
    alpha: 0,
    delay: 350,
    duration: 600,
    onComplete: () => t.destroy(),
  });
}

/** Flashes a sprite solid white for a moment. */
export function flash(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite): void {
  sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  scene.time.delayedCall(90, () => sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));
}

/** Plays a registered one-shot animation at a point, then removes it. */
/** How a pooled effect is drawn. */
export interface FxStyle {
  scale?: number;
  flipX?: boolean;
  /** Multiplied into the colours (white parts take this colour). */
  tint?: number;
  /** A frame of a still image, for projectiles. */
  frame?: string | number;
}

/**
 * Effect sprites (hits, deaths, blasts, projectiles) are reused rather than made and
 * destroyed each time: a finished one goes back on the free list.
 */
export class FxPool {
  private readonly free: Phaser.GameObjects.Sprite[] = [];
  private made = 0;
  private taken = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** A sprite showing `texture`, ready to place. Give it back when done. */
  take(
    texture: string,
    x: number,
    y: number,
    depth: number,
    style: FxStyle = {},
  ): Phaser.GameObjects.Sprite {
    this.taken++;
    let s = this.free.pop();
    if (!s) {
      s = this.scene.add.sprite(0, 0, texture);
      this.made++;
    }
    s.setTexture(texture, style.frame)
      .setPosition(x, y)
      .setDepth(depth)
      .setScale(style.scale ?? 1)
      .setFlipX(style.flipX ?? false)
      .setRotation(0)
      .setAlpha(1)
      .setOrigin(0.5)
      .setActive(true)
      .setVisible(true);
    if (style.tint === undefined) s.clearTint();
    else s.setTint(style.tint);
    return s;
  }

  give(s: Phaser.GameObjects.Sprite): void {
    s.stop();
    s.setActive(false).setVisible(false);
    this.free.push(s);
  }

  /** Plays an effect animation (named like its texture) once, then returns the sprite. */
  play(key: string, x: number, y: number, depth: number, style: FxStyle = {}): void {
    const s = this.take(key, x, y, depth, style);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.give(s));
  }

  /** Sprites made so far (for tests: it stops growing once the pool is warm). */
  get size(): number {
    return this.made;
  }

  /** Effects shown so far, each needing a sprite (for tests: more than were made). */
  get uses(): number {
    return this.taken;
  }
}

/** Health pips over a unit's head: one per hit point, filled for the ones it has left. */
export function drawPips(
  g: Phaser.GameObjects.Graphics,
  centerX: number,
  top: number,
  hp: number,
  maxHp: number,
  color: number,
): void {
  const pip = 3;
  const gap = 1;
  const width = maxHp * pip + (maxHp - 1) * gap;
  const left = Math.round(centerX - width / 2);
  g.fillStyle(0x11141b, 1).fillRect(left - 1, top - 1, width + 2, 4);
  for (let i = 0; i < maxHp; i++) {
    g.fillStyle(i < hp ? color : 0x3a4152, 1).fillRect(left + i * (pip + gap), top, pip, 2);
  }
}

/** Red corner brackets around a target's body. */
export function drawReticle(
  g: Phaser.GameObjects.Graphics,
  centerX: number,
  bottom: number,
  height: number,
): void {
  const w = 22;
  const left = Math.round(centerX - w / 2);
  const top = bottom - height - 2;
  const right = left + w - 1;
  const low = bottom + 1;
  g.fillStyle(0xff5a4a, 1);
  for (const [x, y, dx, dy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, low, 1, -1],
    [right, low, -1, -1],
  ] as const) {
    g.fillRect(Math.min(x, x + dx * 4), y, 5, 1);
    g.fillRect(x, Math.min(y, y + dy * 4), 1, 5);
  }
}

const SHIELD = [
  '1111111',
  '1111111',
  '1111111',
  '1111111',
  '0111110',
  '0111110',
  '0011100',
  '0001000',
];

/** A 7 x 8 cover shield with its top-left at (x, y): solid for full cover, half filled for half. */
export function drawShield(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  full: boolean,
): void {
  SHIELD.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c !== '1') return;
      const edge =
        j === 0 ||
        i === 0 ||
        i === 6 ||
        row[i - 1] === '0' ||
        row[i + 1] === '0' ||
        SHIELD[j + 1]?.[i] !== '1';
      const color = edge ? 0x0b1220 : full || i < 4 ? 0x4aa8ff : 0x1b2331;
      g.fillStyle(color, 1).fillRect(x + i, y + j, 1, 1);
    });
  });
}

/** A small yellow eye (9 x 5) with its top-left at (x, y): the unit is on overwatch. */
export function drawEye(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const rows = ['..#####..', '.#.....#.', '#...#...#', '.#.....#.', '..#####..'];
  rows.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c === '#') g.fillStyle(0xffd23a, 1).fillRect(x + i, y + j, 1, 1);
    });
  });
  g.fillStyle(0x11141b, 1).fillRect(x + 3, y + 1, 3, 3);
  g.fillStyle(0xffd23a, 1).fillRect(x + 4, y + 2, 1, 1);
}

/** A small red cross-hatched shield (7 x 8) with its top-left at (x, y): cover blown away. */
export function drawExposed(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  SHIELD.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c !== '1') return;
      const edge =
        j === 0 ||
        i === 0 ||
        i === 6 ||
        row[i - 1] === '0' ||
        row[i + 1] === '0' ||
        SHIELD[j + 1]?.[i] !== '1';
      const crack = (i + j) % 3 === 0;
      g.fillStyle(edge ? 0x0b1220 : crack ? 0x11141b : 0xff5a4a, 1).fillRect(x + i, y + j, 1, 1);
    });
  });
}

/** A small green venom drop (5 x 7) with its top-left at (x, y): poisoned. */
export function drawPoison(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const rows = ['..#..', '..#..', '.###.', '#####', '##.##', '#####', '.###.'];
  rows.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c === '#') g.fillStyle(0x7ad84a, 1).fillRect(x + i, y + j, 1, 1);
    });
  });
}
