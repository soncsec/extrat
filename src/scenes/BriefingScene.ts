import Phaser from 'phaser';
import { fitDesign } from './layout';
import { DIFFICULTY, GAME_HEIGHT, GAME_WIDTH, MISSIONS, SUPPLIES, TILE } from '../config/tuning';
import { rankOf, SUPPLY_IDS, type SupplyId } from '../logic/battle';
import {
  currentMission,
  isComplete,
  pickSupply,
  squadRanks,
  supplyDue,
  type Campaign,
} from '../logic/campaign';
import { missionIntel } from '../logic/intel';
import { LANDSCAPES } from '../logic/landscapes';
import { FOREST_SHEET } from './art';
import { LINE_H, PixelButton, PixelText, pixelButton, pixelText } from './pixelFont';
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

    if (supplyDue(campaign)) {
      this.supplyDrop(campaign);
      return;
    }

    const mission = currentMission(campaign);
    pixelText(this, cx, 40, `MISSION ${campaign.mission + 1} OF ${MISSIONS.length}`, 0xf2a33a, 2);
    // A retry says so beside the landscape: 'TOWN   TRY 2: A NEW MAP'.
    const where = LANDSCAPES[mission.landscape].name.toUpperCase();
    const retry = campaign.attempt > 0 ? `   Try ${campaign.attempt + 1}: a new map` : '';
    const level = DIFFICULTY[campaign.difficulty].name;
    pixelText(this, cx, 62, `${where}   ${level}${retry}`, 0xdfe4ec);
    const intel = missionIntel(campaign.mission);
    new PixelText(
      this,
      cx,
      76,
      [
        // The final mission is won when the boss falls, whatever its escorts do (M5.6).
        ...('boss' in mission && mission.boss
          ? ['Find the Overseer in the fog', 'and destroy it.']
          : ['Find the aliens hiding in the fog', 'and wipe them out.']),
        ...intel,
        '',
        ...squadLines(campaign),
      ].join('\n'),
      { color: 0xc8d0dc, valign: 'top' },
    );
    // The supply picked for this mission (M5.10), in orange on the gap above the squad.
    if (campaign.supply) {
      new PixelText(this, cx, 76 + (2 + intel.length) * LINE_H, supplyLine(campaign.supply), {
        color: 0xf2a33a,
        valign: 'top',
      });
    }
    pixelButton(this, cx - 50, 176, 'START MISSION', () => this.start(campaign));
    pixelButton(this, cx + 26, 176, 'SQUAD', () => this.squad(campaign), false);
    pixelButton(this, cx + 76, 176, 'TITLE', () => this.toTitle(), false);
    pixelText(this, cx, 196, 'Enter: start   S: squad   Esc: title', 0xa3adbd);
    this.input.keyboard?.once('keydown-ENTER', () => this.start(campaign));
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
    this.input.keyboard?.on('keydown-S', () => this.squad(campaign));
  }

  /**
   * After a won mission (M5.10): pick one supply for every marine, for this mission
   * and its retries. The pick is saved, then the briefing shows as usual.
   */
  private supplyDrop(campaign: Campaign): void {
    const cx = GAME_WIDTH / 2;
    pixelText(this, cx, 40, 'SUPPLY DROP', 0xf2a33a, 2);
    pixelText(this, cx, 62, `Mission ${campaign.mission} won`, 0xdfe4ec);
    new PixelText(
      this,
      cx,
      84,
      [
        'Command sends supplies for',
        `mission ${campaign.mission + 1}. Pick one for every marine.`,
        'It lasts for this mission only,',
        'retries included.',
        '',
        ...squadLines(campaign),
      ].join('\n'),
      { color: 0xc8d0dc, valign: 'top' },
    );
    const pick = (id: SupplyId): void => {
      this.scene.restart({ campaign: pickSupply(campaign, id) });
    };
    const buttons = SUPPLY_IDS.map(
      (id) => new PixelButton(this, 0, 176, supplyButton(id), () => pick(id)),
    );
    const gap = 8;
    const total = buttons.reduce((sum, b) => sum + b.buttonWidth, 0) + gap * (buttons.length - 1);
    let x = cx - total / 2;
    for (const b of buttons) {
      b.setX(Math.round(x + b.buttonWidth / 2));
      x += b.buttonWidth + gap;
    }
    pixelText(this, cx, 196, '1, 2 or 3: pick   Esc: title', 0xa3adbd);
    const keys = ['ONE', 'TWO', 'THREE'] as const;
    SUPPLY_IDS.forEach((id, i) => {
      this.input.keyboard?.once(`keydown-${keys[i] ?? ''}`, () => pick(id));
    });
    this.input.keyboard?.once('keydown-ESC', () => this.toTitle());
  }

  /** The squad page with the Wall of Shame (M5.3), over this screen, which waits paused. */
  private squad(campaign: Campaign): void {
    if (this.scene.isActive('Squad')) return;
    this.scene.pause();
    this.scene.launch('Squad', { campaign, from: 'Briefing' });
  }

  private drawBackground(): void {
    // Designed for GAME_WIDTH x GAME_HEIGHT; the grass reaches wherever the canvas shows more.
    const view = fitDesign(this);
    const x0 = Math.floor(view.x / TILE) - 1;
    const x1 = Math.ceil((view.x + view.width) / TILE);
    const rows = Math.ceil(GAME_HEIGHT / TILE);
    for (let y = 0; y < rows; y++) {
      for (let x = x0; x < x1; x++) {
        this.add.image(x * TILE, y * TILE, FOREST_SHEET.key, 'grass').setOrigin(0);
      }
    }
    this.add.rectangle(view.x, view.y, view.width, view.height, 0x11141b, 0.6).setOrigin(0);
  }

  private start(campaign: Campaign): void {
    this.scene.start('Battle', { campaign });
  }

  private toTitle(): void {
    this.scene.start('Title');
  }
}

/** A supply's button: '+1 GRENADE', '+1 HEALTH', '+10 AIM'. */
function supplyButton(id: SupplyId): string {
  const s = SUPPLIES[id];
  if (s.grenades > 0) return `+${s.grenades} GRENADE`;
  if (s.hp > 0) return `+${s.hp} HEALTH`;
  return `+${s.aim} AIM`;
}

/** 'Supply: scopes, +10 aim each'. */
function supplyLine(id: SupplyId): string {
  const s = SUPPLIES[id];
  return `Supply: ${s.name.toLowerCase()}, ${s.line}`;
}

/** The squad with their ranks, two to a line, e.g. 'Squad: SQD Vasquez, RKE Okafor,'. */
function squadLines(c: Campaign): string[] {
  const ranks = squadRanks(c);
  const names = c.squad.map((n, i) => `${rankOf(ranks[i] ?? 0).short} ${n}`);
  const first = names.slice(0, 2).join(', ');
  const rest = names.slice(2).join(', ');
  return rest ? [`Squad: ${first},`, rest] : [`Squad: ${first}`];
}
