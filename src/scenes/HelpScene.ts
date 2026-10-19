import Phaser from 'phaser';
import { isShort } from '../logic/layout';
import { fitDesign, LAYOUT } from './layout';
import { GAME_WIDTH } from '../config/tuning';
import { PixelText, pixelText } from './pixelFont';

/** The help pages: what to do, the alien types, and the keys. */
const PAGES: readonly { title: string; lines: readonly string[] }[] = [
  {
    title: 'HOW TO PLAY',
    lines: [
      'Find the aliens hiding in the fog and wipe them out.',
      'Each marine has 2 actions a turn.',
      '',
      'Move: click a blue tile, or tap it twice (1 action).',
      '  Yellow tiles are a dash: both actions.',
      'Shoot: click an alien to aim, again to fire.',
      "  Firing uses the rest of the marine's turn.",
      'Cover: the shield by a marine shows its cover',
      '  against the nearest alien (half or full).',
      '  No cover facing the shooter = flanked: crits!',
      'Watch (O): shoot the first alien that moves in sight.',
      'Grenade (G): pick a tile. Hits a 3 x 3 area,',
      "  and blows away the survivors' cover for a turn.",
      'Reload (R): 3 shots a clip, 1 action to reload.',
      'Ranks: hits, kills and wins earn XP. Ranks add',
      '  aim, health, grenades and ammo. Replays earn none.',
    ],
  },
  {
    title: 'ALIENS AND KEYS',
    lines: [
      'Aliens wait in groups until they see you,',
      'then scramble for cover: the ambush.',
      '',
      'Walker: claws the 8 tiles around it. Cover',
      "  doesn't help against claws.",
      'Flyer: shoots from above: cover counts less.',
      'Lizard: its tongue drags a marine next to it.',
      'Snake: its spit poisons for 2 turns (-1 health',
      '  a turn, but poison never kills).',
      '',
      'Tab or 1-4: pick a marine   F: next target',
      'Enter: fire   E: end turn   Esc: cancel',
      'R: reload   O: watch   G: grenade   H: help',
      'Space or a tap: fast-forward the alien turn',
    ],
  },
];

/**
 * How to play, over whatever is showing (the battle or the title), which waits paused
 * underneath. H or Esc closes it; the arrow keys, Space or Enter turn the page.
 */
export class HelpScene extends Phaser.Scene {
  private page = 0;
  private body!: PixelText;
  private title!: PixelText;
  private footer!: PixelText;
  private from = 'Battle';

  constructor() {
    super('Help');
  }

  create(data: { from?: string }): void {
    this.from = data.from ?? 'Battle';
    this.page = 0;
    const cx = GAME_WIDTH / 2;
    const view = fitDesign(this);
    // Phones are shorter: the same pages, closer to the edges.
    const short = isShort(LAYOUT);
    this.add.rectangle(view.x, view.y, view.width, view.height, 0x05070f, 0.82).setOrigin(0);
    this.add
      .rectangle(
        cx,
        view.height / 2,
        GAME_WIDTH - 16,
        view.height - (short ? 6 : 16),
        0x0b0e15,
        0.97,
      )
      .setStrokeStyle(1, 0x3d4760);
    this.title = pixelText(this, cx, short ? 15 : 22, '', 0xf2a33a, 2);
    this.body = new PixelText(this, 18, short ? 27 : 40, '', {
      color: 0xdfe4ec,
      align: 'left',
      valign: 'top',
    });
    this.footer = pixelText(this, cx, view.height - (short ? 10 : 20), '', 0xa3adbd);
    this.show(0);

    // The H press that opened this screen may still be waiting in Phaser's key queue:
    // only keys pressed after it opened count.
    const opened = performance.now();
    const fresh = (e: KeyboardEvent): boolean => e.timeStamp >= opened;
    const keys = this.input.keyboard;
    const close = (e: KeyboardEvent): void => {
      if (fresh(e)) this.close();
    };
    keys?.on('keydown-H', close);
    keys?.on('keydown-ESC', close);
    for (const k of ['RIGHT', 'SPACE', 'ENTER']) {
      keys?.on(`keydown-${k}`, (e: KeyboardEvent) => fresh(e) && this.show(1));
    }
    keys?.on('keydown-LEFT', (e: KeyboardEvent) => fresh(e) && this.show(0));
    this.input.on('pointerdown', () => (this.page === 0 ? this.show(1) : this.close()));
  }

  private show(page: number): void {
    this.page = Math.max(0, Math.min(PAGES.length - 1, page));
    const p = PAGES[this.page] as (typeof PAGES)[number];
    this.title.setText(p.title);
    this.body.setText(p.lines.join('\n'));
    this.footer.setText(
      `Page ${this.page + 1} of ${PAGES.length}   ` +
        (this.page === 0 ? 'Right or click: next   H: close' : 'Left: back   H or click: close'),
    );
  }

  private close(): void {
    this.scene.resume(this.from);
    this.scene.stop();
  }
}
