import Phaser from 'phaser';
import { buildPixelFont } from './pixelFont';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/tuning';
import {
  addAnims,
  addFrames,
  BULLET,
  EFFECTS,
  FLYER_SHEET,
  FOREST_SHEET,
  LIZARD_HURT_SHEET,
  LIZARD_SHEET,
  LIZARD_TONGUE_SHEET,
  LIZARD_WALK_SHEET,
  MARINE_SHEET,
  SNAKE_HURT_SHEET,
  SNAKE_SHEET,
  SNAKE_SHOOT_SHEET,
  SNAKE_WALK_SHEET,
  SPIT,
  WALKER_SHEET,
  WALKER_WALK_SHEET,
} from './art';

export const CHARACTER_SHEETS = [
  MARINE_SHEET,
  WALKER_SHEET,
  WALKER_WALK_SHEET,
  FLYER_SHEET,
  LIZARD_SHEET,
  LIZARD_WALK_SHEET,
  LIZARD_TONGUE_SHEET,
  LIZARD_HURT_SHEET,
  SNAKE_SHEET,
  SNAKE_WALK_SHEET,
  SNAKE_SHOOT_SHEET,
  SNAKE_HURT_SHEET,
];

/** Loads every image once, registers frames and animations, then opens the title. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const bar = this.add
      .rectangle(GAME_WIDTH / 2 - 60, GAME_HEIGHT / 2, 0, 4, 0xf2a33a)
      .setOrigin(0, 0.5);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 122, 6).setStrokeStyle(1, 0x2b3242);
    this.load.on('progress', (p: number) => bar.setSize(120 * p, 4));

    this.load.image(FOREST_SHEET.key, FOREST_SHEET.url);
    for (const s of CHARACTER_SHEETS) {
      this.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
    for (const e of Object.values(EFFECTS)) {
      this.load.spritesheet(e.key, e.url, { frameWidth: e.frameWidth, frameHeight: e.frameHeight });
    }
    this.load.image(BULLET.key, BULLET.url);
    const [frameWidth, frameHeight] = SPIT.size;
    this.load.spritesheet(SPIT.key, SPIT.url, { frameWidth, frameHeight });
  }

  create(): void {
    addFrames(this.textures, FOREST_SHEET.key, FOREST_SHEET.frames);
    for (const s of CHARACTER_SHEETS) addAnims(this.anims, s);
    for (const e of Object.values(EFFECTS)) {
      const frames = this.anims.generateFrameNumbers(e.key, { start: 0, end: e.count - 1 });
      this.anims.create({ key: e.key, frames, frameRate: e.fps, repeat: 0 });
    }
    buildPixelFont(this);
    this.scene.start('Title');
  }
}
