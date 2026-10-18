import type Phaser from 'phaser';

export const FONT = 'monospace';

/** A clickable text button with a hover state. */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  primary = true,
): Phaser.GameObjects.Text {
  const colors = primary
    ? { fg: '#11141b', bg: '#f2a33a', hover: '#ffc266' }
    : { fg: '#dfe4ec', bg: '#2b3242', hover: '#3d4760' };
  const t = scene.add
    .text(x, y, label, {
      fontFamily: FONT,
      fontSize: '10px',
      fontStyle: 'bold',
      color: colors.fg,
      backgroundColor: colors.bg,
      padding: { x: 6, y: 3 },
    })
    .setOrigin(0.5)
    .setResolution(4)
    .setInteractive({ useHandCursor: true });
  t.on('pointerover', () => t.setBackgroundColor(colors.hover));
  t.on('pointerout', () => t.setBackgroundColor(colors.bg));
  t.on('pointerdown', onClick);
  return t;
}

/** Plain text in the game's style. */
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  bold = false,
): Phaser.GameObjects.Text {
  // Thin strokes like '-' can vanish when small text is scaled down pixel-sharp; an
  // outline in the text's own colour thickens them (see the odds panel).
  const outline = size <= 10 ? { stroke: color, strokeThickness: 1 } : {};
  return scene.add
    .text(x, y, text, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: bold ? 'bold' : 'normal',
      color,
      align: 'center',
      ...outline,
    })
    .setOrigin(0.5)
    .setResolution(4);
}
