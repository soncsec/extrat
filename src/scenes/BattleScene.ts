import Phaser from 'phaser';
import {
  ACTION_POINTS,
  ANIMATION,
  DEFAULT_SEED,
  GAME_WIDTH,
  HUD_HEIGHT,
  MAP_COLS,
  MAP_ROWS,
  TILE,
} from '../config/tuning';
import type { Point } from '../logic/grid';
import {
  apply,
  canAct,
  canReload,
  clipSize,
  createBattle,
  coverAgainst,
  hitChance,
  livingUnits,
  moveCost,
  moveRange,
  pathFor,
  shotBlock,
  shotOdds,
  unitAt,
  unitById,
  type Action,
  type BattleState,
  type ShotBlock,
  type ShotOdds,
  type ShotResult,
  type Side,
  type Unit,
  type UnitKind,
} from '../logic/battle';
import { planAlienAction } from '../logic/ai';
import { generateForest, PROPS, tileAt } from '../logic/map';
import { createRng, type Rng } from '../logic/rng';
import {
  BULLET,
  EFFECTS,
  FOREST_SHEET,
  MARINE_SHEET,
  propFrame,
  UNIT_ANIMS,
  WALKER_SHEET,
  type AnimName,
  type CharacterSheet,
} from './art';
import { drawPips, drawReticle, drawShield, flash, floatText, playOnce } from './fx';
import type { BattleResult } from './ResultScene';
import { initialSeed } from './seed';

/** A tile a unit can move to, and the action points that costs (2 means a dash). */
export interface MoveTile extends Point {
  cost: number;
}

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  seed: number;
  mapSeed: number;
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
    hidden: boolean;
  }[];
  selected: string | null;
  /** Tiles the selected unit can move to now. */
  reachable: MoveTile[];
  /** Aliens the selected marine could shoot now (in range and in sight). */
  shootable: string[];
  /** True while an animation plays; clicks are ignored. */
  busy: boolean;
  /** The alien the selected marine is aiming at, waiting for the player to confirm. */
  aimTarget: string | null;
  /** The odds of that shot, as the breakdown panel shows them. */
  aimOdds: ShotOdds | null;
  lastShot: BattleState['lastShot'];
  turn: Side;
  round: number;
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
  ghost: 900,
  overlay: 950,
  fx: 960,
  hud: 1000,
} as const;

