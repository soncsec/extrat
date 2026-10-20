import Phaser from 'phaser';
import { DIFFICULTY, GAME_WIDTH, TILE } from '../config/tuning';
import type { DifficultyId } from '../logic/battle';
import { newCampaign } from '../logic/campaign';
import { FOREST_SHEET } from './art';
import { fitDesign } from './layout';
import { PixelButton, PixelText, pixelText } from './pixelFont';

/**
 * How hard the new campaign is (M6.3, owner 2026-10-19), picked before its first
 * briefing. RECRUIT is the default: Enter or 1 picks it, 2 picks VETERAN.
 */
export class DifficultyScene extends Phaser.Scene {
  constructor() {
    super('Difficulty');
  }

  create(data: { seed: number }): void {
    const view = fitDesign(this);
    const rows = Math.ceil(view.height / TILE);
    for (let y = 0; y < rows; y++) {
      for (
        let x = Math.floor(view.x / TILE) - 1;
        x < Math.ceil((view.x + view.width) / TILE);
        x++
      ) {
        this.add.image(x * TILE, y * TILE, FOREST_SHEET.key, 'grass').setOrigin(0);
      }
    }
    this.add.rectangle(view.x, view.y, view.width, view.height, 0x11141b, 0.6).setOrigin(0);
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, 112, 300, 180, 0x0b0e15, 0.94).setStrokeStyle(1, 0x3d4760);
    pixelText(this, cx, 40, 'CHOOSE DIFFICULTY', 0xf2a33a, 2);

    const pick = (id: DifficultyId): void => {
      this.scene.start('Briefing', { campaign: newCampaign(data.seed, id) });
    };
    new PixelButton(this, cx, 70, DIFFICULTY.recruit.name, () => pick('recruit'));
    new PixelText(
      this,
      cx,
      84,
      ['Aliens aim worse. Marines have', 'an extra health and grenade.'].join('\n'),
      { color: 0xc8d0dc, valign: 'top' },
    );
    new PixelButton(this, cx, 124, DIFFICULTY.veteran.name, () => pick('veteran'), false);
    new PixelText(this, cx, 138, 'The full challenge.', { color: 0xc8d0dc, valign: 'top' });
    pixelText(this, cx, 178, 'Enter or 1: recruit   2: veteran   Esc: title', 0xa3adbd);
    this.input.keyboard?.once('keydown-ENTER', () => pick('recruit'));
    this.input.keyboard?.once('keydown-ONE', () => pick('recruit'));
    this.input.keyboard?.once('keydown-TWO', () => pick('veteran'));
    this.input.keyboard?.once('keydown-ESC', () => this.scene.start('Title'));
  }
}
