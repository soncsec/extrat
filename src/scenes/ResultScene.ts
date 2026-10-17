import Phaser from 'phaser';
import { GAME_WIDTH, MAP_ROWS, TILE } from '../config/tuning';
import { button, label } from './ui';

export interface BattleResult {
  won: boolean;
  rounds: number;
  aliensKilled: number;
  marinesLost: number;
  mapSeed: number;
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
    this.add.rectangle(cx, cy, 220, 130, 0x11141b, 0.95).setStrokeStyle(1, 0x2b3242);

    const title = result.won ? 'MISSION COMPLETE' : 'SQUAD LOST';
    label(this, cx, cy - 44, title, 16, result.won ? '#8bf06a' : '#ff6a5a', true);
    const lines = [
      `Rounds        ${result.rounds}`,
      `Aliens killed ${result.aliensKilled}`,
      `Marines lost  ${result.marinesLost}`,
    ];
    label(this, cx, cy - 8, lines.join('\n'), 10, '#dfe4ec');
    label(this, cx, cy + 20, `map ${result.mapSeed}`, 8, '#8d97a8');
    button(this, cx - 48, cy + 44, 'PLAY AGAIN', () => this.playAgain());
    button(this, cx + 48, cy + 44, 'TITLE', () => this.toTitle(), false);

    this.input.keyboard?.once('keydown-ENTER', () => this.playAgain());
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
  }

  private playAgain(): void {
    this.scene.stop();
    this.scene.get('Battle').events.emit('play-again');
  }

  private toTitle(): void {
    this.scene.stop('Battle');
    this.scene.start('Title');
  }
}
