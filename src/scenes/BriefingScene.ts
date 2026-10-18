import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, MISSIONS, TILE } from '../config/tuning';
import { rankOf } from '../logic/battle';
import { currentMission, isComplete, squadRanks, type Campaign } from '../logic/campaign';
import { LANDSCAPES } from '../logic/landscapes';
import { FOREST_SHEET } from './art';
import { PixelText, pixelButton, pixelText } from './pixelFont';
import { clearSave, writeSave } from './storage';

/**
 * Before each campaign mission: which mission, where, what to expect and who's going.
 * After the last one it shows the campaign victory instead (M5.1).
 */
export class BriefingScene extends Phaser.Scene {
  constructor() {
    super('Briefing');
  }

  create(data: { campaign: Campaign }): void {
    const campaign = data.campaign;
    this.drawBackground();
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, 118, 300, 196, 0x0b0e15, 0.94).setStrokeStyle(1, 0x3d4760);

    // Saved here between missions (ADR-E6); a finished campaign leaves no save behind.
    if (isComplete(campaign)) clearSave();
    else writeSave(campaign, null);

    if (isComplete(campaign)) {
      pixelText(this, cx, 52, 'CAMPAIGN COMPLETE', 0x8bf06a, 2);
      pixelText(
        this,
        cx,
        104,
        [
          `All ${MISSIONS.length} missions won.`,
          'The aliens are gone from Earth...',
          'for now.',
          '',
          ...squadLines(campaign),
        ].join('\n'),
        0xdfe4ec,
      );
      pixelButton(this, cx, 176, 'TITLE', () => this.toTitle());
      pixelText(this, cx, 196, 'Enter or Esc: title', 0xa3adbd);
      this.input.keyboard?.once('keydown-ENTER', () => this.toTitle());
      this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
      return;
    }

    const mission = currentMission(campaign);
    const { count, size } = mission.pods;
    pixelText(this, cx, 40, `MISSION ${campaign.mission + 1} OF ${MISSIONS.length}`, 0xf2a33a, 2);
    // A retry says so beside the landscape: 'TOWN   TRY 2: A NEW MAP'.
    const where = LANDSCAPES[mission.landscape].name.toUpperCase();
    const retry = campaign.attempt > 0 ? `   Try ${campaign.attempt + 1}: a new map` : '';
    pixelText(this, cx, 62, `${where}${retry}`, 0xdfe4ec);
    new PixelText(
      this,
      cx,
      76,
      [
        'Find the aliens hiding in the fog',
        'and wipe them out.',
        '',
        `Intel: ${count} groups of ${size}.`,
        'They wait until they see you.',
        '',
        ...squadLines(campaign),
      ].join('\n'),
      { color: 0xc8d0dc, valign: 'top' },
    );
    pixelButton(this, cx - 30, 176, 'START MISSION', () => this.start(campaign));
    pixelButton(this, cx + 52, 176, 'TITLE', () => this.toTitle(), false);
    pixelText(this, cx, 196, 'Enter: start   Esc: title', 0xa3adbd);
    this.input.keyboard?.once('keydown-ENTER', () => this.start(campaign));
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
  }

  private drawBackground(): void {
    const cols = Math.ceil(GAME_WIDTH / TILE);
    const rows = Math.ceil(GAME_HEIGHT / TILE);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this.add.image(x * TILE, y * TILE, FOREST_SHEET.key, 'grass').setOrigin(0);
      }
    }
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x11141b, 0.6).setOrigin(0);
  }

  private start(campaign: Campaign): void {
    this.scene.start('Battle', { campaign });
  }

  private toTitle(): void {
    this.scene.start('Title');
  }
}

/** The squad with their ranks, two to a line, e.g. 'Squad: SQD Vasquez, RKE Okafor,'. */
function squadLines(c: Campaign): string[] {
  const ranks = squadRanks(c);
  const names = c.squad.map((n, i) => `${rankOf(ranks[i] ?? 0).short} ${n}`);
  const first = names.slice(0, 2).join(', ');
  const rest = names.slice(2).join(', ');
  return rest ? [`Squad: ${first},`, rest] : [`Squad: ${first}`];
}
