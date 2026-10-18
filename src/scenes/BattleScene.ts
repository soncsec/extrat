import Phaser from 'phaser';
import {
  ACTION_POINTS,
  ANIMATION,
  DEFAULT_SEED,
  GRENADE,
  GAME_WIDTH,
  HUD_HEIGHT,
  MAP_COLS,
  MAP_ROWS,
  MISSIONS,
  TILE,
  UNITS,
} from '../config/tuning';
import type { Point } from '../logic/grid';
import {
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
  type Unit,
  type UnitKind,
} from '../logic/battle';
import { planAlienAction } from '../logic/ai';
import {
  afterBattle,
  awardXp,
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
import { PixelButton, PixelText } from './pixelFont';
import { initialSeed, urlWord } from './seed';
import { clearSave, writeSave } from './storage';

/** A tile a unit can move to, and the action points that costs (2 means a dash). */
export interface MoveTile extends Point {
  cost: number;
}

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  seed: number;
  mapSeed: number;
  /** The campaign mission (0-based), try and squad XP, or null in a skirmish. */
  campaign: { mission: number; attempt: number; xp: number[] } | null;
  /** This battle was started with REPLAY (it earns no XP). */
  replaying: boolean;
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
    /** Index into RANKS. */
    rank: number;
    maxHp: number;
    /** The squad can see this unit now (aliens in the fog are false). */
    seen: boolean;
    /** An alien whose pod hasn't been spotted yet. */
    dormant: boolean;
    hidden: boolean;
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
const DEPTH = {
  ground: 0,
  decal: 1,
  range: 2,
  marker: 3,
  path: 4,
  standing: 10,
  fog: 800,
  ghost: 900,
  overlay: 950,
  fx: 960,
  hud: 1000,
} as const;

/** A marine's rank and name for the status line, e.g. 'CPL REYES'. */
const marineLabel = (u: Unit): string => `${rankOf(u.rank).short} ${u.name.toUpperCase()}`;

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
  private views = new Map<string, UnitView>();
  private marker!: Phaser.GameObjects.Graphics;
  private chevron!: Phaser.GameObjects.Graphics;
  private rangeLayer!: Phaser.GameObjects.Graphics;
  private pathLayer!: Phaser.GameObjects.Graphics;
  /** Cover shields for the hovered tile, drawn above units and trees. */
  private coverLayer!: Phaser.GameObjects.Graphics;
  private busy = false;
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
  private unitText!: PixelText;
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
    this.seeds = createRng(this.seed);
    this.createHud();
    this.marker = this.add.graphics().setDepth(DEPTH.marker);
    this.rangeLayer = this.add.graphics().setDepth(DEPTH.range);
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

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p.worldX, p.worldY));
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
    // G and Esc are here too: they toggle and undo, so a press handled twice (seen once
    // under heavy load) would cancel itself out or drop the selection.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') e.preventDefault(); // keep the browser's focus where it is
      // Paused under the help screen (or stopped): keys belong to whatever is on top.
      if (!this.scene.isActive()) return;
      if ((e.key === 'h' || e.key === 'H') && !e.repeat && !this.over) {
        this.scene.pause();
        this.scene.launch('Help', { from: 'Battle' });
        return;
      }
      if (e.key === 'Escape') {
        // Its own checks: it also works while the aliens move (it just does nothing).
        this.onEscape();
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
          }
        : null,
      replaying: this.replaying,
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
        rank: u.rank,
        maxHp: u.maxHp,
        seen: this.isSeen(u),
        dormant: u.dormant,
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

  private onClick(px: number, py: number): void {
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    if (y >= MAP_ROWS || this.busy) return;
    if (this.mode === 'grenade') {
      this.throwAt({ x, y });
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
      this.moveUnit(selected, { x, y });
    }
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
    // A marine's sprite is about two tiles tall and its rifle reaches into the next
    // tile: fogging those would darken the marine itself.
    const bodyTiles = new Set<number>();
    for (const m of livingUnits(this.state, 'marine')) {
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) bodyTiles.add((m.y + dy) * cols + (m.x + dx));
      }
    }
    const g = this.fogLayer.clear();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = y * cols + x;
        if (this.vision.has(k) || bodyTiles.has(k)) continue;
        // Seen before: dimmed. Never seen: darker.
        g.fillStyle(0x05070f, this.explored.has(k) ? 0.45 : 0.72).fillRect(
          x * TILE,
          y * TILE,
          TILE,
          TILE,
        );
      }
    }
    this.updateAlienVisibility();
  }

  /** Aliens are drawn only while they stand on a tile the squad can see. */
  private updateAlienVisibility(): void {
    const cols = this.state.map.cols;
    for (const u of this.state.units) {
      if (u.side !== 'alien') continue;
      const v = this.views.get(u.id);
      if (!v) continue;
      // Where the sprite is now (it may be part-way along a move).
      const x = Math.floor(v.sprite.x / TILE);
      const y = Math.round(v.sprite.y / TILE) - 1;
      const seen = this.vision.has(y * cols + x);
      v.sprite.setVisible(seen);
      if (!seen) v.ghost.setVisible(false);
    }
  }

  /** True if the squad can see this unit now (marines always see themselves). */
  private isSeen(unit: Unit): boolean {
    return unit.side === 'marine' || this.vision.has(unit.y * this.state.map.cols + unit.x);
  }

  /** Selects a marine (if the rules allow), leaving any aim or grenade mode. */
  private selectMarine(unitId: string): void {
    this.aimTarget = null;
    this.mode = 'move';
    this.pathLayer.clear();
    this.coverLayer.clear();
    this.dispatch({ type: 'select', unitId });
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
    this.cameras.main.shake(160, 0.006);
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
    if (sel && sel.ap <= 0) {
      const next = nextReadyMarine(this.state, sel.id);
      if (next) this.selectMarine(next);
    }
  }

  /** Ends the marines' turn, plays every alien's actions, then starts the next round. */
  private async endTurn(): Promise<void> {
    if (this.busy || this.state.turn !== 'marine') return;
    this.mode = 'move';
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
        }
        this.updateAlienVisibility();
        this.updateHidden();
      }
    }

    if (this.checkEnd()) return;
    this.state = apply(this.state, { type: 'endTurn' });
    this.endWatch('marine');
    this.refreshVision();
    await this.banner(`TURN ${this.state.round}`, '#f2a33a');
    await this.playPoison();
    if (this.campaign) writeSave(this.campaign, this.state, this.replaying);
    this.busy = false;
    const first = nextReadyMarine(this.state, null);
    if (first) this.selectMarine(first);
    this.updateHidden();
    this.drawSelection();
  }

  /** If one side is wiped out, locks the battle and opens the result screen. */
  private checkEnd(): boolean {
    const won = livingUnits(this.state, 'alien').length === 0;
    const lost = livingUnits(this.state, 'marine').length === 0;
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
    };
    if (this.campaign) {
      // XP is earned when the battle ends, whatever is picked on the debrief; a
      // replayed battle earns none.
      const gained = this.replaying ? null : battleXp(this.state, won);
      if (gained) {
        const awarded = awardXp(this.campaign, gained);
        this.campaign = awarded.campaign;
        result.campaign = awarded.campaign;
        result.xp = { gained, promotions: awarded.promotions };
      }
      // Closing the browser on the debrief picks up at the next briefing: the next
      // mission after a win, a new map after a loss. A finished campaign isn't kept.
      const next = afterBattle(this.campaign, won, won ? 'next' : 'retry');
      if (isComplete(next)) clearSave();
      else writeSave(next, null);
    }
    // Let the last death animation play first.
    this.time.delayedCall(700, () => this.scene.launch('Result', result));
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
    const t = new PixelText(this, GAME_WIDTH / 2, (MAP_ROWS * TILE) / 2, text, {
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
    let from: Point = {
      x: Math.floor(view.sprite.x / TILE),
      y: Math.round(view.sprite.y / TILE) - 1,
    };
    for (const [i, p] of moved.path.entries()) {
      if (p.x !== from.x) {
        facing = p.x > from.x ? 1 : -1;
        this.face(view, facing);
      }
      await new Promise<void>((resolve) =>
        this.tweens.add({
          targets: view.sprite,
          x: p.x * TILE + TILE / 2,
          y: (p.y + 1) * TILE,
          duration: stepMs,
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
      this.drawOdds(odds, view.sprite.x);
    }
    this.aimText
      .setText(
        odds
          ? `${target.name.toUpperCase()} ${odds.hit}%${odds.flanked ? ' FLANKED' : ''}`
          : (why as string),
      )
      .setColor(odds ? (odds.flanked ? 0xffd23a : 0xf2a33a) : 0xa3adbd);
    // Keep the label on screen for units near the edges.
    const half = this.aimText.textWidth / 2 + 3;
    const x = Math.min(Math.max(view.sprite.x, half + 2), GAME_WIDTH - half - 2);
    this.aimText.setPosition(x, view.sprite.y - height - 8).setVisible(true);
  }

  /** The breakdown panel, on the side of the map away from the target. */
  private drawOdds(odds: ShotOdds, targetX: number): void {
    const line = (label: string, value: string): string =>
      `${label.padEnd(12)}${value.padStart(5)}`;
    const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
    const lines = [line('AIM', `${odds.aim}`)];
    if (odds.range !== 0) lines.push(line('DISTANCE', signed(odds.range)));
    if (odds.cover)
      lines.push(line(`${odds.cover.toUpperCase()} COVER`, signed(-odds.coverPenalty)));
    if (odds.exposed) lines.push(line('EXPOSED', 'NO CVR'));
    lines.push('-'.repeat(17), line('HIT', `${odds.hit}%`));
    lines.push(line(odds.flanked ? 'CRIT (FLANK)' : 'CRIT', `${odds.crit}%`));
    this.oddsPanel.setText(lines.join('\n'));
    const left = targetX > GAME_WIDTH / 2;
    const x = left ? 8 : GAME_WIDTH - this.oddsPanel.textWidth - 8;
    this.oddsPanel.setPosition(x, 2 * TILE + 6).setVisible(true);
  }

  /**
   * Starts a battle on the map from `seed`, or picks up a saved one (`resume`).
   * `replay`: started with REPLAY, so it earns no XP.
   */
  private startBattle(seed: number, resume: BattleState | undefined, replay: boolean): void {
    this.replaying = replay;
    for (const o of this.mapObjects) o.destroy();
    for (const v of this.views.values()) {
      v.sprite.destroy();
      v.ghost.destroy();
    }
    this.mapObjects = [];
    this.props = [];
    this.views.clear();
    this.aimTarget = null;
    this.mode = 'move';
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
        c && mission ? { names: c.squad, pods: mission.pods, ranks: squadRanks(c) } : {},
      );
    // A campaign saves as each of the squad's turns begins, this first one included.
    if (c) writeSave(c, this.state, replay);
    this.drawMap();
    for (const u of this.state.units) this.views.set(u.id, this.drawUnit(u));
    this.updateHidden();
    this.drawSelection();
    this.explored.clear();
    this.refreshVision();
    this.updateHidden();
    const where = LANDSCAPES[this.landscape].name.toUpperCase();
    this.mapText.setText(
      c
        ? `${where}  MISSION ${c.mission + 1}/${MISSIONS.length}  MAP ${map.seed}`
        : `${where}  MAP ${map.seed}`,
    );
  }

  private drawMap(): void {
    const { map } = this.state;
    const art = LANDSCAPE_ART[map.landscape ?? 'forest'];
    const add = (x: number, y: number, frame: string, depth: number): Phaser.GameObjects.Image => {
      const img = this.add.image(x, y, art.key, frame).setDepth(depth);
      this.mapObjects.push(img);
      return img;
    };
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        // A fixed scramble of the position, so the ground doesn't show a pattern.
        const hash = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
        const ground = art.ground[hash % art.ground.length] as string;
        add(x * TILE, y * TILE, ground, DEPTH.ground).setOrigin(0);
      }
    }
    for (const d of map.decals)
      add(d.x * TILE, d.y * TILE, art.decals[d.kind], DEPTH.decal).setOrigin(0);
    map.tiles.forEach((t, i) => {
      if (!t.prop || !t.anchor) return;
      const x = i % map.cols;
      const y = Math.floor(i / map.cols);
      // The anchor is the bottom-left of the footprint: the sprite stands on its bottom row.
      const bottom = (y + 1) * TILE;
      const centerX = (x + PROPS[t.prop].width / 2) * TILE;
      const img = add(centerX, bottom, art.prop(t.prop, x, y), DEPTH.standing + bottom);
      this.props.push(img.setOrigin(0.5, 1));
    });
  }

  private drawUnit(u: Unit): UnitView {
    const sheet = SHEETS[u.kind];
    const flip = mirrored(sheet, u.facing);
    const bottom = (u.y + 1) * TILE;
    const make = (): Phaser.GameObjects.Sprite =>
      this.add
        .sprite(u.x * TILE + TILE / 2, bottom, sheet.key)
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
      // The body: one tile wide, two tiles tall, standing on the unit's tile.
      const body = new Phaser.Geom.Rectangle(
        u.x * TILE + 3,
        (u.y - 1) * TILE + 4,
        TILE - 6,
        TILE * 2 - 4,
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
    if (this.aimTarget && !this.canShoot(this.aimTarget)) this.aimTarget = null;
    this.drawAim(this.aimTarget);
    if (!unit || this.busy) {
      this.chevron.clear();
      if (this.busy) {
        this.unitText.setText(unit ? marineLabel(unit) : '');
        return;
      }
      this.unitText.setText('Click a marine to select it');
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
      // Blue: a normal move (1 point). Yellow: a dash (both points).
      const [color, alpha] = t.cost === 1 ? [0x4aa8ff, 0.3] : [0xf2c94a, 0.22];
      this.rangeLayer
        .fillStyle(color, alpha)
        .fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
    }
    const ap = unit.ap > 0 ? `AP ${unit.ap}/${ACTION_POINTS}` : 'NO ACTIONS LEFT';
    const aimed = this.aimTarget ? hitChance(this.state, unit.id, this.aimTarget) : null;
    const status = aimed === null ? ap : `SHOOT ${aimed}%  Enter: fire`;
    const clip = clipSize(unit);
    const ammo = clip === null || unit.ammo === null ? '' : `  AMMO ${unit.ammo}/${clip}`;
    const poison = unit.poison > 0 ? '  POISONED' : '';
    this.unitText.setText(
      `${marineLabel(unit)}  HP ${unit.hp}/${unit.maxHp}  ${status}${ammo}${poison}`,
    );
  }

  private createHud(): void {
    const y = MAP_ROWS * TILE;
    this.add.rectangle(0, y, GAME_WIDTH, HUD_HEIGHT, 0x11141b).setOrigin(0).setDepth(DEPTH.hud);
    this.add.rectangle(0, y, GAME_WIDTH, 1, 0x2b3242).setOrigin(0).setDepth(DEPTH.hud);
    this.unitText = new PixelText(this, 6, y + 5, '', {
      color: 0xf2a33a,
      align: 'left',
      valign: 'top',
    }).setDepth(DEPTH.hud);
    this.mapText = new PixelText(this, 6, y + 19, '', {
      color: 0xa3adbd,
      align: 'left',
      valign: 'top',
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

  /** Lines up the visible buttons from the right edge of the info bar. */
  private layoutButtons(): void {
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
  }
}
