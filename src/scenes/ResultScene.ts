import Phaser from 'phaser';
import { GAME_WIDTH, MAP_ROWS, TILE } from '../config/tuning';
import type { LandscapeId } from '../logic/landscapes';
import { pixelButton, pixelText } from './pixelFont';

export interface BattleResult {
  won: boolean;
  rounds: number;
  aliensKilled: number;
  marinesLost: number;
  mapSeed: number;
  landscape: LandscapeId;
}

/** The end-of-battle panel, shown over the battlefield. */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(result: BattleResult): void {
    const mapHeight = MAP_ROWS * TILE;
    const cx = GAME_WIDTH / 2;
    const cy = mapHeight / 2;
    this.add.rectangle(0, 0, GAME_WIDTH, mapHeight, 0x11141b, 0.6).setOrigin(0);
    this.add.rectangle(cx, cy, 240, 136, 0x0b0e15, 0.97).setStrokeStyle(1, 0x3d4760);

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
    const where = result.landscape === 'forest' ? '' : `&landscape=${result.landscape}`;
    const link = `?seed=${result.mapSeed}${where}`;
    pixelText(this, cx, cy + 18, `Map ${result.mapSeed}   Link: ${link}`, 0xa3adbd);
    pixelButton(this, cx - 52, cy + 44, 'PLAY AGAIN', () => this.leave('play-again'));
    pixelButton(this, cx + 15, cy + 44, 'REPLAY', () => this.leave('replay'), false);
    pixelButton(this, cx + 67, cy + 44, 'TITLE', () => this.toTitle(), false);
    pixelText(this, cx, cy + 62, 'Enter: again  R: replay  Esc: title', 0xa3adbd);

    this.input.keyboard?.once('keydown-ENTER', () => this.leave('play-again'));
    this.input.keyboard?.once('keydown-R', () => this.leave('replay'));
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
  }

  /** Back to the battle: a new map ('play-again') or the same one ('replay'). */
  private leave(event: 'play-again' | 'replay'): void {
    this.scene.stop();
    this.scene.get('Battle').events.emit(event);
  }

  private toTitle(): void {
    this.scene.stop('Battle');
    this.scene.start('Title');
  }
}
