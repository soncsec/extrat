import Phaser from 'phaser';
import {
  ACTION_POINTS,
  ANIMATION,
  BOSS,
  BOSS_PRACTICE,
  DEFAULT_SEED,
  GRENADE,
  GAME_WIDTH,
  HUD_HEIGHT,
  HUD_SIDE_WIDTH,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAP_COLS,
  MAP_ROWS,
  MISSIONS,
  SKIRMISH,
  TILE,
  TOUCH,
  UNITS,
} from '../config/tuning';
import type { Point } from '../logic/grid';
import {
  battleOutcome,
  apply,
  canAct,
  canOverwatch,
  canThrow,
  canReload,
  clipSize,
  createBattle,
  coverAgainst,
  hitChance,
  inThrowRange,
  livingUnits,
  moveCost,
  hasActions,
  moveRange,
  nextReadyMarine,
  pathFor,
  shotBlock,
  shotOdds,
  shootableTargets,
  tilesSeenFrom,
  unitAt,
  rankOf,
  unitById,
  visibleTiles,
  type Action,
  type BattleState,
  type MoveResult,
  type Scamper,
  type ShotBlock,
  type ShotOdds,
  type ShotResult,
  type ThrowResult,
  type Side,
  type SupplyId,
  type Unit,
  type UnitKind,
  footprint,
  unitSize,
  type BlastResult,
} from '../logic/battle';
import { planAlienAction } from '../logic/ai';
import {
  afterBattle,
  awardXp,
  recordDeaths,
  battleXp,
  currentMission,
  isComplete,
  squadRanks,
  type Campaign,
} from '../logic/campaign';
import { landscapeId, LANDSCAPES, type LandscapeId } from '../logic/landscapes';
import { generateMap, PROPS, tileAt } from '../logic/map';
import { createRng, type Rng } from '../logic/rng';
import {
  BASE_SHEETS,
  BULLET,
  EFFECTS,
  LANDSCAPE_ART,
  MARINE_SHEET,
  SPIT,
  UNIT_ANIMS,
  type AnimName,
  type CharacterSheet,
} from './art';
import { BLAST_TEXTURE } from './blastArt';
import { PORTRAIT_SIZE, PORTRAIT_TEXTURE } from './portraits';
import { isMuted, playSound, toggleMute } from './sfx';
import {
  drawExposed,
  drawEye,
  drawPips,
  drawPoison,
  drawReticle,
  drawShield,
  flash,
  floatText,
  FxPool,
} from './fx';
import type { BattleResult } from './ResultScene';
import { CELL_W, PixelButton, PixelText } from './pixelFont';
import { initialSeed, urlDifficulty, urlWord } from './seed';
import { LAYOUT } from './layout';
import { clearSave, writeSave } from './storage';
import { isTouchDevice } from './touch';

/** A tile a unit can move to, and the action points that costs (2 means a dash). */
export interface MoveTile extends Point {
  cost: number;
}

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  seed: number;
  mapSeed: number;
  /** The campaign mission (0-based), try, squad XP and supply, or null in a skirmish. */
  campaign: {
    mission: number;
    attempt: number;
    xp: number[];
    deaths: number[];
    supply: SupplyId | null;
  } | null;
  /** This battle was started with REPLAY (it earns no XP). */
  replaying: boolean;
  /** The alien turn is playing at fast-forward speed (M5.11). */
  fast: boolean;
  /** The text of the unit line in the HUD, e.g. the prompt to pick a marine. */
  prompt: string;
  /** Touch: the tile tapped once, whose preview shows until it is tapped again. */
  pending: Point | null;
  /** One character per tile, row by row: '.' free, or the first letter of the prop. */
  layout: string;
  units: {
    id: string;
    side: Side;
    x: number;
    y: number;
    hp: number;
    ap: number;
    ammo: number | null;
    overwatch: boolean;
    grenades: number;
    exposed: boolean;
    kind: UnitKind;
    name: string;
    /** Turns of poison left. */
    poison: number;
    /** Squares the unit can still walk for free (left from a move cut short). */
    freeSteps: number;
    /** Index into RANKS. */
    rank: number;
    maxHp: number;
    /** The squad can see this unit now (aliens in the fog are false). */
    seen: boolean;
    /** An alien whose pod hasn't been spotted yet. */
    dormant: boolean;
    hidden: boolean;
    /** The boss's armoured front and charged blast (M5.6); 0 and null for everyone else. */
    front: -1 | 0 | 1;
    charging: Point | null;
  }[];
  selected: string | null;
  /** Tiles the selected unit can move to now. */
  reachable: MoveTile[];
  /** Aliens the selected marine could shoot now (in range and in sight). */
  shootable: string[];
  /** Effect sprites made so far: they are reused, so this stays small. */
  fxSprites: number;
  /** Effects shown so far (bullets, hits, deaths, blasts). */
  fxUses: number;
  /** True while an animation plays; clicks are ignored. */
  busy: boolean;
  /** The alien the selected marine is aiming at, waiting for the player to confirm. */
  aimTarget: string | null;
  /** The odds of that shot, as the breakdown panel shows them. */
  aimOdds: ShotOdds | null;
  lastShot: BattleState['lastShot'];
  turn: Side;
  round: number;
  /** What a map click does now: move (or aim), or throw a grenade. */
  mode: 'move' | 'grenade';
  /** True once one side has been wiped out. */
  over: boolean;
}

/** Draw order: ground, dirt, markers, then everything standing, sorted by its bottom edge. */
/** Margin inside the phone's side panel. */
const SIDE_PAD = 5;
/** The selected marine's portrait (M6.2): its gap from the panel's edge and from the text. */
const PORTRAIT_GAP = 4;
/** Extra height for the side panel's buttons: bigger targets for a finger. */
const SIDE_BUTTON_EXTRA = 6;

/** The colour of the HUD's map line. */
const MAP_LINE_COLOR = 0xa3adbd;

const DEPTH = {
  ground: 0,
  decal: 1,
  range: 2,
  marker: 3,
  path: 4,
  // Fog shades the ground and markers; standing pictures are shaded by tint (see refreshVision).
  fog: 9,
  standing: 10,
  ghost: 900,
  overlay: 950,
  fx: 960,
  hud: 1000,
} as const;

/** A marine's rank and name for the status line, e.g. 'CPL REYES'. */
const marineLabel = (u: Unit): string => `${rankOf(u.rank).short} ${u.name.toUpperCase()}`;

/**
 * Fog of war. Tiles out of sight get a dark layer (more opaque if never seen); props
 * out of sight get the matching tint, which multiplies their colours by about 1 - alpha.
 */
const FOG = {
  color: 0x05070f,
  explored: 0.45,
  unseen: 0.72,
  exploredTint: 0x8c8c8c,
  unseenTint: 0x474747,
} as const;

/** Each kind's main sheet: its idle pose, height and muzzle. */
const SHEETS = BASE_SHEETS;

/** Alien attacks' effects are tinted green. */
const ALIEN_FX_TINT = 0x8bf06a;
/** Pixels a unit without a hurt animation jolts away from a hit. */
const FLINCH_PX = 2;
/** Pixels a dying flyer falls as it fades. */
const FLYER_DROP = 8;

/** The tongue as drawn, and how long its parts take. */
const TONGUE = { color: 0xd8326e, tip: 0xff7aa8, outMs: 160, dragMs: 260 } as const;

/** True when a sprite drawn from `sheet` must be mirrored to face `facing`. */
function mirrored(sheet: CharacterSheet, facing: 1 | -1): boolean {
  return (facing === -1) !== (sheet.facesLeft ?? false);
}
const GHOST_COLOR = { marine: 0x7fd4ff, alien: 0xff6a5a } as const;
/** A unit counts as hidden when a standing object in front covers this much of its body. */
const HIDDEN_OVERLAP = 0.3;

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  ghost: Phaser.GameObjects.Sprite;
  /** The sheet the current animation comes from (sets the feet position). */
  sheet: CharacterSheet;
  hidden: boolean;
  /** Health as drawn: it catches up with the state when a shot lands, not when it's fired. */
  shownHp: number;
  /** True while the unit runs along a path (its cover isn't settled yet). */
  moving: boolean;
  /** Overwatch as drawn: it ends when the reaction shot is shown, not when it's rolled. */
  watching: boolean;
  /** Exposure as drawn: it starts when the blast is shown. */
  exposed: boolean;
  /** Poison as drawn: it starts when the venom lands. */
  poisoned: boolean;
}

export class BattleScene extends Phaser.Scene {
  private seed = DEFAULT_SEED;
  private seeds!: Rng;
  private state!: BattleState;
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private props: Phaser.GameObjects.Image[] = [];
  /** Each prop's footprint tiles, in the same order as `props`. */
  private propTiles: number[][] = [];
  private views = new Map<string, UnitView>();
  private marker!: Phaser.GameObjects.Graphics;
  private chevron!: Phaser.GameObjects.Graphics;
  private rangeLayer!: Phaser.GameObjects.Graphics;
  /** The red squares where the boss's charged blast will land (M5.6). */
  private chargeLayer!: Phaser.GameObjects.Graphics;
  private pathLayer!: Phaser.GameObjects.Graphics;
  /** Cover shields for the hovered tile, drawn above units and trees. */
  private coverLayer!: Phaser.GameObjects.Graphics;
  private busy = false;
  /** The alien turn is playing at ANIMATION.fastForward speed (M5.11). */
  private fast = false;
  /** A skirmish started with ?boss=1 (M5.6). */
  private skirmishBoss = false;
  /** The HUD has explained the boss's charge once this battle (M5.6). */
  private chargeExplained = false;
  /** That explanation, shown in the HUD until the blast goes off (empty: none). */
  private chargeHint = '';
  private pips!: Phaser.GameObjects.Graphics;
  /** Reused sprites for hits, deaths, blasts and projectiles. */
  private fx!: FxPool;
  private aimLayer!: Phaser.GameObjects.Graphics;
  private aimText!: PixelText;
  /** The hit-chance breakdown shown while aiming. */
  private oddsPanel!: PixelText;
  /** Locked target: the next click on it, or Enter, fires. */
  private aimTarget: string | null = null;
  private mapText!: PixelText;
  /** The map line, longest first: the longest that fits beside the buttons is shown. */
  private mapLines: string[] = [];
  private unitText!: PixelText;
  /** The sound button (SND/OFF) by the ? button; M does the same. */
  private muteButton!: PixelButton;
  /** The selected marine's portrait, left of the info bar (or atop the side panel). */
  private portrait!: Phaser.GameObjects.Image;
  private endTurnButton!: PixelButton;
  private reloadButton!: PixelButton;
  private overwatchButton!: PixelButton;
  private grenadeButton!: PixelButton;
  private fogLayer!: Phaser.GameObjects.Graphics;
  /** Tiles the squad sees now, and every tile it has ever seen this battle. */
  private vision = new Set<number>();
  private explored = new Set<number>();
  /** What a click on the map does for the selected marine. */
  private mode: 'move' | 'grenade' = 'move';
  /** Set when one side has been wiped out; only a new map can follow. */
  private over = false;
  /** The landscape the battles here are fought in. */
  private landscape: LandscapeId = 'forest';
  /** The campaign this battle is a mission of, or null for a one-off skirmish (?seed=). */
  private campaign: Campaign | null = null;
  /** Touch: the tile tapped once, whose preview is showing; tapping it again acts. */
  private pending: Point | null = null;
  /** This battle was started with REPLAY: it earns no XP. */
  private replaying = false;

