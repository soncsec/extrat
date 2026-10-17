import Phaser from 'phaser';
import { DEFAULT_SEED, GAME_WIDTH, HUD_HEIGHT, MAP_COLS, MAP_ROWS, TILE } from '../config/tuning';
import {
  apply,
  createBattle,
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
  FOREST_SHEET,
  MARINE_SHEET,
  propFrame,
  WALKER_SHEET,
  type CharacterSheet,
} from './art';

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  seed: number;
  mapSeed: number;
  /** One character per tile, row by row: '.' free, or the first letter of the prop. */
  layout: string;
  units: { id: string; side: Side; x: number; y: number; hp: number; hidden: boolean }[];
  selected: string | null;
}

/** Draw order: ground, dirt, markers, then everything standing, sorted by its bottom edge. */
const DEPTH = { ground: 0, decal: 1, marker: 2, standing: 10, ghost: 900, hud: 1000 } as const;

const SHEETS: Record<Unit['kind'], CharacterSheet> = { marine: MARINE_SHEET, walker: WALKER_SHEET };
const GHOST_COLOR = { marine: 0x7fd4ff, alien: 0xff6a5a } as const;
/** A unit counts as hidden when a standing object in front covers this much of its body. */
const HIDDEN_OVERLAP = 0.3;

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  ghost: Phaser.GameObjects.Sprite;
  hidden: boolean;
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
  }

  create(): void {
    addFrames(this.textures, FOREST_SHEET.key, FOREST_SHEET.frames);
    for (const s of Object.values(SHEETS)) addAnims(this.anims, s);
    this.seed = seedFromUrl();
    this.seeds = createRng(this.seed);
    this.createHud();
    this.marker = this.add.graphics().setDepth(DEPTH.marker);
    this.chevron = this.add.graphics().setDepth(DEPTH.ghost + 1);
    this.tweens.add({ targets: this.chevron, y: -2, duration: 450, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: this.marker, alpha: 0.45, duration: 450, yoyo: true, repeat: -1 });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onClick(p.worldX, p.worldY));
    this.input.keyboard?.on('keydown-ESC', () => this.dispatch({ type: 'deselect' }));
    this.input.keyboard?.on('keydown-N', () => this.startBattle(this.seeds.int(1, 999_999)));

    this.startBattle(this.seed);
  }

  override update(): void {
    // Ghosts copy their unit's current animation frame.
    for (const v of this.views.values()) if (v.hidden) v.ghost.setFrame(v.sprite.frame.name);
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
        hidden: this.views.get(u.id)?.hidden ?? false,
      })),
      selected,
    };
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
    if (y >= MAP_ROWS) return;
    // Characters stand about two tiles tall, so a click on the tile above one also counts.
    const unit = unitAt(this.state, x, y) ?? unitAt(this.state, x, y + 1);
    if (unit?.side === 'marine') this.dispatch({ type: 'select', unitId: unit.id });
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
    return { sprite, ghost, hidden: false };
  }

  /** Shows a ghost for every unit that a standing object in front of it mostly covers. */
  private updateHidden(): void {
    for (const u of this.state.units) {
      const v = this.views.get(u.id);
      if (!v) continue;
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
    const unit = this.state.selected ? unitById(this.state, this.state.selected) : undefined;
    if (!unit) {
      this.chevron.clear();
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
    const top = (unit.y + 1) * TILE - SHEETS[unit.kind].height - 3;
    const cx = x + TILE / 2;
    this.chevron
      .clear()
      .fillStyle(0x11141b, 1)
      .fillTriangle(cx - 4, top - 5, cx + 4, top - 5, cx, top - 1)
      .fillStyle(0xf2a33a, 1)
      .fillTriangle(cx - 3, top - 5, cx + 3, top - 5, cx, top - 2);
    this.unitText.setText(`PVT ${unit.name.toUpperCase()}   HP ${unit.hp}/${unit.maxHp}`);
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
      .text(GAME_WIDTH - 6, y + 18, 'Esc: deselect   N: new map', style)
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
