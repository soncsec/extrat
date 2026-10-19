import Phaser from 'phaser';
import { fitDesign } from './layout';
import { GAME_WIDTH } from '../config/tuning';
import { rankOf } from '../logic/battle';
import { rankForXp, type Campaign } from '../logic/campaign';
import { NO_SHAME, nicknameFor } from '../logic/shame';
import { LINE_H, PixelText, pixelText } from './pixelFont';

/**
 * The squad and its Wall of Shame (M5.3): rank, name, XP, deaths and the nickname a
 * death earns. Over the briefing, which waits paused. S, Esc or a tap closes it.
 */
export class SquadScene extends Phaser.Scene {
  private from = 'Briefing';

  constructor() {
    super('Squad');
  }

  create(data: { campaign: Campaign; from?: string }): void {
    this.from = data.from ?? 'Briefing';
    const c = data.campaign;
    const cx = GAME_WIDTH / 2;
    const view = fitDesign(this);
    this.add.rectangle(view.x, view.y, view.width, view.height, 0x05070f, 0.82).setOrigin(0);
    this.add
      .rectangle(cx, view.height / 2, GAME_WIDTH - 16, view.height - 16, 0x0b0e15, 0.97)
      .setStrokeStyle(1, 0x3d4760);
    pixelText(this, cx, 22, 'THE SQUAD', 0xf2a33a, 2);
    new PixelText(this, 24, 44, squadTable(c).join('\n'), {
      color: 0xdfe4ec,
      align: 'left',
      valign: 'top',
    });
    const shamed = c.squad.filter((_, i) => (c.deaths[i] ?? 0) > 0).length;
    pixelText(this, cx, 44 + 6 * LINE_H + 10, 'WALL OF SHAME', 0xff6a5a, 2);
    new PixelText(this, cx, 44 + 6 * LINE_H + 34, wallLines(c, shamed).join('\n'), {
      color: 0xdfe4ec,
      valign: 'top',
    });
    pixelText(this, cx, view.height - 20, 'S, Esc or tap: back', 0xa3adbd);

    // The S press that opened this page may still be in the key queue: only later ones count.
    const opened = performance.now();
    const close = (e: KeyboardEvent): void => {
      if (e.timeStamp >= opened) this.close();
    };
    this.input.keyboard?.on('keydown-S', close);
    this.input.keyboard?.on('keydown-ESC', close);
    this.input.on('pointerdown', () => this.close());
  }

  private close(): void {
    this.scene.resume(this.from);
    this.scene.stop();
  }
}

/** One row per marine: rank, name, XP, deaths and nickname, under a header. */
function squadTable(c: Campaign): string[] {
  const rows = c.squad.map((name, i) => {
    const rank = rankOf(rankForXp(c.xp[i] ?? 0)).short;
    const nick = nicknameFor(c, i);
    return (
      `${rank.padEnd(4)} ${name.padEnd(10)} ${String(c.xp[i] ?? 0).padStart(4)}` +
      `  ${String(c.deaths[i] ?? 0).padStart(3)}   ${nick ?? ''}`
    );
  });
  return ['RANK NAME         XP  DEAD   NICKNAME', ...rows];
}

/** What the wall says: who has died most, or that nobody has yet. */
function wallLines(c: Campaign, shamed: number): string[] {
  if (shamed === 0) return [NO_SHAME];
  const most = c.deaths.reduce((best, d, i) => (d > (c.deaths[best] ?? 0) ? i : best), 0);
  const name = c.squad[most] ?? '';
  const n = c.deaths[most] ?? 0;
  const total = c.deaths.reduce((a, b) => a + b, 0);
  return [
    `${name} leads the wall with ${n} death${n === 1 ? '' : 's'}.`,
    `The squad has died ${total} time${total === 1 ? '' : 's'} so far.`,
    'Nobody stays dead. Everybody remembers.',
  ];
}
