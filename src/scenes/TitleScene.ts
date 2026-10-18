import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TILE } from '../config/tuning';
import { FOREST_SHEET, MARINE_SHEET, WALKER_SHEET } from './art';
import { newCampaign } from '../logic/campaign';
import { restoreBattle, type Save } from '../logic/save';
import { clearSave, readSave } from './storage';
import { randomSeed, urlNumber } from './seed';
import { PixelText, pixelButton, pixelText } from './pixelFont';

/** Where the games portal lives, relative to this game's folder (games.soncrant.com/extrat/). */
export const PORTAL_URL = '../';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(data: { damaged?: boolean } = {}): void {
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
    pixelText(this, cx, 34, 'EXTRAT', 0xf2a33a, 5);
    pixelText(this, cx, 64, 'Hunt the aliens hiding on Earth, one turn at a time.', 0xdfe4ec);
    // The controls on a dark panel, so they read clearly over the forest.
    this.add.rectangle(cx, 113, 312, 66, 0x05070f, 0.8).setStrokeStyle(1, 0x2b3242);
    pixelText(
      this,
      cx,
      113,
      [
        'Click a marine, then a blue tile to move.',
        'Yellow tiles are a dash: both actions.',
        'Click an alien to aim, again to fire.',
        'Tab or 1-4: marine   F: target   E: end turn',
        'R: reload   O: watch   G: grenade',
      ].join('\n'),
      0xc8d0dc,
    );
    // ?seed=N plays that one map as a skirmish (bug reports, tests) and ?campaign=N a
    // given campaign; otherwise the saved campaign can be continued, or a new one begun.
    const skirmish = urlNumber('seed') !== null;
    const stored = skirmish || urlNumber('campaign') !== null ? null : readSave();
    if (stored?.status === 'bad' || data.damaged) {
      new PixelText(this, cx, 236, 'Saved campaign was damaged, so it was cleared.', {
        color: 0xff6a5a,
        background: 0x05070f,
        padding: 3,
      }).setDepth(1);
    }
    if (stored?.status === 'ok') {
      const save = stored.save;
      pixelButton(this, cx, 166, 'CONTINUE', () => this.continue(save));
      pixelButton(this, cx, 186, 'NEW CAMPAIGN', () => this.start(), false);
      pixelButton(this, cx, 206, 'BACK TO GAMES', () => window.location.assign(PORTAL_URL), false);
      pixelText(this, cx, 226, 'Enter: continue  N: new campaign  H: help', 0xa3adbd);
      this.input.keyboard?.once('keydown-ENTER', () => this.continue(save));
      this.input.keyboard?.once('keydown-N', () => this.start());
    } else {
      pixelButton(this, cx, 172, skirmish ? 'START MISSION' : 'START CAMPAIGN', () => this.start());
      pixelButton(this, cx, 194, 'BACK TO GAMES', () => window.location.assign(PORTAL_URL), false);
      pixelText(this, cx, 214, 'Enter: start   H: how to play', 0xa3adbd);
      this.input.keyboard?.once('keydown-ENTER', () => this.start());
    }
    this.input.keyboard?.on('keydown-H', () => {
      this.scene.pause();
      this.scene.launch('Help', { from: 'Title' });
    });
  }

  private start(): void {
    const seed = urlNumber('seed');
    if (seed !== null) {
      this.scene.start('Battle', { seed });
      return;
    }
    // ?campaign=N replays a whole campaign (bug reports); otherwise a new one. It
    // replaces any saved campaign when its briefing saves.
    const campaign = newCampaign(urlNumber('campaign') ?? randomSeed());
    this.scene.start('Briefing', { campaign });
  }

  /** Back to where the save left off: the battle in progress, or the next briefing. */
  private continue(save: Save): void {
    if (!save.battle) {
      this.scene.start('Briefing', { campaign: save.campaign });
      return;
    }
    const resume = restoreBattle(save.campaign, save.battle);
    if (!resume) {
      // It passed the shape checks but doesn't fit its map: not ours. Clear it and say so.
      clearSave();
      this.scene.restart({ damaged: true });
      return;
    }
    this.scene.start('Battle', { campaign: save.campaign, resume });
  }
}
