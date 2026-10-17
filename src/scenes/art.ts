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

/** A character sheet: frames of equal size, and where the feet are inside a frame. */
export interface CharacterSheet {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  /** Feet position as a fraction of the frame, for a sprite facing right. */
  originX: number;
  originY: number;
  /** Height of the character above its feet, in pixels (for markers over its head). */
  height: number;
  /** Animations: first frame index and frame count. */
  anims: Readonly<Record<string, { start: number; count: number; fps: number }>>;
}

/** The marine atlas has 10 columns; each row is one animation. */
export const MARINE_SHEET: CharacterSheet = {
  key: 'marine',
  url: 'assets/marine/space-marine.png',
  frameWidth: 75,
  frameHeight: 48,
  originX: 37.5 / 75,
  originY: 1,
  height: 36,
  anims: {
    idle: { start: 0, count: 4, fps: 6 },
    run: { start: 10, count: 10, fps: 14 },
    die: { start: 20, count: 3, fps: 8 },
    shoot: { start: 40, count: 2, fps: 10 },
    crouch: { start: 50, count: 3, fps: 6 },
    crouchShoot: { start: 60, count: 2, fps: 10 },
  },
};

export const WALKER_SHEET: CharacterSheet = {
  key: 'walker',
  url: 'assets/alien-walker/alien-enemy-idle.png',
  frameWidth: 48,
  frameHeight: 48,
  originX: 29.5 / 48,
  originY: 45 / 48,
  height: 30,
  anims: { idle: { start: 0, count: 4, fps: 5 } },
};

/** Registers a sheet's animations as `<key>-<name>`, once. */
export function addAnims(anims: Phaser.Animations.AnimationManager, sheet: CharacterSheet): void {
  for (const [name, a] of Object.entries(sheet.anims)) {
    const key = `${sheet.key}-${name}`;
    if (anims.exists(key)) continue;
    anims.create({
      key,
      frames: anims.generateFrameNumbers(sheet.key, { start: a.start, end: a.start + a.count - 1 }),
      frameRate: a.fps,
      repeat: name === 'die' ? 0 : -1,
    });
  }
}
