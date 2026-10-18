import Phaser from 'phaser';

/** Small visual effects used by the battle scene. They don't touch game state. */

const TEXT_STYLE = {
  fontFamily: 'monospace',
  fontSize: '10px',
  fontStyle: 'bold',
  stroke: '#11141b',
  strokeThickness: 3,
} as const;

/** Text that rises and fades out, such as damage numbers or "MISS". */
export function floatText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
  depth: number,
): void {
  const t = scene.add
    .text(x, y, text, { ...TEXT_STYLE, color })
    .setOrigin(0.5, 1)
    .setDepth(depth)
    .setResolution(4);
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
export function playOnce(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  depth: number,
  scale = 1,
): Phaser.GameObjects.Sprite {
  const s = scene.add.sprite(x, y, key).setDepth(depth).setScale(scale);
  s.play(key);
  s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  return s;
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