/** Each kind's main sheet: its idle pose, height and muzzle. */
const SHEETS: Record<UnitKind, CharacterSheet> = { marine: MARINE_SHEET, walker: WALKER_SHEET };
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
  private aimLayer!: Phaser.GameObjects.Graphics;
  private aimText!: Phaser.GameObjects.Text;
  /** The hit-chance breakdown shown while aiming. */
  private oddsPanel!: Phaser.GameObjects.Text;
  /** Locked target: the next click on it, or Enter, fires. */
  private aimTarget: string | null = null;
  private mapText!: Phaser.GameObjects.Text;
  private unitText!: Phaser.GameObjects.Text;
  private endTurnButton!: Phaser.GameObjects.Text;
  private reloadButton!: Phaser.GameObjects.Text;
  /** Set when one side has been wiped out; only a new map can follow. */
  private over = false;

  constructor() {
    super('Battle');
  }

  create(data: { seed?: number }): void {
    this.seed = data.seed ?? initialSeed();
    this.seeds = createRng(this.seed);
    this.createHud();
    this.marker = this.add.graphics().setDepth(DEPTH.marker);
    this.rangeLayer = this.add.graphics().setDepth(DEPTH.range);
    this.pathLayer = this.add.graphics().setDepth(DEPTH.path);
    this.coverLayer = this.add.graphics().setDepth(DEPTH.overlay + 1);
    this.chevron = this.add.graphics().setDepth(DEPTH.overlay + 1);
    this.pips = this.add.graphics().setDepth(DEPTH.overlay);
    this.aimLayer = this.add.graphics().setDepth(DEPTH.overlay + 2);
    this.aimText = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f2a33a',
        backgroundColor: '#11141b',
        padding: { x: 2, y: 0 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.overlay + 3)
      .setResolution(4)
      .setVisible(false);
    // Thin strokes like '-' can fall between the pixels sampled when small text is
    // scaled down pixel-sharp; an outline in the text's own colour thickens them.
    this.oddsPanel = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#dfe4ec',
        stroke: '#dfe4ec',
        strokeThickness: 1,
        backgroundColor: '#11141b',
        padding: { x: 4, y: 3 },
      })
      .setDepth(DEPTH.hud)
      .setResolution(4)
      .setVisible(false);
    this.tweens.add({ targets: this.chevron, y: -2, duration: 450, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: this.marker, alpha: 0.45, duration: 450, yoyo: true, repeat: -1 });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p.worldX, p.worldY));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p.worldX, p.worldY));
    this.input.keyboard?.on('keydown-ESC', () => this.onEscape());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.aimTarget && !this.busy) this.fire(this.aimTarget);
    });
    this.input.keyboard?.on('keydown-E', () => void this.endTurn());
    this.input.keyboard?.on('keydown-R', () => this.reload());
    this.input.keyboard?.on('keydown-N', () => {
      // Not in the middle of an animation, the alien turn, or the result screen.
      if (!this.busy) this.startBattle(this.seeds.int(1, 999_999));
    });
    this.events.on('play-again', () => this.startBattle(this.seeds.int(1, 999_999)));
    // The scene object is reused when the player comes back from the title.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off('play-again'));

    this.startBattle(this.seed);
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
      if (!v || v.shownHp <= 0) continue;
      const top = v.sprite.y - SHEETS[u.kind].height - 5;
      const color = u.side === 'marine' ? 0x8bf06a : 0xff6a5a;
      drawPips(this.pips, v.sprite.x, top, v.shownHp, u.maxHp, color);
      if (u.side === 'marine' && !v.moving) {
        // Cover against the nearest alien, shown next to the pips.
        const enemy = livingUnits(this.state, 'alien').reduce<Unit | null>(
          (best, a) =>
            !best || Math.hypot(a.x - u.x, a.y - u.y) < Math.hypot(best.x - u.x, best.y - u.y)
              ? a
              : best,
          null,
        );
        const cover = enemy ? coverAgainst(this.state.map, u, enemy) : null;
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
        hidden: this.views.get(u.id)?.hidden ?? false,
      })),
      selected,
      reachable: selected ? this.rangeTiles(selected) : [],
      shootable: selected
        ? livingUnits(this.state, 'alien')
            .filter((a) => hitChance(this.state, selected, a.id) !== null)
            .map((a) => a.id)
        : [],
      busy: this.busy,
      aimTarget: this.aimTarget,
      aimOdds: this.aimTarget && selected ? shotOdds(this.state, selected, this.aimTarget) : null,
      lastShot: this.state.lastShot,
      turn: this.state.turn,
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
    const unit = this.unitUnderPointer(x, y);
    if (unit?.side === 'marine') {
      this.aimTarget = null;
      this.dispatch({ type: 'select', unitId: unit.id });
      this.drawSelection();
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
    const here = unitAt(this.state, x, y);
    if (here) return here;
    const selected = this.state.selected;
    if (selected && pathFor(this.state, selected, { x, y })) return undefined;
    return unitAt(this.state, x, y + 1);
  }

  private onEscape(): void {
    if (this.busy) return;
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
    const path = pathFor(this.state, unitId, to);
    const next = apply(this.state, { type: 'move', unitId, to });
    if (!path || next === this.state) return;
    this.state = next;
    void this.run(() => this.playMove(unitId, path));
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
    this.updateHidden();
    this.drawSelection();
    if (this.checkEnd()) return;
    // Like XCOM, the turn ends by itself once no marine can do anything.
    if (this.state.turn === 'marine' && !canAct(this.state, 'marine')) void this.endTurn();
  }

  /** Ends the marines' turn, plays every alien's actions, then starts the next round. */
  private async endTurn(): Promise<void> {
    if (this.busy || this.state.turn !== 'marine') return;
    this.aimTarget = null;
    this.drawAim(null);
    this.state = apply(this.state, { type: 'endTurn' });
    this.busy = true;
    this.pathLayer.clear();
    this.coverLayer.clear();
    this.drawSelection();
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
        if (action.type === 'move') {
          const path = pathFor(before, alien.id, action.to);
          if (path) await this.playMove(alien.id, path);
        } else if (action.type === 'shoot' && next.lastShot) {
          await this.playShot(next.lastShot);
        }
        this.updateHidden();
      }
    }

    if (this.checkEnd()) return;
    this.state = apply(this.state, { type: 'endTurn' });
    await this.banner(`TURN ${this.state.round}`, '#f2a33a');
    this.busy = false;
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
    };
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
    if (!this.busy) this.checkEnd();
  }

  /** A large message across the middle of the map. */
  private banner(text: string, color: string): Promise<void> {
    const t = this.add
      .text(GAME_WIDTH / 2, (MAP_ROWS * TILE) / 2, text, {
        fontFamily: 'monospace',
        fontSize: '18px',
        fontStyle: 'bold',
        color,
        backgroundColor: '#11141bcc',
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud)
      .setResolution(4)
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
  private playMove(unitId: string, path: Point[]): Promise<void> {
    const unit = unitById(this.state, unitId);
    const view = this.views.get(unitId);
    if (!unit || !view) return Promise.resolve();
    view.ghost.setVisible(false);
    view.moving = true;
    this.playAnim(view, unit.kind, 'run', view.sprite.flipX ? -1 : 1);
    const stepMs = 1000 / ANIMATION.runSpeed;
    return new Promise((resolve) => {
      const step = (i: number, from: Point): void => {
        const p = path[i];
        if (!p) {
          view.moving = false;
          this.playAnim(view, unit.kind, 'idle', unit.facing);
          view.ghost.setPosition(view.sprite.x, view.sprite.y);
          resolve();
          return;
        }
        if (p.x !== from.x) this.face(view, p.x > from.x ? 1 : -1);
        this.tweens.add({
          targets: view.sprite,
          x: p.x * TILE + TILE / 2,
          y: (p.y + 1) * TILE,
          duration: stepMs,
          onUpdate: () => view.sprite.setDepth(DEPTH.standing + view.sprite.y + 0.5),
          onComplete: () => step(i + 1, p),
        });
      };
      step(0, { x: Math.floor(view.sprite.x / TILE), y: Math.round(view.sprite.y / TILE) - 1 });
    });
  }

  /** Plays a shot that the state already holds: turn, muzzle, bullet, then hit or miss. */
  private playShot(shot: ShotResult): Promise<void> {
    const shooter = unitById(this.state, shot.shooterId);
    const target = unitById(this.state, shot.targetId);
    const sv = this.views.get(shot.shooterId);
    const tv = this.views.get(shot.targetId);
    if (!shooter || !target || !sv || !tv) return Promise.resolve();
    const sheet = SHEETS[shooter.kind];
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
    const bullet = this.add
      .image(from.x, from.y, BULLET.key)
      .setDepth(DEPTH.fx)
      .setRotation(Math.atan2(to.y - from.y, to.x - from.x));
    // Alien shots are green.
    if (shooter.side === 'alien') bullet.setTint(0x8bf06a);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: bullet,
        x: to.x,
        y: to.y,
        duration: Math.max(120, dist * 2.5),
        onComplete: () => {
          bullet.destroy();
          this.showImpact(shot, tv, target);
          this.time.delayedCall(650, () => {
            this.playAnim(sv, shooter.kind, 'idle', shooter.facing);
            resolve();
          });
        },
      });
    });
  }

  private showImpact(shot: ShotResult, tv: UnitView, target: Unit): void {
    const headY = tv.sprite.y - SHEETS[target.kind].height;
    tv.shownHp = target.hp;
    if (!shot.hit) {
      floatText(this, tv.sprite.x, headY - 6, 'MISS', '#dfe4ec', DEPTH.fx);
    } else {
      playOnce(this, EFFECTS.hit.key, tv.sprite.x, tv.sprite.y - 14, DEPTH.fx);
      flash(this, tv.sprite);
      const text = shot.crit ? `CRIT -${shot.damage}` : `-${shot.damage}`;
      floatText(this, tv.sprite.x, headY - 6, text, shot.crit ? '#ffd23a' : '#ff6a5a', DEPTH.fx);
    }
    if (!shot.killed) return;
    tv.ghost.setVisible(false);
    if (target.kind === 'marine') {
      this.playAnim(tv, target.kind, 'die', target.facing);
      // The last death frame is drawn a few pixels above the feet line; settle it on the ground.
      this.tweens.add({ targets: tv.sprite, y: tv.sprite.y + 5, delay: 120, duration: 200 });
    } else {
      playOnce(this, EFFECTS.death.key, tv.sprite.x, tv.sprite.y - 16, DEPTH.fx);
      this.tweens.add({ targets: tv.sprite, alpha: 0, delay: 150, duration: 300 });
    }
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
    const flip = facing === -1;
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
      .setText(odds ? `${odds.hit}%${odds.flanked ? ' FLANKED' : ''}` : (why as string))
      .setColor(odds ? (odds.flanked ? '#ffd23a' : '#f2a33a') : '#8d97a8');
    // Keep the label on screen for units near the edges.
    const half = this.aimText.width / 2;
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
    lines.push('-'.repeat(17), line('HIT', `${odds.hit}%`));
    lines.push(line(odds.flanked ? 'CRIT (FLANK)' : 'CRIT', `${odds.crit}%`));
    this.oddsPanel.setText(lines.join('\n'));
    const left = targetX > GAME_WIDTH / 2;
    const x = left ? 4 : GAME_WIDTH - this.oddsPanel.width - 4;
    this.oddsPanel.setPosition(x, 2 * TILE + 2).setVisible(true);
  }

  private startBattle(seed: number): void {
    for (const o of this.mapObjects) o.destroy();
    for (const v of this.views.values()) {
      v.sprite.destroy();
      v.ghost.destroy();
    }
    this.mapObjects = [];
    this.props = [];
    this.views.clear();
    this.aimTarget = null;
    this.busy = false;
    this.over = false;

    const map = generateForest(seed, MAP_COLS, MAP_ROWS);
    this.state = createBattle(map, map.seed);
    this.drawMap();
    for (const u of this.state.units) this.views.set(u.id, this.drawUnit(u));
    this.updateHidden();
    this.drawSelection();
    this.mapText.setText(`FOREST  map ${map.seed}`);
  }

  private drawMap(): void {
    const { map } = this.state;
    const add = (x: number, y: number, frame: string, depth: number): Phaser.GameObjects.Image => {
      const img = this.add.image(x, y, FOREST_SHEET.key, frame).setDepth(depth);
      this.mapObjects.push(img);
      return img;
    };
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++)
        add(x * TILE, y * TILE, 'grass', DEPTH.ground).setOrigin(0);
    }
    for (const d of map.decals)
      add(d.x * TILE, d.y * TILE, `dirt${d.kind}`, DEPTH.decal).setOrigin(0);
    map.tiles.forEach((t, i) => {
      if (!t.prop || !t.anchor) return;
      const x = i % map.cols;
      const y = Math.floor(i / map.cols);
      const bottom = (y + 1) * TILE;
      const centerX = (x + PROPS[t.prop].width / 2) * TILE;
      const img = add(centerX, bottom, propFrame(t.prop, x, y), DEPTH.standing + bottom);
      this.props.push(img.setOrigin(0.5, 1));
    });
  }

  private drawUnit(u: Unit): UnitView {
    const sheet = SHEETS[u.kind];
    const flip = u.facing === -1;
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
    return { sprite, ghost, sheet, hidden: false, shownHp: u.hp, moving: false };
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
      v.ghost.setVisible(v.hidden);
    }
  }

  private drawSelection(): void {
    const playerTurn = this.state.turn === 'marine' && !this.busy && !this.over;
    this.endTurnButton.setAlpha(playerTurn ? 1 : 0.35);
    const sel = this.state.selected;
    this.reloadButton.setVisible(playerTurn && sel !== null && canReload(this.state, sel));
    const g = this.marker.clear();
    this.rangeLayer.clear();
    const unit = this.state.selected ? unitById(this.state, this.state.selected) : undefined;
    if (this.aimTarget && !this.canShoot(this.aimTarget)) this.aimTarget = null;
    this.drawAim(this.aimTarget);
    if (!unit || this.busy) {
      this.chevron.clear();
      if (this.busy) {
        this.unitText.setText(unit ? `PVT ${unit.name.toUpperCase()}` : '');
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
    this.unitText.setText(
      `PVT ${unit.name.toUpperCase()}  HP ${unit.hp}/${unit.maxHp}  ${status}${ammo}`,
    );
  }

  private createHud(): void {
    const y = MAP_ROWS * TILE;
    const style = { fontFamily: 'monospace', fontSize: '10px', color: '#8d97a8' };
    this.add.rectangle(0, y, GAME_WIDTH, HUD_HEIGHT, 0x11141b).setOrigin(0).setDepth(DEPTH.hud);
    this.add.rectangle(0, y, GAME_WIDTH, 1, 0x2b3242).setOrigin(0).setDepth(DEPTH.hud);
    this.unitText = this.add
      .text(6, y + 5, '', { ...style, color: '#f2a33a' })
      .setDepth(DEPTH.hud)
      .setResolution(4);
    this.mapText = this.add
      .text(6, y + 18, '', style)
      .setDepth(DEPTH.hud)
      .setResolution(4);
    this.add
      .text(GAME_WIDTH - 6, y + 18, 'R reload  E end turn  Esc cancel  N new map', style)
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)
      .setResolution(4);
    this.endTurnButton = this.add
      .text(GAME_WIDTH - 6, y + 4, 'END TURN', {
        ...style,
        fontStyle: 'bold',
        color: '#11141b',
        backgroundColor: '#f2a33a',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)
      .setResolution(4)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.endTurn());
    this.reloadButton = this.add
      .text(this.endTurnButton.x - this.endTurnButton.width - 4, y + 4, 'RELOAD', {
        ...style,
        fontStyle: 'bold',
        color: '#dfe4ec',
        backgroundColor: '#2b3242',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)
      .setResolution(4)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.reload());
  }
}
