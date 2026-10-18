import Phaser from 'phaser';
import { GAME_WIDTH, MAP_ROWS, MISSIONS, TILE } from '../config/tuning';
import { afterBattle, type Campaign, type DebriefChoice } from '../logic/campaign';
import { PixelButton, pixelText } from './pixelFont';

export interface BattleResult {
  won: boolean;
  rounds: number;
  aliensKilled: number;
  marinesLost: number;
  mapSeed: number;
  /** The campaign the battle was a mission of, or null for a skirmish. */
  campaign: Campaign | null;
}

/** Space between buttons in a row. */
const BUTTON_GAP = 8;

/** The end-of-battle panel (the debrief), shown over the battlefield. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(result: BattleResult): void {
    const mapHeight = MAP_ROWS * TILE;
    const cx = GAME_WIDTH / 2;
    const cy = mapHeight / 2;
    this.add.rectangle(0, 0, GAME_WIDTH, mapHeight, 0x11141b, 0.6).setOrigin(0);
    this.add.rectangle(cx, cy, 252, 136, 0x0b0e15, 0.97).setStrokeStyle(1, 0x3d4760);

    const title = result.won ? 'MISSION COMPLETE' : 'SQUAD LOST';
    pixelText(this, cx, cy - 46, title, result.won ? 0x8bf06a : 0xff6a5a, 2);
    const row = (name: string, value: number): string =>
      `${name.padEnd(15)}${String(value).padStart(3)}`;
    pixelText(
      this,
      cx,
      cy - 10,
      [
        row('Rounds', result.rounds),
        row('Aliens killed', result.aliensKilled),
        row('Marines lost', result.marinesLost),
      ].join('\n'),
      0xdfe4ec,
    );
    // The seed rebuilds this exact map: quote it in a bug report, or open the link.
    pixelText(this, cx, cy + 18, `Map ${result.mapSeed}   Link: ?seed=${result.mapSeed}`, 0xa3adbd);

    const c = result.campaign;
    if (c) {
      // Campaign: on to the next mission (or retry on a new map), replay this map, or quit.
      const last = c.mission === MISSIONS.length - 1;
      const main = result.won ? (last ? 'FINISH' : 'NEXT MISSION') : 'RETRY';
      const choice: DebriefChoice = result.won ? 'next' : 'retry';
      this.buttonRow(cx, cy + 44, [
        [main, () => this.campaignNext(c, result.won, choice), true],
        ['REPLAY', () => this.leave('replay'), false],
        ['TITLE', () => this.toTitle(), false],
      ]);
      const hint = result.won ? (last ? 'finish' : 'next') : 'new map';
      pixelText(this, cx, cy + 62, `Enter: ${hint}  R: replay  Esc: title`, 0xa3adbd);
      this.input.keyboard?.once('keydown-ENTER', () => this.campaignNext(c, result.won, choice));
    } else {
      this.buttonRow(cx, cy + 44, [
        ['PLAY AGAIN', () => this.leave('play-again'), true],
        ['REPLAY', () => this.leave('replay'), false],
        ['TITLE', () => this.toTitle(), false],
      ]);
      pixelText(this, cx, cy + 62, 'Enter: again  R: replay  Esc: title', 0xa3adbd);
      this.input.keyboard?.once('keydown-ENTER', () => this.leave('play-again'));
    }
    this.input.keyboard?.once('keydown-R', () => this.leave('replay'));
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
  }

  /** Buttons side by side, centred on `cx`, with whole-pixel positions. */
  private buttonRow(cx: number, y: number, buttons: [string, () => void, boolean][]): void {
    const made = buttons.map(
      ([label, onClick, primary]) => new PixelButton(this, 0, y, label, onClick, primary),
    );
    const total = made.reduce((sum, b) => sum + b.buttonWidth, 0) + BUTTON_GAP * (made.length - 1);
    let x = cx - total / 2;
    for (const b of made) {
      b.setX(Math.round(x + b.buttonWidth / 2));
      x += b.buttonWidth + BUTTON_GAP;
    }
  }

  /** Campaign: the next mission (or a retry on a new map) starts with its briefing. */
  private campaignNext(c: Campaign, won: boolean, choice: DebriefChoice): void {
    const next = afterBattle(c, won, choice);
    this.scene.stop('Battle');
    this.scene.start('Briefing', { campaign: next });
  }

  /** Back to the battle: a new map ('play-again', skirmish) or the same one ('replay'). */
  private leave(event: 'play-again' | 'replay'): void {
    this.scene.stop();
    this.scene.get('Battle').events.emit(event);
  }

  private toTitle(): void {
    this.scene.stop('Battle');
    this.scene.start('Title');
  }
}
