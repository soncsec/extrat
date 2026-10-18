import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TILE } from '../config/tuning';
import { FOREST_SHEET, MARINE_SHEET, WALKER_SHEET } from './art';
import { initialSeed } from './seed';
import { button, label } from './ui';

/** Where the games portal lives, relative to this game's folder (games.soncrant.com/extrat/). */
export const PORTAL_URL = '../';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const cols = Math.ceil(GAME_WIDTH / TILE);
    const rows = Math.ceil(GAME_HEIGHT / TILE);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this.add.image(x * TILE, y * TILE, FOREST_SHEET.key, 'grass').setOrigin(0);
      }
    }
    // A tree line along the top and bottom edges.
    for (let x = 0; x < cols; x += 2) {
      this.add.image(x * TILE + 8, 2 * TILE, FOREST_SHEET.key, 'pine').setOrigin(0.5, 1);
      this.add.image(x * TILE + 24, GAME_HEIGHT + 8, FOREST_SHEET.key, 'pine').setOrigin(0.5, 1);
    }
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x11141b, 0.55).setOrigin(0);

    // A marine and an alien face off on either side of the title.
    const ground = GAME_HEIGHT - 70;
    this.add
      .sprite(70, ground, MARINE_SHEET.key)
      .setOrigin(MARINE_SHEET.originX, MARINE_SHEET.originY)
      .play('marine-idle');
    this.add
      .sprite(GAME_WIDTH - 70, ground, WALKER_SHEET.key)
      .setOrigin(1 - WALKER_SHEET.originX, WALKER_SHEET.originY)
      .setFlipX(true)
      .play('walker-idle');

    const cx = GAME_WIDTH / 2;
    label(this, cx, 52, 'EXTRAT', 36, '#f2a33a', true);
    label(this, cx, 80, 'Hunt the aliens hiding on Earth, one turn at a time.', 10, '#dfe4ec');
    label(
      this,
      cx,
      122,
      'Click a marine, then a blue tile to move (yellow: dash).\nClick an alien to aim, click again to fire.\nR reload   O overwatch   E end turn   Esc cancel',
      9,
      '#8d97a8',
    );
    button(this, cx, 172, 'START MISSION', () => this.start());
    button(this, cx, 196, 'BACK TO GAMES', () => window.location.assign(PORTAL_URL), false);
    label(this, cx, GAME_HEIGHT - 10, 'Enter: start', 8, '#8d97a8');

    this.input.keyboard?.once('keydown-ENTER', () => this.start());
  }

  private start(): void {
    this.scene.start('Battle', { seed: initialSeed() });
  }
}
