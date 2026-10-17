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
  createBattle,
  hitChance,
  moveRange,
  pathFor,
  unitAt,
  unitById,
  type Action,
  type BattleState,
  type Side,
  type Unit,
} from '../logic/battle';
import { generateForest, PROPS } from '../logic/map';
import { createRng, type Rng } from '../logic/rng';
import {
  addAnims,
  addFrames,
  BULLET,
  EFFECTS,
  FOREST_SHEET,
  MARINE_SHEET,
  propFrame,
  WALKER_SHEET,
  type CharacterSheet,
} from './art';
import { drawPips, drawReticle, flash, floatText, playOnce } from './fx';

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
    hidden: boolean;
  }[];
  selected: string | null;
  /** Tiles the selected unit can move to now. */
  reachable: Point[];
  /** True while an animation plays; clicks are ignored. */
  busy: boolean;
  /** The alien the selected marine is aiming at, waiting for the player to confirm. */
  aimTarget: string | null;
  lastShot: BattleState['lastShot'];
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

const SHEETS: Record<Unit['kind'], CharacterSheet> = { marine: MARINE_SHEET, walker: WALKER_SHEET };
const GHOST_COLOR = { marine: 0x7fd4ff, alien: 0xff6a5a } as const;
/** A unit counts as hidden when a standing object in front covers this much of its body. */
const HIDDEN_OVERLAP = 0.3;

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  ghost: Phaser.GameObjects.Sprite;
  hidden: boolean;
  /** Health as drawn: it catches up with the state when a shot lands, not when it's fired. */
  shownHp: number;
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
  private busy = false;
  private pips!: Phaser.GameObjects.Graphics;
  private aimLayer!: Phaser.GameObjects.Graphics;
  private aimText!: Phaser.GameObjects.Text;
  /** Locked target: the next click on it, or Enter, fires. */
  private aimTarget: string | null = null;
  private mapText!: Phaser.GameObjects.Text;
  private unitText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  preload(): void {
    this.load.image(FOREST_SHEET.key, FOREST_SHEET.url);
    for (const s of Object.values(SHEETS)) {
      this.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
    for (const e of Object.values(EFFECTS)) {
      this.load.spritesheet(e.key, e.url, { frameWidth: e.frameWidth, frameHeight: e.frameHeight });
    }
    this.load.image(BULLET.key, BULLET.url);
  }

  create(): void {
    addFrames(this.textures, FOREST_SHEET.key, FOREST_SHEET.frames);
    for (const s of Object.values(SHEETS)) addAnims(this.anims, s);
    for (const e of Object.values(EFFECTS)) {
      if (this.anims.exists(e.key)) continue;
      const frames = this.anims.generateFrameNumbers(e.key, { start: 0, end: e.count - 1 });
      this.anims.create({ key: e.key, frames, frameRate: e.fps, repeat: 0 });
    }
    this.seed = seedFromUrl();
    this.seeds = createRng(this.seed);
    this.createHud();
    this.marker = this.add.graphics().setDepth(DEPTH.marker);
    this.rangeLayer = this.add.graphics().setDepth(DEPTH.range);
    this.pathLayer = this.add.graphics().setDepth(DEPTH.path);
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
    this.tweens.add({ targets: this.chevron, y: -2, duration: 450, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: this.marker, alpha: 0.45, duration: 450, yoyo: true, repeat: -1 });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p.worldX, p.worldY));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onHover(p.worldX, p.worldY));
    this.input.keyboard?.on('keydown-ESC', () => this.onEscape());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.aimTarget && !this.busy) this.fire(this.aimTarget);
    });
    this.input.keyboard?.on('keydown-N', () => this.startBattle(this.seeds.int(1, 999_999)));

    this.startBattle(this.seed);
  }

  override update(): void {
    // Ghosts copy their unit's current animation frame.
    for (const v of this.views.values()) if (v.hidden) v.ghost.setFrame(v.sprite.frame.name);
    // Health pips follow their units, including while they run.
    this.pips.clear();
    for (const u of this.state.units) {
      const v = this.views.get(u.id);
      if (!v || v.shownHp <= 0) continue;
      const top = v.sprite.y - SHEETS[u.kind].height - 5;
      const color = u.side === 'marine' ? 0x8bf06a : 0xff6a5a;
      drawPips(this.pips, v.sprite.x, top, v.shownHp, u.maxHp, color);
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
        hidden: this.views.get(u.id)?.hidden ?? false,
      })),
      selected,
      reachable: selected ? this.rangeTiles(selected) : [],
      busy: this.busy,
      aimTarget: this.aimTarget,
      lastShot: this.state.lastShot,
    };
  }

  private rangeTiles(unitId: string): Point[] {
    const cols = this.state.map.cols;
    return [...moveRange(this.state, unitId).keys()].map((k) => ({
      x: k % cols,
      y: Math.floor(k / cols),
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
    // Characters stand about two tiles tall, so a click on the tile above one also counts.
    const unit = unitAt(this.state, x, y) ?? unitAt(this.state, x, y + 1);
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
    const id = this.state.selected;
    if (!id || this.busy) return;
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    if (!this.aimTarget) {
      const alien = unitAt(this.state, x, y) ?? unitAt(this.state, x, y + 1);
      this.drawAim(alien?.side === 'alien' && this.canShoot(alien.id) ? alien.id : null);
      if (alien?.side === 'alien') return;
    }
    const path = y < MAP_ROWS ? pathFor(this.state, id, { x, y }) : null;
    if (!path) return;
    g.fillStyle(0xdff1ff, 0.9);
    for (const p of path.slice(0, -1)) g.fillRect(p.x * TILE + 7, p.y * TILE + 7, 2, 2);
    g.lineStyle(1, 0xdff1ff, 1).strokeRect(x * TILE + 1.5, y * TILE + 1.5, TILE - 3, TILE - 3);
  }

  /** Applies a move, then runs the sprite along the path. */
  private moveUnit(unitId: string, to: Point): void {
    const path = pathFor(this.state, unitId, to);
    const view = this.views.get(unitId);
    const before = unitById(this.state, unitId);
    if (!path || !view || !before) return;
    this.dispatch({ type: 'move', unitId, to });
    this.busy = true;
    this.pathLayer.clear();
    this.drawSelection();
    view.ghost.setVisible(false);
    const sheet = SHEETS[before.kind];
    view.sprite.play(`${sheet.key}-run`);

    const stepMs = 1000 / ANIMATION.runSpeed;
    const step = (i: number, from: Point): void => {
      const p = path[i];
      if (!p) {
        this.finishMove(unitId);
        return;
      }
      if (p.x !== from.x) this.face(view, sheet, p.x > from.x ? 1 : -1);
      this.tweens.add({
        targets: view.sprite,
        x: p.x * TILE + TILE / 2,
        y: (p.y + 1) * TILE,
        duration: stepMs,
        onUpdate: () => view.sprite.setDepth(DEPTH.standing + view.sprite.y + 0.5),
        onComplete: () => step(i + 1, p),
      });
    };
    step(0, before);
  }

  /** Draws the reticle and hit chance over a target, or clears them for null. */
  private drawAim(targetId: string | null): void {
    this.aimLayer.clear();
    this.aimText.setVisible(false);
    const shooter = this.state.selected;
    const target = targetId ? unitById(this.state, targetId) : undefined;
    const view = targetId ? this.views.get(targetId) : undefined;
    const chance = shooter && targetId ? hitChance(this.state, shooter, targetId) : null;
    if (!target || !view || chance === null) return;
    const height = SHEETS[target.kind].height;
    drawReticle(this.aimLayer, view.sprite.x, view.sprite.y, height);
    this.aimText
      .setText(`${chance}%`)
      .setPosition(view.sprite.x, view.sprite.y - height - 8)
      .setVisible(true);
  }

  /** Fires at the target, then plays the shot: turn, muzzle, bullet, hit or miss. */
  private fire(targetId: string): void {
    const shooterId = this.state.selected;
    if (!shooterId) return;
    const next = apply(this.state, { type: 'shoot', unitId: shooterId, targetId });
    const shot = next.lastShot;
    if (next === this.state || !shot) return;
    this.state = next;
    this.aimTarget = null;
    this.busy = true;
    this.drawAim(null);
    this.pathLayer.clear();
    this.drawSelection();

    const shooter = unitById(next, shooterId);
    const target = unitById(next, targetId);
    const sv = this.views.get(shooterId);
    const tv = this.views.get(targetId);
    if (!shooter || !target || !sv || !tv) return;
    const sheet = SHEETS[shooter.kind];
    this.face(sv, sheet, shooter.facing);
    sv.sprite.play(`${sheet.key}-shoot`);

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
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.tweens.add({
      targets: bullet,
      x: to.x,
      y: to.y,
      duration: Math.max(120, dist * 2.5),
      onComplete: () => {
        bullet.destroy();
        this.resolveShot(shot, tv, target);
      },
    });
  }

  private resolveShot(
    shot: NonNullable<BattleState['lastShot']>,
    tv: UnitView,
    target: Unit,
  ): void {
    const headY = tv.sprite.y - SHEETS[target.kind].height;
    tv.shownHp = target.hp;
    if (!shot.hit) {
      floatText(this, tv.sprite.x, headY - 6, 'MISS', '#dfe4ec', DEPTH.fx);
    } else {
      playOnce(this, EFFECTS.hit.key, tv.sprite.x, tv.sprite.y - 14, DEPTH.fx);
      flash(this, tv.sprite);
      floatText(this, tv.sprite.x, headY - 6, `-${shot.damage}`, '#ff6a5a', DEPTH.fx);
    }
    if (shot.killed) {
      tv.ghost.setVisible(false);
      if (target.kind === 'marine') {
        tv.sprite.play(`${MARINE_SHEET.key}-die`);
      } else {
        playOnce(this, EFFECTS.death.key, tv.sprite.x, tv.sprite.y - 16, DEPTH.fx);
        this.tweens.add({ targets: tv.sprite, alpha: 0, delay: 150, duration: 300 });
      }
    }
    this.time.delayedCall(650, () => {
      const shooter = unitById(this.state, shot.shooterId);
      const sv = this.views.get(shot.shooterId);
      if (shooter && sv) sv.sprite.play(`${SHEETS[shooter.kind].key}-idle`);
      this.busy = false;
      this.updateHidden();
      this.drawSelection();
    });
  }

  private finishMove(unitId: string): void {
    const unit = unitById(this.state, unitId);
    const view = this.views.get(unitId);
    if (unit && view) {
      const sheet = SHEETS[unit.kind];
      this.face(view, sheet, unit.facing);
      view.ghost.setPosition(view.sprite.x, view.sprite.y);
      view.sprite.play(`${sheet.key}-idle`);
    }
    this.busy = false;
    this.updateHidden();
    this.drawSelection();
  }

  /** Turns a unit's sprite (and its ghost) to face left or right. */
  private face(view: UnitView, sheet: CharacterSheet, facing: 1 | -1): void {
    const flip = facing === -1;
    for (const s of [view.sprite, view.ghost]) {
      s.setFlipX(flip).setOrigin(flip ? 1 - sheet.originX : sheet.originX, sheet.originY);
    }
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
    return { sprite, ghost, hidden: false, shownHp: u.hp };
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
      this.rangeLayer
        .fillStyle(0x4aa8ff, 0.3)
        .fillRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
    }
    const ap = unit.ap > 0 ? `AP ${unit.ap}/${ACTION_POINTS}` : 'NO ACTIONS LEFT';
    const aimed = this.aimTarget ? hitChance(this.state, unit.id, this.aimTarget) : null;
    const status = aimed === null ? ap : `SHOOT ${aimed}%: click again or Enter to fire`;
    this.unitText.setText(
      `PVT ${unit.name.toUpperCase()}   HP ${unit.hp}/${unit.maxHp}   ${status}`,
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
      .text(GAME_WIDTH - 6, y + 18, 'Esc: cancel   N: new map', style)
      .setOrigin(1, 0)
      .setDepth(DEPTH.hud)
      .setResolution(4);
  }
}

/** Seed from the URL (?seed=123) for repeatable runs, otherwise the default. */
function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEED;
}