  constructor() {
    super('Battle');
  }

  create(data: {
    seed?: number;
    campaign?: Campaign;
    resume?: BattleState;
    replay?: boolean;
  }): void {
    this.fx = new FxPool(this);
    this.campaign = data.campaign ?? null;
    this.seed = this.campaign?.mapSeed ?? data.seed ?? initialSeed();
    // A campaign mission's landscape, or ?landscape=town for a skirmish (unknown: forest).
    this.landscape = this.campaign
      ? currentMission(this.campaign).landscape
      : (landscapeId(urlWord('landscape')) ?? 'forest');
    // ?boss=1 adds the final mission's boss and two escort groups to a skirmish (M5.6).
    this.skirmishBoss = !this.campaign && urlWord('boss') === '1';
    this.seeds = createRng(this.seed);
    this.createHud();
    // Help for touchscreens, which have no H key. The top-right corner is always the
    // tree line, never a tile to move to.
    new PixelButton(this, MAP_WIDTH - 10, 10, '?', () => this.openHelp(), false).setDepth(
      DEPTH.hud,
    );
    // Sound on or off (M6.1), beside it on the same edge row; M does the same (see onKey).
    const mute = new PixelButton(
      this,
      MAP_WIDTH - 37,
      10,
      soundLabel(),
      () => mute.setLabel(soundLabel(toggleMute(this))),
      false,
    ).setDepth(DEPTH.hud);
    this.muteButton = mute;
    this.marker = this.add.graphics().setDepth(DEPTH.marker);
    this.rangeLayer = this.add.graphics().setDepth(DEPTH.range);
    // Over the fog, so the warning shows wherever it lands.
    this.chargeLayer = this.add.graphics().setDepth(DEPTH.fog + 0.5);
    this.pathLayer = this.add.graphics().setDepth(DEPTH.path);
    this.coverLayer = this.add.graphics().setDepth(DEPTH.overlay + 1);
    this.fogLayer = this.add.graphics().setDepth(DEPTH.fog);
    this.chevron = this.add.graphics().setDepth(DEPTH.overlay + 1);
    this.pips = this.add.graphics().setDepth(DEPTH.overlay);
    this.aimLayer = this.add.graphics().setDepth(DEPTH.overlay + 2);
    this.aimText = new PixelText(this, 0, 0, '', {
      color: 0xf2a33a,
      valign: 'bottom',
      background: 0x11141b,
      padding: 2,
    })
      .setDepth(DEPTH.overlay + 3)
      .setVisible(false);
    this.oddsPanel = new PixelText(this, 0, 0, '', {
      align: 'left',
      valign: 'top',
      background: 0x11141b,
      padding: 4,
    })
      .setDepth(DEPTH.hud)
      .setVisible(false);
    this.tweens.add({ targets: this.chevron, y: -2, duration: 450, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: this.marker, alpha: 0.45, duration: 450, yoyo: true, repeat: -1 });

    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        // A press on a button (the ? over the map) is the button's, not the map's.
        if (over.length === 0) this.onClick(p.worldX, p.worldY, p.wasTouch);
        else if (this.busy && this.state.turn === 'alien') this.toggleFast();
      },
    );
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p.worldX, p.worldY));
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.aimTarget && !this.busy) this.fire(this.aimTarget);
    });
    this.input.keyboard?.on('keydown-E', () => void this.endTurn());
    this.input.keyboard?.on('keydown-R', () => this.reload());
    this.input.keyboard?.on('keydown-O', () => this.overwatch());
    // Selection shortcuts: Tab / Shift+Tab cycle through marines that can still act,
    // 1-4 pick one directly, F aims at the best target and then the next. They use a
    // plain browser listener so they run in the order pressed: through Phaser's key
    // queue Firefox sometimes lost Shift, and mixing the two reordered quick presses.
    // G, M and Esc are here too: they toggle and undo, so a press handled twice (Phaser
    // hands queued key events over again when frames stall) would cancel itself out.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') e.preventDefault(); // keep the browser's focus where it is
      // Paused under the help screen (or stopped): keys belong to whatever is on top.
      if (!this.scene.isActive()) return;
      if ((e.key === 'h' || e.key === 'H') && !e.repeat) {
        this.openHelp();
        return;
      }
      if ((e.key === 'm' || e.key === 'M') && !e.repeat) {
        // Sound on or off: any time, the aliens' turn included.
        this.muteButton.setLabel(soundLabel(toggleMute(this)));
        return;
      }
      if (e.key === 'Escape') {
        // Its own checks: it also works while the aliens move (it just does nothing).
        this.onEscape();
        return;
      }
      if (e.key === ' ' && !e.repeat && this.busy && this.state.turn === 'alien') {
        e.preventDefault();
        this.toggleFast();
        return;
      }
      if (this.busy || this.state.turn !== 'marine') return;
      if (e.key === 'g' || e.key === 'G') {
        if (!e.repeat) this.toggleGrenade(); // holding G doesn't flicker on and off
        return;
      }
      if (e.key === 'Tab') {
        const next = nextReadyMarine(this.state, this.state.selected, e.shiftKey ? -1 : 1);
        if (next) this.selectMarine(next);
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        const marine = this.state.units.filter((u) => u.side === 'marine')[Number(e.key) - 1];
        if (marine) this.selectMarine(marine.id);
      } else if (e.key === 'f' || e.key === 'F') {
        this.cycleTarget();
      }
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      window.removeEventListener('keydown', onKey),
    );
    this.input.keyboard?.on('keydown-N', () => {
      // A new map: skirmish only (a campaign moves on through the debrief). Not in the
      // middle of an animation, the alien turn, or the result screen.
      if (!this.busy && !this.campaign)
        this.startBattle(this.seeds.int(1, 999_999), undefined, false);
    });
    this.events.on('play-again', () =>
      this.startBattle(this.seeds.int(1, 999_999), undefined, false),
    );
    // The same map again (M4.4): its seed rebuilds it exactly, units and all.
    // A replayed battle earns no XP (owner decision 2026-10-18).
    this.events.on('replay', () => this.startBattle(this.state.map.seed, undefined, true));
    // The scene object is reused when the player comes back from the title.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('play-again');
      this.events.off('replay');
    });

    this.startBattle(this.seed, data.resume, data.replay ?? false);
  }

  override update(): void {
    // Ghosts copy their unit's current animation frame.
    for (const v of this.views.values()) {
      if (v.hidden) v.ghost.setTexture(v.sprite.texture.key, v.sprite.frame.name);
    }
    // Health pips follow their units, including while they run.
    this.pips.clear();
    for (const u of this.state.units) {
      const v = this.views.get(u.id);
      if (!v || v.shownHp <= 0 || !v.sprite.visible) continue;
      const top = v.sprite.y - SHEETS[u.kind].height - 5;
      const color = u.side === 'marine' ? 0x8bf06a : 0xff6a5a;
      drawPips(this.pips, v.sprite.x, top, v.shownHp, u.maxHp, color);
      if (v.exposed) {
        const width = u.maxHp * 4 - 1;
        drawExposed(this.pips, Math.round(v.sprite.x + width / 2) + 2, top - 3);
      }
      if (v.watching) {
        const width = u.maxHp * 4 - 1;
        drawEye(this.pips, Math.round(v.sprite.x - width / 2) - 10, top - 2);
      }
      if (v.poisoned) {
        // Left of the pips, past the overwatch eye if there is one.
        const width = u.maxHp * 4 - 1;
        drawPoison(this.pips, Math.round(v.sprite.x - width / 2) - (v.watching ? 17 : 7), top - 3);
      }
      if (u.side === 'marine' && !v.moving) {
        // Cover against the nearest alien, shown next to the pips.
        const enemy = livingUnits(this.state, 'alien').reduce<Unit | null>(
          (best, a) =>
            !best || Math.hypot(a.x - u.x, a.y - u.y) < Math.hypot(best.x - u.x, best.y - u.y)
              ? a
              : best,
          null,
        );
        const cover = enemy && !v.exposed ? coverAgainst(this.state.map, u, enemy) : null;
        const width = u.maxHp * 4 - 1;
        if (cover)
          drawShield(this.pips, Math.round(v.sprite.x + width / 2) + 2, top - 3, cover === 'full');
      }
    }
  }

  snapshot(): GameSnapshot {
    const { map, units, selected } = this.state;
    return {
      seed: this.seed,
      campaign: this.campaign
        ? {
            mission: this.campaign.mission,
            attempt: this.campaign.attempt,
            xp: [...this.campaign.xp],
            deaths: [...this.campaign.deaths],
            supply: this.campaign.supply,
          }
        : null,
      replaying: this.replaying,
      fast: this.fast,
      prompt: this.unitText.text,
      pending: this.pending,
      mapSeed: map.seed,
      layout: map.tiles.map((t) => (t.prop ? t.prop[0] : '.')).join(''),
      units: units.map((u) => ({
        id: u.id,
        side: u.side,
        x: u.x,
        y: u.y,
        hp: u.hp,
        ap: u.ap,
        ammo: u.ammo,
        overwatch: u.overwatch,
        grenades: u.grenades,
        exposed: u.exposed,
        kind: u.kind,
        name: u.name,
        poison: u.poison,
        freeSteps: u.freeSteps,
        rank: u.rank,
        maxHp: u.maxHp,
        seen: this.isSeen(u),
        dormant: u.dormant,
        front: u.front,
        charging: u.charging ? { x: u.charging.x, y: u.charging.y } : null,
        hidden: this.views.get(u.id)?.hidden ?? false,
      })),
      selected,
      reachable: selected ? this.rangeTiles(selected) : [],
      shootable: selected
        ? livingUnits(this.state, 'alien')
            .filter((a) => hitChance(this.state, selected, a.id) !== null)
            .map((a) => a.id)
        : [],
      fxSprites: this.fx.size,
      fxUses: this.fx.uses,
      busy: this.busy,
      aimTarget: this.aimTarget,
      aimOdds: this.aimTarget && selected ? shotOdds(this.state, selected, this.aimTarget) : null,
      lastShot: this.state.lastShot,
      turn: this.state.turn,
      mode: this.mode,
      round: this.state.round,
      over: this.over,
    };
  }

  /** Tiles the unit can move to now, with the action points each move costs (2 = dash). */
  private rangeTiles(unitId: string): MoveTile[] {
    const unit = unitById(this.state, unitId);
    if (!unit) return [];
    const cols = this.state.map.cols;
    return [...moveRange(this.state, unitId)].map(([k, steps]) => ({
      x: k % cols,
      y: Math.floor(k / cols),
      cost: moveCost(unit, steps),
    }));
  }

  private dispatch(action: Action): void {
    const next = apply(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.drawSelection();
  }

  /**
   * A click or tap on the map. A mouse click acts at once. A tap on a touchscreen,
   * which has no hover, first shows what a click would do there (the path, its cost and
   * the cover, or the grenade's blast); tapping the same tile again does it.
   */
  private onClick(px: number, py: number, touch = false): void {
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    if (this.busy) {
      // A click or tap anywhere during the alien turn speeds it up, or slows it again.
      if (this.state.turn === 'alien') this.toggleFast();
      return;
    }
    if (y >= MAP_ROWS) return;
    // A second tap near the previewed tile confirms it: fingers are wider than tiles.
    const pending = this.pending;
    const near = (p: Point): boolean =>
      Math.abs(px - (p.x + 0.5) * TILE) <= TILE / 2 + TOUCH.confirmSlop &&
      Math.abs(py - (p.y + 0.5) * TILE) <= TILE / 2 + TOUCH.confirmSlop;
    const previewed =
      pending !== null && (touch ? near(pending) : pending.x === x && pending.y === y);
    this.pending = null;
    if (this.mode === 'grenade') {
      if (touch && !previewed) this.preview(px, py);
      else this.throwAt(previewed && pending ? pending : { x, y });
      return;
    }
    if (touch && previewed && pending && this.state.selected) {
      this.moveUnit(this.state.selected, pending);
      return;
    }
    const unit = this.unitUnderPointer(x, y);
    if (unit?.side === 'marine') {
      this.selectMarine(unit.id);
      return;
    }
    if (unit?.side === 'alien') {
      // First click aims, second click on the same alien fires.
      if (this.aimTarget === unit.id) this.fire(unit.id);
      else if (this.canShoot(unit.id)) {
        this.aimTarget = unit.id;
        this.drawSelection();
      }
      return;
    }
    const selected = this.state.selected;
    if (selected && !unitAt(this.state, x, y)) {
      this.aimTarget = null;
      if (touch && !previewed) {
        this.drawSelection();
        this.preview(px, py);
        return;
      }
      this.moveUnit(selected, { x, y });
    }
  }

  /** Touch: shows what tapping (px, py) again would do, and remembers the tile. */
  private preview(px: number, py: number): void {
    this.onHover(px, py);
    this.pending = { x: Math.floor(px / TILE), y: Math.floor(py / TILE) };
  }

  /** The help screen over the paused battle (H, or the ? button). */
  private openHelp(): void {
    if (this.over || !this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch('Help', { from: 'Battle' });
  }

  /**
   * The unit a click or hover on tile (x, y) means. Characters stand about two tiles
   * tall, so the tile above a unit counts as its head, unless the selected marine can
   * move to that tile, in which case the tile wins (so squadmates don't block it).
   */
  private unitUnderPointer(x: number, y: number): Unit | undefined {
    const seenAt = (px: number, py: number): Unit | undefined => {
      const u = unitAt(this.state, px, py);
      return u && this.isSeen(u) ? u : undefined;
    };
    const here = seenAt(x, y);
    if (here) return here;
    const selected = this.state.selected;
    if (selected && pathFor(this.state, selected, { x, y })) return undefined;
    return seenAt(x, y + 1);
  }

  private onEscape(): void {
    if (this.busy) return;
    this.pending = null;
    if (this.mode === 'grenade') {
      this.mode = 'move';
      this.pathLayer.clear();
      this.drawSelection();
      return;
    }
    if (this.aimTarget) this.aimTarget = null;
    else this.dispatch({ type: 'deselect' });
    this.drawSelection();
  }

  /** True if the selected marine could shoot this unit now. */
  private canShoot(targetId: string): boolean {
    const id = this.state.selected;
    return id !== null && hitChance(this.state, id, targetId) !== null;
  }

  /** Previews the path to the tile under the pointer, or the shot at the alien under it. */
  private onHover(px: number, py: number): void {
    const g = this.pathLayer.clear();
    this.coverLayer.clear();
    const id = this.state.selected;
    if (!id || this.busy) return;
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    if (this.mode === 'grenade') {
      this.drawBlast(id, { x, y });
      return;
    }
    if (!this.aimTarget) {
      const alien = this.unitUnderPointer(x, y);
      this.drawAim(alien?.side === 'alien' ? alien.id : null);
      if (alien?.side === 'alien') return;
    }
    const path = y < MAP_ROWS ? pathFor(this.state, id, { x, y }) : null;
    if (!path) return;
    const mover = unitById(this.state, id);
    const dash = mover !== undefined && moveCost(mover, path.length) > 1;
    const color = dash ? 0xffd23a : 0xdff1ff;
    g.fillStyle(color, 0.9);
    for (const p of path.slice(0, -1)) g.fillRect(p.x * TILE + 7, p.y * TILE + 7, 2, 2);
    g.lineStyle(1, color, 1).strokeRect(x * TILE + 1.5, y * TILE + 1.5, TILE - 3, TILE - 3);
    // Shields on each side of the tile that has cover.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const prop = tileAt(this.state.map, x + dx, y + dy)?.prop;
      if (prop == null) continue;
      const sx = x * TILE + 4 + dx * 9;
      const sy = y * TILE + 4 + dy * 9;
      drawShield(this.coverLayer, sx, sy, PROPS[prop].cover === 'full');
    }
  }

  /** Player move: apply it, then run the sprite along the path. */
  private moveUnit(unitId: string, to: Point): void {
    const next = apply(this.state, { type: 'move', unitId, to });
    const moved = next.lastMove;
    if (next === this.state || !moved) return;
    this.state = next;
    void this.run(async () => {
      await this.playMove(moved);
      await this.playSighting(moved.spotted, moved.scampers);
    });
  }

  /** Player shot at the aimed target. */
  private fire(targetId: string): void {
    const shooterId = this.state.selected;
    if (!shooterId) return;
    const next = apply(this.state, { type: 'shoot', unitId: shooterId, targetId });
    const shot = next.lastShot;
    if (next === this.state || !shot) return;
    this.state = next;
    this.aimTarget = null;
    this.drawAim(null);
    void this.run(() => this.playShot(shot));
  }

  /**
   * Works out what the squad sees (from where the marines stand, or from `eyes` while
   * one is part-way along a run), then redraws the fog and shows or hides aliens.
   */
  private refreshVision(eyes?: Point[]): void {
    this.vision = eyes ? tilesSeenFrom(this.state.map, eyes) : visibleTiles(this.state, 'marine');
    for (const k of this.vision) this.explored.add(k);
    const { cols, rows } = this.state.map;
    // The fog lies on the ground, under everything standing, so a tall picture (a roof,
    // a treetop) never gets a fogged square from a tile it hangs over. Seen before:
    // dimmed. Never seen: darker.
    const g = this.fogLayer.clear();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = y * cols + x;
        if (this.vision.has(k)) continue;
        g.fillStyle(FOG.color, this.explored.has(k) ? FOG.explored : FOG.unseen).fillRect(
          x * TILE,
          y * TILE,
          TILE,
          TILE,
        );
      }
    }
    // Props are shaded whole, like the best-seen tile of their footprint.
    this.props.forEach((img, i) => {
      const tiles = this.propTiles[i] ?? [];
      if (tiles.some((k) => this.vision.has(k))) img.clearTint();
      else img.setTint(tiles.some((k) => this.explored.has(k)) ? FOG.exploredTint : FOG.unseenTint);
    });
    this.updateAlienVisibility();
  }

  /** Aliens are drawn only while they stand on a tile the squad can see. */
  private updateAlienVisibility(): void {
    const cols = this.state.map.cols;
    for (const u of this.state.units) {
      if (u.side !== 'alien') continue;
      const v = this.views.get(u.id);
      if (!v) continue;
      // Where the sprite is now (it may be part-way along a move); any tile of it counts.
      const at = tileUnder(u.kind, v.sprite);
      const seen = footprint({ kind: u.kind, ...at }).some((t) =>
        this.vision.has(t.y * cols + t.x),
      );
      v.sprite.setVisible(seen);
      if (!seen) v.ghost.setVisible(false);
    }
  }

  /** True if the squad can see this unit now (marines always see themselves). */
  private isSeen(unit: Unit): boolean {
    const cols = this.state.map.cols;
    return unit.side === 'marine' || footprint(unit).some((t) => this.vision.has(t.y * cols + t.x));
  }

  /** Selects a marine (if the rules allow), leaving any aim or grenade mode. */
  private selectMarine(unitId: string): void {
    this.pending = null;
    this.aimTarget = null;
    this.mode = 'move';
    this.pathLayer.clear();
    this.coverLayer.clear();
    const before = this.state.selected;
    this.dispatch({ type: 'select', unitId });
    if (this.state.selected !== before) playSound(this, 'select');
    this.drawSelection();
  }

  /** Aims at the best shootable alien, or the next one if already aiming. */
  private cycleTarget(): void {
    const id = this.state.selected;
    if (!id || this.busy) return;
    const targets = shootableTargets(this.state, id);
    if (targets.length === 0) return;
    const at = this.aimTarget ? targets.indexOf(this.aimTarget) : -1;
    this.aimTarget = targets[(at + 1) % targets.length] ?? null;
    this.mode = 'move';
    this.pathLayer.clear();
    this.drawSelection();
  }

  /** Switches the selected marine between moving and aiming a grenade. */
  private toggleGrenade(): void {
    const id = this.state.selected;
    if (this.busy || !id) return;
    if (this.mode === 'grenade') this.mode = 'move';
    else if (canThrow(this.state, id)) this.mode = 'grenade';
    this.pending = null;
    this.aimTarget = null;
    this.drawAim(null);
    this.pathLayer.clear();
    this.coverLayer.clear();
    this.drawSelection();
  }

  /** The 3 x 3 blast preview under the pointer, if the tile is in throwing range. */
  private drawBlast(unitId: string, at: Point): void {
    const g = this.pathLayer.clear();
    if (!inThrowRange(this.state, unitId, at)) return;
    for (let y = at.y - 2; y <= at.y + 2; y++) {
      for (let x = at.x - 2; x <= at.x + 2; x++) {
        if (Math.hypot(x - at.x, y - at.y) > GRENADE.radius) continue;
        g.fillStyle(0xff5a4a, 0.35).fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
    g.lineStyle(1, 0xffd23a, 1).strokeRect(
      at.x * TILE + 1.5,
      at.y * TILE + 1.5,
      TILE - 3,
      TILE - 3,
    );
  }

  /** Throws the selected marine's grenade at a tile. */
  private throwAt(at: Point): void {
    const id = this.state.selected;
    if (!id) return;
    const next = apply(this.state, { type: 'throw', unitId: id, at });
    const thrown = next.lastThrow;
    if (next === this.state || !thrown) return;
    this.state = next;
    this.mode = 'move';
    void this.run(() => this.playThrow(thrown));
  }

  /** The grenade arcs to the tile, explodes, and everyone caught takes damage. */
  private async playThrow(thrown: ThrowResult): Promise<void> {
    const thrower = unitById(this.state, thrown.unitId);
    const tv = this.views.get(thrown.unitId);
    if (!thrower || !tv) return;
    this.face(tv, thrower.facing);
    const sheet = SHEETS[thrower.kind];
    const from = { x: tv.sprite.x + thrower.facing * 6, y: tv.sprite.y - sheet.muzzle.y - 4 };
    const to = { x: thrown.at.x * TILE + TILE / 2, y: thrown.at.y * TILE + TILE / 2 };
    const peak = 24 + Math.hypot(to.x - from.x, to.y - from.y) / 6;
    const ball = this.add.graphics().setDepth(DEPTH.fx);
    ball.fillStyle(0x11141b, 1).fillRect(-2, -2, 4, 4);
    ball.fillStyle(0x6f8f3a, 1).fillRect(-1, -1, 2, 2);
    ball.setPosition(from.x, from.y);
    playSound(this, 'throw');
    const flight = { t: 0 };
    await new Promise<void>((resolve) =>
      this.tweens.add({
        targets: flight,
        t: 1,
        duration: 450,
        onUpdate: () => {
          const t = flight.t;
          ball.setPosition(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * peak,
          );
        },
        onComplete: () => resolve(),
      }),
    );
    ball.destroy();
    this.fx.play(EFFECTS.blast.key, to.x, to.y, DEPTH.fx, { scale: 2 });
    playSound(this, 'explosion');
    this.cameras.main.shake(160, 0.006);
    // The cover it wrecked goes up with it (M5.13).
    if (thrown.wrecks.length > 0) this.redrawMap();
    for (const hit of thrown.hits) {
      const unit = unitById(this.state, hit.unitId);
      const view = this.views.get(hit.unitId);
      if (!unit || !view) continue;
      this.showDamage(view, unit, hit.damage, hit.hpAfter, hit.killed, false, to);
      view.exposed = !hit.killed;
    }
    await new Promise((resolve) => this.time.delayedCall(700, resolve));
    await this.playSighting([], thrown.scampers);
  }

  /**
   * The boss starts charging (M5.6): the squares it will hit go red, and the first time
   * the HUD says what to do about it.
   */
  private async playCharge(): Promise<void> {
    this.drawCharge();
    playSound(this, 'charge');
    await this.banner('OVERSEER CHARGING', '#ff6a5a');
    if (!this.chargeExplained) {
      this.chargeExplained = true;
      this.chargeHint = 'It fires next turn: leave the red squares';
    }
  }

  /** The boss's charged blast goes off over the red squares (M5.6). */
  private async playBlast(blast: BlastResult): Promise<void> {
    const at = { x: blast.at.x * TILE + TILE / 2, y: blast.at.y * TILE + TILE / 2 };
    // The red squares and the HUD's warning go as it fires.
    this.drawCharge();
    this.layoutButtons();
    for (const [dx, dy] of [
      [0, 0],
      [-1, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
    ] as const) {
      this.fx.play(EFFECTS.blast.key, at.x + dx * TILE, at.y + dy * TILE, DEPTH.fx, { scale: 2 });
    }
    playSound(this, 'blast');
    this.cameras.main.shake(260, 0.01);
    for (const hit of blast.hits) {
      const unit = unitById(this.state, hit.unitId);
      const view = this.views.get(hit.unitId);
      if (!unit || !view) continue;
      this.showDamage(view, unit, hit.damage, hit.hpAfter, hit.killed, false, at);
      view.exposed = !hit.killed;
    }
    await new Promise((resolve) => this.time.delayedCall(800, resolve));
  }

  /** Red squares wherever a living boss's charged blast will land. */
  private drawCharge(): void {
    const g = this.chargeLayer.clear();
    for (const u of this.state.units) {
      if (u.hp <= 0 || !u.charging) continue;
      const r = Math.floor(BOSS.blast.radius);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = u.charging.x + dx;
          const y = u.charging.y + dy;
          if (Math.hypot(dx, dy) > BOSS.blast.radius) continue;
          if (x < 0 || y < 0 || x >= this.state.map.cols || y >= this.state.map.rows) continue;
          g.fillStyle(0xff3a2a, 0.28).fillRect(x * TILE, y * TILE, TILE, TILE);
          g.lineStyle(1, 0xff6a5a, 0.9).strokeRect(
            x * TILE + 0.5,
            y * TILE + 0.5,
            TILE - 1,
            TILE - 1,
          );
        }
      }
    }
  }

  /** Puts the selected marine on overwatch: uses its remaining action points. */
  private overwatch(): void {
    const id = this.state.selected;
    if (!id || this.busy) return;
    const next = apply(this.state, { type: 'overwatch', unitId: id });
    if (next === this.state) return;
    this.state = next;
    this.aimTarget = null;
    this.drawAim(null);
    void this.run(() => this.playOverwatch(id));
  }

  /** A side's turn has begun, so its overwatch is over: markers go, crouching marines stand. */
  private endWatch(side: Side): void {
    for (const u of livingUnits(this.state, side)) {
      const v = this.views.get(u.id);
      if (!v?.watching) continue;
      v.watching = false;
      if (u.kind === 'marine') this.playAnim(v, u.kind, 'idle', u.facing);
    }
  }

  /** "OVERWATCH" over the unit; marines crouch while they watch. */
  private playOverwatch(unitId: string): Promise<void> {
    const unit = unitById(this.state, unitId);
    const view = this.views.get(unitId);
    if (!unit || !view) return Promise.resolve();
    view.watching = true;
    if (unit.kind === 'marine') view.sprite.play(`${MARINE_SHEET.key}-crouch`);
    const headY = view.sprite.y - SHEETS[unit.kind].height;
    playSound(this, 'overwatch');
    floatText(this, view.sprite.x, headY - 6, 'OVERWATCH', '#ffd23a', DEPTH.fx);
    return new Promise((resolve) => this.time.delayedCall(500, resolve));
  }

  /** Reloads the selected marine: costs one action point. */
  private reload(): void {
    const id = this.state.selected;
    if (!id || this.busy) return;
    const next = apply(this.state, { type: 'reload', unitId: id });
    if (next === this.state) return;
    this.state = next;
    this.aimTarget = null;
    this.drawAim(null);
    void this.run(() => this.playReload(id));
  }

  /** A short crouch and a "RELOADED" note; the marine pack has no reload animation. */
  private playReload(unitId: string): Promise<void> {
    const unit = unitById(this.state, unitId);
    const view = this.views.get(unitId);
    if (!unit || !view) return Promise.resolve();
    view.sprite.play(`${MARINE_SHEET.key}-crouch`);
    const headY = view.sprite.y - SHEETS[unit.kind].height;
    playSound(this, 'reload');
    floatText(this, view.sprite.x, headY - 6, 'RELOADED', '#dfe4ec', DEPTH.fx);
    return new Promise((resolve) => {
      this.time.delayedCall(500, () => {
        this.playAnim(view, unit.kind, 'idle', unit.facing);
        resolve();
      });
    });
  }

  /** Plays an animation with input locked, then hands control back (or ends the turn). */
  private async run(animation: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.pathLayer.clear();
    this.coverLayer.clear();
    this.drawSelection();
    await animation();
    this.busy = false;
    this.refreshVision();
    this.updateHidden();
    this.drawSelection();
    if (this.checkEnd()) return;
    // Like XCOM, the turn ends by itself once no marine can do anything; otherwise a
    // marine who has run out of actions hands over to the next one who hasn't.
    if (this.state.turn !== 'marine') return;
    if (!canAct(this.state, 'marine')) {
      void this.endTurn();
      return;
    }
    const sel = this.state.selected ? unitById(this.state, this.state.selected) : undefined;
    if (sel && !hasActions(sel)) {
      const next = nextReadyMarine(this.state, sel.id);
      if (next) this.selectMarine(next);
    }
  }

  /** Ends the marines' turn, plays every alien's actions, then starts the next round. */
  /**
   * Fast-forward (M5.11): the alien turn's tweens, timers and sprite animations run
   * ANIMATION.fastForward times faster. Rules are untouched: only the playback speeds up.
   */
  private setFast(on: boolean): void {
    this.fast = on;
    const scale = on ? ANIMATION.fastForward : 1;
    this.tweens.timeScale = scale;
    this.time.timeScale = scale;
    this.anims.globalTimeScale = scale;
    if (this.busy && this.state.turn === 'alien') this.unitText.setText(this.fastHint());
  }

  private toggleFast(): void {
    this.setFast(!this.fast);
  }

  /** The unit line during the alien turn: how to speed it up, or slow it down again. */
  private fastHint(): string {
    return this.fast
      ? 'Fast forward   Space or tap: normal'
      : 'Alien turn   Space or tap: fast forward';
  }

  private async endTurn(): Promise<void> {
    if (this.busy || this.state.turn !== 'marine') return;
    this.mode = 'move';
    this.pending = null;
    this.aimTarget = null;
    this.drawAim(null);
    this.state = apply(this.state, { type: 'endTurn' });
    this.busy = true;
    this.pathLayer.clear();
    this.coverLayer.clear();
    this.drawSelection();
    this.endWatch('alien');
    await this.banner('ALIEN ACTIVITY', '#ff6a5a');

    for (const alien of livingUnits(this.state, 'alien')) {
      // Each action costs at least one point, so this always ends.
      for (let i = 0; i < ACTION_POINTS; i++) {
        const action = planAlienAction(this.state, alien.id);
        if (!action) break;
        const before = this.state;
        const next = apply(before, action);
        if (next === before) break;
        this.state = next;
        if (action.type === 'move' && next.lastMove) {
          await this.playMove(next.lastMove);
        } else if (action.type === 'shoot' && next.lastShot) {
          await this.playShot(next.lastShot);
        } else if (action.type === 'overwatch') {
          await this.playOverwatch(alien.id);
        } else if (action.type === 'charge') {
          await this.playCharge();
        } else if (action.type === 'blast' && next.lastBlast) {
          await this.playBlast(next.lastBlast);
        }
        this.updateAlienVisibility();
        this.updateHidden();
      }
    }

    if (this.checkEnd()) {
      this.setFast(false);
      return;
    }
    this.state = apply(this.state, { type: 'endTurn' });
    this.endWatch('marine');
    this.refreshVision();
    await this.banner(`TURN ${this.state.round}`, '#f2a33a');
    await this.playPoison();
    if (this.campaign) writeSave(this.campaign, this.state, this.replaying);
    this.setFast(false);
    this.busy = false;
    const first = nextReadyMarine(this.state, null);
    if (first) this.selectMarine(first);
    this.updateHidden();
    this.drawSelection();
  }

  /** If one side is wiped out, locks the battle and opens the result screen. */
  private checkEnd(): boolean {
    // The rules decide (M5.6: the boss's death wins the battle, escorts or not).
    const outcome = battleOutcome(this.state);
    const won = outcome === 'won';
    const lost = outcome === 'lost';
    if (!won && !lost) return false;
    this.over = true;
    this.busy = true;
    this.aimTarget = null;
    this.drawAim(null);
    this.drawSelection();
    const dead = (side: Side): number =>
      this.state.units.filter((u) => u.side === side && u.hp <= 0).length;
    const result: BattleResult = {
      won,
      rounds: this.state.round,
      aliensKilled: dead('alien'),
      marinesLost: dead('marine'),
      mapSeed: this.state.map.seed,
      landscape: this.landscape,
      campaign: this.campaign,
      xp: null,
      lost: this.state.units.filter((u) => u.side === 'marine' && u.hp <= 0).map((u) => u.name),
    };
    if (this.campaign) {
      // XP is earned when the battle ends, whatever is picked on the debrief; a
      // replayed battle earns none.
      const gained = this.replaying ? null : battleXp(this.state, won);
      if (gained) {
        const awarded = awardXp(this.campaign, gained);
        // Deaths are counted when XP is: never for a replay (M5.3).
        this.campaign = recordDeaths(awarded.campaign, this.state);
        result.campaign = this.campaign;
        result.xp = { gained, promotions: awarded.promotions };
      }
      // Closing the browser on the debrief picks up at the next briefing: the next
      // mission after a win, a new map after a loss. A finished campaign isn't kept.
      const next = afterBattle(this.campaign, won, won ? 'next' : 'retry');
      if (isComplete(next)) clearSave();
      else writeSave(next, null);
    }
    // Let the last death animation play first.
    this.time.delayedCall(700, () => {
      playSound(this, won ? 'win' : 'lose');
      this.scene.launch('Result', result);
    });
    return true;
  }

  /** Test hook only (ADR-006): sets a unit's ammo, to test reloading without long setups. */
  debugSetAmmo(unitId: string, ammo: number): void {
    this.state = {
      ...this.state,
      units: this.state.units.map((u) => (u.id === unitId ? { ...u, ammo } : u)),
    };
    this.drawSelection();
  }

  /**
   * Test hook only (ADR-006): sets a unit's health, then checks for the end of
   * the battle, so e2e tests can reach the win and loss screens quickly.
   */
  debugSetHp(unitId: string, hp: number): void {
    this.state = {
      ...this.state,
      units: this.state.units.map((u) => (u.id === unitId ? { ...u, hp } : u)),
    };
    const v = this.views.get(unitId);
    if (v) {
      v.shownHp = hp;
      if (hp <= 0) v.sprite.setAlpha(0);
    }
    this.refreshVision();
    if (!this.busy) this.checkEnd();
  }

  /** A large message across the middle of the map. */
  private banner(text: string, color: string): Promise<void> {
    const t = new PixelText(this, MAP_WIDTH / 2, (MAP_ROWS * TILE) / 2, text, {
      color: Phaser.Display.Color.HexStringToColor(color).color,
      scale: 2,
      background: 0x11141b,
      backgroundAlpha: 0.85,
      padding: 6,
    })
      .setDepth(DEPTH.hud)
      .setAlpha(0);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: t,
        alpha: 1,
        duration: 200,
        hold: 700,
        yoyo: true,
        onComplete: () => {
          t.destroy();
          resolve();
        },
      });
    });
  }

  /** Runs a unit's sprite along a path. The state must already hold the move. */
  /**
   * A pod has been spotted: "ALIENS SPOTTED" and a "!" over each alien, then every
   * woken alien's free scramble to cover.
   */
  private async playSighting(spotted: string[], scampers: Scamper[]): Promise<void> {
    if (spotted.length > 0) {
      this.refreshVision();
      for (const id of spotted) {
        const unit = unitById(this.state, id);
        const view = this.views.get(id);
        if (!unit || !view || !view.sprite.visible) continue;
        const headY = view.sprite.y - SHEETS[unit.kind].height;
        floatText(this, view.sprite.x, headY - 6, '!', '#ff5a4a', DEPTH.fx);
      }
      playSound(this, 'spotted');
      await this.banner('ALIENS SPOTTED', '#ff6a5a');
    }
    for (const sc of scampers) {
      await this.playMove({
        unitId: sc.unitId,
        path: sc.path,
        reactions: [],
        spotted: [],
        scampers: [],
      });
    }
  }

  /**
   * Runs a unit's sprite along a move the state already holds, pausing for each
   * overwatch reaction shot where it happened. A killed mover stops there.
   */
  private async playMove(moved: MoveResult): Promise<void> {
    const unit = unitById(this.state, moved.unitId);
    const view = this.views.get(moved.unitId);
    if (!unit || !view) return;
    view.ghost.setVisible(false);
    view.moving = true;
    let facing: 1 | -1 = mirrored(view.sheet, 1) === view.sprite.flipX ? 1 : -1;
    this.playAnim(view, unit.kind, 'run', facing);
    const stepMs = 1000 / ANIMATION.runSpeed;
    let from: Point = tileUnder(unit.kind, view.sprite);
    for (const [i, p] of moved.path.entries()) {
      if (p.x !== from.x) {
        facing = p.x > from.x ? 1 : -1;
        this.face(view, facing);
      }
      await new Promise<void>((resolve) =>
        this.tweens.add({
          targets: view.sprite,
          ...feetAt(unit.kind, p),
          // The boss is heavy: each of its steps takes twice as long.
          duration: stepMs * unitSize(unit),
          onUpdate: () => view.sprite.setDepth(DEPTH.standing + view.sprite.y + 0.5),
          onComplete: () => resolve(),
        }),
      );
      from = p;
      if (unit.side === 'marine') {
        // The squad's sight moves with the runner.
        const eyes = livingUnits(this.state, 'marine').map((m) => (m.id === unit.id ? p : m));
        this.refreshVision(eyes);
      } else {
        this.updateAlienVisibility();
      }
      const reactions = moved.reactions.filter((r) => r.step === i);
      if (reactions.length === 0) continue;
      this.playAnim(view, unit.kind, 'idle', facing);
      for (const r of reactions) await this.playShot(r.shot);
      if (reactions.some((r) => r.shot.killed)) {
        view.moving = false;
        return;
      }
      this.playAnim(view, unit.kind, 'run', facing);
    }
    view.moving = false;
    this.playAnim(view, unit.kind, 'idle', unit.facing);
    view.ghost.setPosition(view.sprite.x, view.sprite.y);
  }

  /**
   * Plays an attack that the state already holds: turn, then the attack itself (a
   * bullet, a claw lunge, a tongue or a venom spit), then hit or miss and any effect.
   */
  private async playShot(shot: ShotResult): Promise<void> {
    const shooter = unitById(this.state, shot.shooterId);
    const target = unitById(this.state, shot.targetId);
    const sv = this.views.get(shot.shooterId);
    const tv = this.views.get(shot.targetId);
    if (!shooter || !target || !sv || !tv) return;
    const sheet = SHEETS[shooter.kind];
    const ability = UNITS[shooter.kind].ability;
    if (shot.reaction) sv.watching = false;
    this.playAnim(sv, shooter.kind, 'shoot', shooter.facing);
    this.face(sv, shooter.facing);
    // Claws make no sound until they land.
    if (ability !== 'melee') playSound(this, shooter.side === 'marine' ? 'shot' : 'alienShot');

    const from = {
      x: sv.sprite.x + shooter.facing * sheet.muzzle.x,
      y: sv.sprite.y - sheet.muzzle.y,
    };
    const aimY = tv.sprite.y - SHEETS[target.kind].height / 2;
    // A miss flies past the target and off to one side.
    const to = shot.hit
      ? { x: tv.sprite.x, y: aimY }
      : { x: tv.sprite.x + shooter.facing * 24, y: aimY + (from.y < aimY ? 14 : -14) };

    if (ability === 'melee') {
      await this.lunge(sv.sprite, tv.sprite.x - sv.sprite.x, tv.sprite.y - sv.sprite.y);
      this.showImpact(shot, tv, target);
    } else if (ability === 'pull') {
      await this.tongue(shot, from, to, tv, target);
    } else if (ability === 'poison') {
      await this.fly(this.fx.take(SPIT.key, from.x, from.y, DEPTH.fx, { frame: 0 }), to);
      this.showImpact(shot, tv, target);
    } else {
      // Alien shots are green.
      const bullet = this.fx
        .take(
          BULLET.key,
          from.x,
          from.y,
          DEPTH.fx,
          shooter.side === 'alien' ? { tint: ALIEN_FX_TINT } : {},
        )
        .setRotation(Math.atan2(to.y - from.y, to.x - from.x));
      await this.fly(bullet, to);
      this.showImpact(shot, tv, target);
    }
    if (shot.poisoned) {
      tv.poisoned = true;
      const headY = tv.sprite.y - SHEETS[target.kind].height;
      this.time.delayedCall(250, () =>
        floatText(this, tv.sprite.x, headY - 14, 'POISONED', '#7ad84a', DEPTH.fx),
      );
    }
    await new Promise<void>((resolve) => this.time.delayedCall(650, () => resolve()));
    this.playAnim(sv, shooter.kind, 'idle', shooter.facing);
  }

  /** Moves a projectile to `to`, then returns it to the pool. */
  private fly(shot: Phaser.GameObjects.Sprite, to: Point): Promise<void> {
    const dist = Math.hypot(to.x - shot.x, to.y - shot.y);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: shot,
        x: to.x,
        y: to.y,
        duration: Math.max(120, dist * 2.5),
        onComplete: () => {
          this.fx.give(shot);
          resolve();
        },
      });
    });
  }

  /** A quick lunge part of the way toward (dx, dy) and back: a claw attack. */
  private lunge(sprite: Phaser.GameObjects.Sprite, dx: number, dy: number): Promise<void> {
    const len = Math.hypot(dx, dy) || 1;
    const reach = 6;
    return new Promise((resolve) => {
      this.tweens.add({
        targets: sprite,
        x: sprite.x + (dx / len) * reach,
        y: sprite.y + (dy / len) * reach,
        duration: 90,
        yoyo: true,
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * The lizard's tongue: it shoots out to `to`, the hit lands, and a pulled marine is
   * dragged to the tile next to the lizard as the tongue comes back.
   */
  private async tongue(
    shot: ShotResult,
    from: Point,
    to: Point,
    tv: UnitView,
    target: Unit,
  ): Promise<void> {
    const g = this.add.graphics().setDepth(DEPTH.fx);
    const draw = (tip: Point): void => {
      g.clear().lineStyle(2, TONGUE.color, 1).lineBetween(from.x, from.y, tip.x, tip.y);
      g.fillStyle(TONGUE.tip, 1).fillRect(Math.round(tip.x) - 1, Math.round(tip.y) - 1, 3, 3);
    };
    const reach = (ms: number, tipAt: (t: number) => Point): Promise<void> =>
      new Promise((resolve) => {
        this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: ms,
          onUpdate: (tw) => draw(tipAt(tw.getValue() ?? 1)),
          onComplete: () => resolve(),
        });
      });
    const lerp = (a: Point, b: Point, t: number): Point => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    await reach(TONGUE.outMs, (t) => lerp(from, to, t));
    this.showImpact(shot, tv, target);
    const dest = shot.pulledTo;
    if (dest) {
      tv.watching = false;
      const end = { x: dest.x * TILE + TILE / 2, y: (dest.y + 1) * TILE };
      const start = { x: tv.sprite.x, y: tv.sprite.y };
      const grip = { x: to.x - start.x, y: to.y - start.y };
      await reach(TONGUE.dragMs, (t) => {
        const p = lerp(start, end, t);
        tv.sprite.setPosition(p.x, p.y).setDepth(DEPTH.standing + p.y + 0.5);
        return { x: p.x + grip.x, y: p.y + grip.y };
      });
      tv.ghost.setPosition(end.x, end.y);
      // The squad's sight moved with the marine.
      this.refreshVision();
      this.updateHidden();
    }
    await reach(TONGUE.outMs, (t) => lerp(dest ? from : to, from, t));
    g.destroy();
  }

  /** Poison biting the squad as their turn begins. */
  private async playPoison(): Promise<void> {
    const ticks = this.state.lastPoison;
    for (const tick of ticks) {
      const unit = unitById(this.state, tick.unitId);
      const view = this.views.get(tick.unitId);
      if (!unit || !view) continue;
      view.poisoned = unit.poison > 0;
      if (tick.damage === 0) continue;
      view.shownHp = tick.hpAfter;
      flash(this, view.sprite);
      const headY = view.sprite.y - SHEETS[unit.kind].height;
      floatText(this, view.sprite.x, headY - 6, `-${tick.damage} POISON`, '#7ad84a', DEPTH.fx);
    }
    if (ticks.some((t) => t.damage > 0)) {
      playSound(this, 'poison');
      await new Promise<void>((resolve) => this.time.delayedCall(700, () => resolve()));
    }
  }

  private showImpact(shot: ShotResult, tv: UnitView, target: Unit): void {
    const shooter = unitById(this.state, shot.shooterId);
    const from = shooter ? this.views.get(shooter.id)?.sprite : undefined;
    if (shot.hit) {
      const x = tv.sprite.x;
      const y = tv.sprite.y - SHEETS[target.kind].height / 2;
      if (shooter && UNITS[shooter.kind].ability === 'melee') {
        this.fx.play(EFFECTS.slash.key, x, y, DEPTH.fx, {
          flipX: shooter.facing === -1,
          tint: ALIEN_FX_TINT,
        });
      } else if (shooter?.side === 'alien') {
        this.fx.play(EFFECTS.sparkle.key, x, y, DEPTH.fx, { tint: ALIEN_FX_TINT });
      } else {
        this.fx.play(EFFECTS.hit.key, x, tv.sprite.y - 14, DEPTH.fx);
      }
      this.showDamage(tv, target, shot.damage, shot.hpAfter, shot.killed, shot.crit, from);
      return;
    }
    const headY = tv.sprite.y - SHEETS[target.kind].height;
    tv.shownHp = shot.hpAfter;
    playSound(this, 'miss');
    floatText(this, tv.sprite.x, headY - 6, 'MISS', '#dfe4ec', DEPTH.fx);
  }

  /**
   * Damage landing on a unit: flash, number, health pips, a flinch away from `from`
   * (or its hurt animation), and a death if it was fatal.
   */
  private showDamage(
    tv: UnitView,
    target: Unit,
    damage: number,
    hpAfter: number,
    killed: boolean,
    crit: boolean,
    from?: Point,
  ): void {
    const headY = tv.sprite.y - SHEETS[target.kind].height;
    tv.shownHp = hpAfter;
    playSound(this, killed ? 'death' : 'hit');
    flash(this, tv.sprite);
    const text = crit ? `CRIT -${damage}` : `-${damage}`;
    floatText(this, tv.sprite.x, headY - 6, text, crit ? '#ffd23a' : '#ff6a5a', DEPTH.fx);
    if (!killed) {
      this.flinch(tv, target, from);
      return;
    }
    tv.ghost.setVisible(false);
    if (target.kind === 'marine') {
      this.playAnim(tv, target.kind, 'die', target.facing);
      // The last death frame is drawn a few pixels above the feet line; settle it on the ground.
      this.tweens.add({ targets: tv.sprite, y: tv.sprite.y + 5, delay: 120, duration: 200 });
      return;
    }
    const small = target.kind === 'lizard' || target.kind === 'snake';
    const death = small ? EFFECTS.smallDeath : EFFECTS.death;
    this.fx.play(death.key, tv.sprite.x, tv.sprite.y - (small ? 10 : 16), DEPTH.fx);
    // A flyer drops out of the air as it goes.
    const drop = target.kind === 'flyer' ? FLYER_DROP : 0;
    this.tweens.add({
      targets: tv.sprite,
      alpha: 0,
      y: tv.sprite.y + drop,
      delay: 150,
      duration: 300,
    });
  }

  /**
   * A hit that doesn't kill: kinds with a hurt animation play it, the others jolt a
   * couple of pixels away from the attacker and back.
   */
  private flinch(tv: UnitView, target: Unit, from?: Point): void {
    if (UNIT_ANIMS[target.kind].hurt && !tv.moving) {
      this.playAnim(tv, target.kind, 'hurt', target.facing);
      tv.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        // Unless something else has started meanwhile (a run, a death).
        if (tv.sheet === UNIT_ANIMS[target.kind].hurt) {
          this.playAnim(tv, target.kind, 'idle', target.facing);
        }
      });
      return;
    }
    if (!from) return;
    const dx = tv.sprite.x - from.x;
    const dy = tv.sprite.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    this.tweens.add({
      targets: tv.sprite,
      x: tv.sprite.x + Math.round((dx / len) * FLINCH_PX),
      y: tv.sprite.y + Math.round((dy / len) * FLINCH_PX),
      duration: 60,
      yoyo: true,
    });
  }

  /** Plays one of a unit's animations, switching sheets if needed. Missing ones are skipped. */
  private playAnim(view: UnitView, kind: UnitKind, name: AnimName, facing: 1 | -1): void {
    const sheet = UNIT_ANIMS[kind][name];
    if (!sheet) return;
    view.sheet = sheet;
    this.face(view, facing);
    view.sprite.play(`${sheet.key}-${name}`);
  }

  /** Turns a unit's sprite (and its ghost) to face left or right. */
  private face(view: UnitView, facing: 1 | -1): void {
    const flip = mirrored(view.sheet, facing);
    const { originX, originY } = view.sheet;
    for (const s of [view.sprite, view.ghost]) {
      s.setFlipX(flip).setOrigin(flip ? 1 - originX : originX, originY);
    }
  }

  /** Draws the reticle and hit chance over a target, or clears them for null. */
  private drawAim(targetId: string | null): void {
    this.aimLayer.clear();
    this.aimText.setVisible(false);
    this.oddsPanel.setVisible(false);
    const shooter = this.state.selected;
    const target = targetId ? unitById(this.state, targetId) : undefined;
    const view = targetId ? this.views.get(targetId) : undefined;
    if (!shooter || !target || !view) return;
    const height = SHEETS[target.kind].height;
    const odds = shotOdds(this.state, shooter, target.id);
    const block = shotBlock(this.state, shooter, target.id);
    const WHY: Partial<Record<ShotBlock, string>> = {
      sight: 'NO LINE OF SIGHT',
      range: 'OUT OF RANGE',
      ammo: 'NO AMMO: R TO RELOAD',
    };
    const why = block ? (WHY[block] ?? null) : null;
    if (odds === null && why === null) return;
    if (odds) {
      drawReticle(this.aimLayer, view.sprite.x, view.sprite.y, height);
      this.drawOdds(odds, view.sprite.x, target);
    }
    this.aimText
      .setText(
        odds
          ? `${target.name.toUpperCase()} ${odds.hit}%${odds.armoured ? ' ARMOURED' : odds.flanked ? ' FLANKED' : ''}`
          : (why as string),
      )
      .setColor(odds ? (odds.flanked ? 0xffd23a : 0xf2a33a) : 0xa3adbd);
    // Keep the label on screen for units near the edges.
    const half = this.aimText.textWidth / 2 + 3;
    const x = Math.min(Math.max(view.sprite.x, half + 2), MAP_WIDTH - half - 2);
    // ...and below the top edge, for tall units near it (the boss).
    const y = Math.max(this.aimText.textHeight / 2 + 2, view.sprite.y - height - 8);
    this.aimText.setPosition(x, y).setVisible(true);
  }

  /** The breakdown panel, on the side of the map away from the target. */
  private drawOdds(odds: ShotOdds, targetX: number, target: Unit): void {
    const line = (label: string, value: string): string =>
      `${label.padEnd(12)}${value.padStart(5)}`;
    const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
    const lines = [line('AIM', `${odds.aim}`)];
    if (odds.range !== 0) lines.push(line('DISTANCE', signed(odds.range)));
    if (odds.cover)
      lines.push(line(`${odds.cover.toUpperCase()} COVER`, signed(-odds.coverPenalty)));
    if (odds.exposed) lines.push(line('EXPOSED', 'NO CVR'));
    // The boss (M5.6): its front plate, or the weak side the player found.
    if (target.kind === 'overseer') {
      lines.push(
        odds.armoured ? line('ARMOURED', `MAX ${BOSS.armourCap}`) : line('WEAK SIDE', 'FULL'),
      );
    }
    lines.push('-'.repeat(17), line('HIT', `${odds.hit}%`));
    lines.push(line(odds.flanked ? 'CRIT (FLANK)' : 'CRIT', `${odds.crit}%`));
    this.oddsPanel.setText(lines.join('\n'));
    const left = targetX > MAP_WIDTH / 2;
    const x = left ? 8 : MAP_WIDTH - this.oddsPanel.textWidth - 8;
    this.oddsPanel.setPosition(x, 2 * TILE + 6).setVisible(true);
  }

  /**
   * Starts a battle on the map from `seed`, or picks up a saved one (`resume`).
   * `replay`: started with REPLAY, so it earns no XP.
   */
  private startBattle(seed: number, resume: BattleState | undefined, replay: boolean): void {
    this.replaying = replay;
    this.chargeExplained = false;
    this.chargeHint = '';
    for (const o of this.mapObjects) o.destroy();
    for (const v of this.views.values()) {
      v.sprite.destroy();
      v.ghost.destroy();
    }
    this.mapObjects = [];
    this.props = [];
    this.propTiles = [];
    this.views.clear();
    this.aimTarget = null;
    this.mode = 'move';
    this.pending = null;
    this.busy = false;
    this.over = false;

    const map = generateMap(seed, MAP_COLS, MAP_ROWS, this.landscape);
    const c = this.campaign;
    const mission = c ? currentMission(c) : null;
    this.state =
      resume ??
      createBattle(
        map,
        map.seed,
        c && mission
          ? {
              names: c.squad,
              pods: mission.pods,
              kinds: mission.kinds,
              ranks: squadRanks(c),
              boss: 'boss' in mission && mission.boss,
              supply: c.supply,
              difficulty: c.difficulty,
            }
          : this.skirmishBoss
            ? {
                boss: true,
                pods: BOSS.escorts,
                ranks: Array.from({ length: SKIRMISH.marines }, () => BOSS_PRACTICE.rank),
                supply: BOSS_PRACTICE.supply,
                difficulty: urlDifficulty() ?? BOSS_PRACTICE.difficulty,
              }
            : { difficulty: urlDifficulty() ?? 'veteran' },
      );
    // A campaign saves as each of the squad's turns begins, this first one included.
    if (c) writeSave(c, this.state, replay);
    this.drawMap();
    for (const u of this.state.units) this.views.set(u.id, this.drawUnit(u));
    // A resumed battle may have the boss's blast already charging.
    this.drawCharge();
    this.updateHidden();
    this.drawSelection();
    this.explored.clear();
    this.refreshVision();
    this.updateHidden();
    const where = LANDSCAPES[this.landscape].name.toUpperCase();
    const n = c ? `${c.mission + 1}/${MISSIONS.length}` : '';
    this.mapLines = c
      ? [
          `${where}  MISSION ${n}  MAP ${map.seed}`,
          `MISSION ${n}  MAP ${map.seed}`,
          `M${n}  MAP ${map.seed}`,
        ]
      : [`${where}  MAP ${map.seed}`, `MAP ${map.seed}`];
    this.layoutButtons();
  }

  /** Draws the map again as it now is (after a grenade wrecked some cover). */
  private redrawMap(): void {
    for (const o of this.mapObjects) o.destroy();
    this.mapObjects = [];
    this.props = [];
    this.propTiles = [];
    this.drawMap();
    this.updateHidden();
  }

  private drawMap(): void {
    const { map } = this.state;
    const art = LANDSCAPE_ART[map.landscape ?? 'forest'];
    const add = (
      x: number,
      y: number,
      frame: string,
      depth: number,
      key: string = art.key,
    ): Phaser.GameObjects.Image => {
      const img = this.add.image(x, y, key, frame).setDepth(depth);
      this.mapObjects.push(img);
      return img;
    };
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        // A fixed scramble of the position, so the ground doesn't show a pattern.
        const hash = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
        const ground = art.groundAt
          ? art.groundAt(x, y, hash)
          : (art.ground[hash % art.ground.length] as string);
        add(x * TILE, y * TILE, ground, DEPTH.ground).setOrigin(0);
      }
    }
    for (const d of map.decals)
      add(d.x * TILE, d.y * TILE, art.decals[d.kind], DEPTH.decal).setOrigin(0);
    // Where grenades wrecked cover (M5.13): scorched ground, the same on every landscape.
    for (const i of map.wrecked ?? []) {
      const x = (i % map.cols) * TILE;
      const y = Math.floor(i / map.cols) * TILE;
      add(x, y, 'scorch', DEPTH.decal, BLAST_TEXTURE.key).setOrigin(0);
    }
    map.tiles.forEach((t, i) => {
      if (!t.prop || !t.anchor) return;
      const x = i % map.cols;
      const y = Math.floor(i / map.cols);
      // The anchor is the bottom-left of the footprint: the sprite stands on its bottom row.
      const bottom = (y + 1) * TILE;
      const centerX = (x + PROPS[t.prop].width / 2) * TILE;
      // A tree's trunk, left by a grenade, is drawn the same on every landscape.
      const img =
        t.prop === 'trunk'
          ? add(centerX, bottom, 'trunk', DEPTH.standing + bottom, BLAST_TEXTURE.key).setFlipX(
              (x + y) % 2 === 1, // every other one mirrored, so a felled clump looks less stamped
            )
          : add(centerX, bottom, art.prop(t.prop, x, y), DEPTH.standing + bottom);
      this.props.push(img.setOrigin(0.5, 1));
      const { width, height } = PROPS[t.prop];
      const tiles: number[] = [];
      for (let j = 0; j < height; j++) {
        for (let k = 0; k < width; k++) tiles.push((y - j) * map.cols + x + k);
      }
      this.propTiles.push(tiles);
    });
  }

  private drawUnit(u: Unit): UnitView {
    const sheet = SHEETS[u.kind];
    const flip = mirrored(sheet, u.facing);
    const { x: feetX, y: bottom } = feetAt(u.kind, u);
    const make = (): Phaser.GameObjects.Sprite =>
      this.add
        .sprite(feetX, bottom, sheet.key)
        .setOrigin(flip ? 1 - sheet.originX : sheet.originX, sheet.originY)
        .setFlipX(flip);
    // Units stand in front of props on the same row.
    const sprite = make().setDepth(DEPTH.standing + bottom + 0.5);
    sprite.play({ key: `${sheet.key}-idle`, startFrame: (u.x + u.y) % 3 });
    const ghost = make()
      .setDepth(DEPTH.ghost)
      .setTint(GHOST_COLOR[u.side])
      .setTintMode(Phaser.TintModes.FILL)
      .setAlpha(0.45);
    return {
      sprite,
      ghost,
      sheet,
      hidden: false,
      shownHp: u.hp,
      moving: false,
      watching: u.overwatch,
      exposed: u.exposed,
      poisoned: u.poison > 0,
    };
  }

  /** Shows a ghost for every unit that a standing object in front of it mostly covers. */
  private updateHidden(): void {
    for (const u of this.state.units) {
      const v = this.views.get(u.id);
      if (!v) continue;
      if (u.hp <= 0) {
        v.hidden = false;
        v.ghost.setVisible(false);
        continue;
      }
      // The body: as wide as the unit stands, from its footprint's bottom row up to one
      // tile above its top row (a two-tile-tall figure for everyone but the boss).
      const size = unitSize(u);
      const body = new Phaser.Geom.Rectangle(
        u.x * TILE + 3,
        (u.y - size) * TILE + 4,
        size * TILE - 6,
        (size + 1) * TILE - 4,
      );
      const area = body.width * body.height;
      v.hidden = this.props.some((p) => {
        if (p.depth <= v.sprite.depth) return false;
        const overlap = Phaser.Geom.Rectangle.Intersection(body, p.getBounds());
        return overlap.width * overlap.height >= area * HIDDEN_OVERLAP;
      });
      v.ghost.setVisible(v.hidden && v.sprite.visible);
    }
  }

  private drawSelection(): void {
    const playerTurn = this.state.turn === 'marine' && !this.busy && !this.over;
    if (!this.busy) {
      // Between animations the drawn exposure catches up with the rules (turn changes).
      for (const u of this.state.units) {
        const v = this.views.get(u.id);
        if (v) v.exposed = u.exposed && u.hp > 0;
      }
    }
    const sel0 = this.state.selected;
    if (this.mode === 'grenade' && (!playerTurn || !sel0 || !canThrow(this.state, sel0))) {
      this.mode = 'move';
    }
    this.endTurnButton.setAlpha(playerTurn ? 1 : 0.35);
    const sel = this.state.selected;
    this.reloadButton.setVisible(playerTurn && sel !== null && canReload(this.state, sel));
    this.overwatchButton.setVisible(playerTurn && sel !== null && canOverwatch(this.state, sel));
    this.grenadeButton.setVisible(playerTurn && sel !== null && canThrow(this.state, sel));
    this.grenadeButton.setLabel(this.mode === 'grenade' ? 'G CANCEL' : 'G GRENADE');
    this.layoutButtons();
    const g = this.marker.clear();
    this.rangeLayer.clear();
    const unit = this.state.selected ? unitById(this.state, this.state.selected) : undefined;
    const face = unit?.side === 'marine' && this.textures.get(PORTRAIT_TEXTURE.key).has(unit.name);
    this.portrait.setVisible(face === true);
    if (face && unit) this.portrait.setFrame(unit.name);
    if (this.aimTarget && !this.canShoot(this.aimTarget)) this.aimTarget = null;
    this.drawAim(this.aimTarget);
    if (!unit || this.busy) {
      this.chevron.clear();
      if (this.busy) {
        const hint = this.state.turn === 'alien' ? this.fastHint() : '';
        this.unitText.setText(unit ? marineLabel(unit) : hint);
        return;
      }
      this.unitText.setText(`${isTouchDevice() ? 'Tap' : 'Click'} a marine to select it`);
      return;
    }
    const x = unit.x * TILE;
    const y = unit.y * TILE;
    g.fillStyle(0xf2a33a, 0.25).fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    g.fillStyle(0xf2a33a, 1);
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + TILE - 1, y, -1, 1],
      [x, y + TILE - 1, 1, -1],
      [x + TILE - 1, y + TILE - 1, -1, -1],
    ] as const) {
      g.fillRect(Math.min(cx, cx + dx * 3), cy, 4, 1);
      g.fillRect(cx, Math.min(cy, cy + dy * 3), 1, 4);
    }
    // The body hides the tile marker, so a chevron also floats over the head.
    const top = (unit.y + 1) * TILE - SHEETS[unit.kind].height - 8;
    const cx = x + TILE / 2;
    this.chevron
      .clear()
      .fillStyle(0x11141b, 1)
      .fillTriangle(cx - 4, top - 5, cx + 4, top - 5, cx, top - 1)
      .fillStyle(0xf2a33a, 1)
      .fillTriangle(cx - 3, top - 5, cx + 3, top - 5, cx, top - 2);
    if (this.mode === 'grenade') {
      // Throwing range instead of move range.
      for (let ty = 0; ty < this.state.map.rows; ty++) {
        for (let tx = 0; tx < this.state.map.cols; tx++) {
          if (!inThrowRange(this.state, unit.id, { x: tx, y: ty })) continue;
          this.rangeLayer
            .fillStyle(0xf2a33a, 0.12)
            .fillRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
        }
      }
      this.unitText.setText(`${marineLabel(unit)}  GRENADE: CLICK A TILE  ESC: CANCEL`);
      return;
    }
    for (const t of this.rangeTiles(unit.id)) {
      // Blue: a normal move (1 point, or free squares left from a move cut short).
      // Yellow: a dash (both points).
      const [color, alpha] = t.cost <= 1 ? [0x4aa8ff, 0.3] : [0xf2c94a, 0.22];
      this.rangeLayer
        .fillStyle(color, alpha)
        .fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
    }
    const free = unit.freeSteps > 0 ? `  FREE MOVE ${unit.freeSteps}` : '';
    const ap = hasActions(unit) ? `AP ${unit.ap}/${ACTION_POINTS}${free}` : 'NO ACTIONS LEFT';
    const aimed = this.aimTarget ? hitChance(this.state, unit.id, this.aimTarget) : null;
    const status = aimed === null ? ap : `SHOOT ${aimed}%  Enter: fire`;
    const clip = clipSize(unit);
    const ammo = clip === null || unit.ammo === null ? '' : `  AMMO ${unit.ammo}/${clip}`;
    const poison = unit.poison > 0 ? '  POISONED' : '';
    // On the desktop bar, the line drops its least needed parts if it would run off.
    const shortStatus = aimed === null ? ap : `SHOOT ${aimed}%`;
    const head = `${marineLabel(unit)}  HP ${unit.hp}/${unit.maxHp}`;
    this.unitText.setText(
      this.fitUnitLine([
        `${head}  ${status}${ammo}${poison}`,
        `${head}  ${shortStatus}${ammo}${poison}`,
        `${head}  ${shortStatus}${poison}`,
      ]),
    );
  }

  /** The first line that fits the info bar (the side panel wraps, so takes the first). */
  private fitUnitLine(lines: readonly string[]): string {
    if (LAYOUT.hud === 'side') return lines[0] ?? '';
    const room = Math.floor((GAME_WIDTH - this.unitText.x - PORTRAIT_GAP) / CELL_W);
    return lines.find((l) => l.length <= room) ?? lines[lines.length - 1] ?? '';
  }

  private createHud(): void {
    const side = LAYOUT.hud === 'side';
    // Under the map (desktop), or a panel beside it (phones and tablets).
    const panel = side
      ? { x: MAP_WIDTH, y: 0, width: HUD_SIDE_WIDTH, height: MAP_HEIGHT }
      : { x: 0, y: MAP_HEIGHT, width: GAME_WIDTH, height: HUD_HEIGHT };
    this.add
      .rectangle(panel.x, panel.y, panel.width, panel.height, 0x11141b)
      .setOrigin(0)
      .setDepth(DEPTH.hud);
    this.add
      .rectangle(panel.x, panel.y, side ? 1 : panel.width, side ? panel.height : 1, 0x2b3242)
      .setOrigin(0)
      .setDepth(DEPTH.hud);
    const y = panel.y;
    // The portrait sits at the bar's left end, or at the top of the side panel; the text
    // starts right of it, or under it.
    this.portrait = this.add
      .image(panel.x + (side ? SIDE_PAD : PORTRAIT_GAP), y + PORTRAIT_GAP, PORTRAIT_TEXTURE.key)
      .setOrigin(0)
      .setDepth(DEPTH.hud)
      .setVisible(false);
    const textX = side ? panel.x + SIDE_PAD : PORTRAIT_GAP + PORTRAIT_SIZE + PORTRAIT_GAP;
    const textY = side ? y + PORTRAIT_GAP + PORTRAIT_SIZE + PORTRAIT_GAP : y + 5;
    // In the narrow panel, text breaks into lines (at its double spaces and between words).
    const wrap = side ? Math.floor((HUD_SIDE_WIDTH - 2 * SIDE_PAD) / CELL_W) : 0;
    this.unitText = new PixelText(this, textX, textY, '', {
      color: 0xf2a33a,
      align: 'left',
      valign: 'top',
      wrap,
    }).setDepth(DEPTH.hud);
    this.mapText = new PixelText(this, textX, y + 19, '', {
      color: MAP_LINE_COLOR,
      align: 'left',
      valign: 'top',
      wrap,
    }).setDepth(DEPTH.hud);
    // Buttons sit on the info bar's second line; the key comes first, as on the title.
    const hudButton = (label: string, primary: boolean, onClick: () => void): PixelButton =>
      new PixelButton(this, 0, y + 22, label, onClick, primary).setDepth(DEPTH.hud);
    this.endTurnButton = hudButton('E END TURN', true, () => void this.endTurn());
    this.reloadButton = hudButton('R RELOAD', false, () => this.reload());
    this.overwatchButton = hudButton('O WATCH', false, () => this.overwatch());
    this.grenadeButton = hudButton('G GRENADE', false, () => this.toggleGrenade());
    this.layoutButtons();
  }

  /**
   * Lines up the visible buttons from the right edge of the info bar, then shows the
   * longest map line that fits to their left.
   */
  private layoutButtons(): void {
    if (LAYOUT.hud === 'side') {
      this.layoutSidePanel();
      return;
    }
    let right = GAME_WIDTH - 6;
    for (const b of [
      this.endTurnButton,
      this.reloadButton,
      this.overwatchButton,
      this.grenadeButton,
    ]) {
      if (!b.visible) continue;
      // Buttons are positioned by their centre.
      // Whole pixels only, or the label's glyphs land between pixels and lose columns.
      b.setX(Math.round(right - b.buttonWidth / 2));
      right -= b.buttonWidth + 4;
    }
    const room = right - this.mapText.x;
    const { lines, charging } = this.mapLineChoices();
    const fits = lines.find((line) => line.length * CELL_W <= room);
    this.mapText
      .setText(fits ?? lines[lines.length - 1] ?? '')
      .setColor(charging ? 0xff6a5a : MAP_LINE_COLOR);
  }

  /**
   * The lines the map line can show now, longest first: while the boss's blast is
   * charging, its warning (M5.6); otherwise the map's own. (The HUD is laid out once
   * before the first battle state exists.)
   */
  private mapLineChoices(): { lines: string[]; charging: boolean } {
    const units = (this.state as BattleState | undefined)?.units ?? [];
    const charging = units.some((u) => u.hp > 0 && u.charging !== null);
    const lines = charging
      ? [this.chargeHint, 'Leave the red squares', 'Move!'].filter((l) => l !== '')
      : this.mapLines;
    return { lines, charging };
  }

  /**
   * Phones and tablets: buttons stacked at the foot of the side panel, full width and a
   * little taller for a finger, with the map line just above them.
   */
  private layoutSidePanel(): void {
    const width = HUD_SIDE_WIDTH - 2 * SIDE_PAD;
    const centre = MAP_WIDTH + HUD_SIDE_WIDTH / 2;
    let bottom = MAP_HEIGHT - SIDE_PAD;
    for (const b of [
      this.endTurnButton,
      this.reloadButton,
      this.overwatchButton,
      this.grenadeButton,
    ]) {
      if (!b.visible) continue;
      b.setBoxSize(width, SIDE_BUTTON_EXTRA);
      // Whole pixels only, or the label's glyphs land between pixels and lose columns.
      b.setPosition(Math.round(centre), Math.round(bottom - b.buttonHeight / 2));
      bottom -= b.buttonHeight + 3;
    }
    const { lines, charging } = this.mapLineChoices();
    // The longest line, broken to fit the panel.
    this.mapText.setText(lines[0] ?? '').setColor(charging ? 0xff6a5a : MAP_LINE_COLOR);
    this.mapText.setY(Math.round(bottom - this.mapText.textHeight - 4));
  }
}

/** Where a unit standing on anchor tile `p` has its feet: the middle of its footprint's bottom edge. */
function feetAt(kind: UnitKind, p: Point): { x: number; y: number } {
  return { x: (p.x + unitSize({ kind }) / 2) * TILE, y: (p.y + 1) * TILE };
}

/** The anchor tile a unit's sprite stands over (the inverse of feetAt). */
function tileUnder(kind: UnitKind, sprite: { x: number; y: number }): Point {
  return {
    x: Math.round(sprite.x / TILE - unitSize({ kind }) / 2),
    y: Math.round(sprite.y / TILE) - 1,
  };
}

/** The sound button's label: SND while sounds play, OFF while muted. */
function soundLabel(muted = isMuted()): string {
  return muted ? 'OFF' : 'SND';
}
