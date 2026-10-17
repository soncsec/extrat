import Phaser from 'phaser';
import { DEFAULT_SEED, GAME_WIDTH, HUD_HEIGHT, MAP_COLS, MAP_ROWS, TILE } from '../config/tuning';
import { generateForest, PROPS, type BattleMap } from '../logic/map';
import { createRng, type Rng } from '../logic/rng';
import { addFrames, FOREST_SHEET, propFrame } from './art';

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  seed: number;
  mapSeed: number;
  /** One character per tile, row by row: '.' free, or the first letter of the prop. */
  layout: string;
}

/** Draw order: ground, then dirt, then everything standing, sorted by its bottom edge. */
const DEPTH = { ground: 0, decal: 1, standing: 10 } as const;

export class BattleScene extends Phaser.Scene {
  private seed = DEFAULT_SEED;
  private seeds!: Rng;
  private map!: BattleMap;
  private mapLayer!: Phaser.GameObjects.Container;
  private seedText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  preload(): void {
    this.load.image(FOREST_SHEET.key, FOREST_SHEET.url);
  }

  create(): void {
    addFrames(this.textures, FOREST_SHEET.key, FOREST_SHEET.frames);
    this.seed = seedFromUrl();
    this.seeds = createRng(this.seed);
    this.mapLayer = this.add.container(0, 0);

    const hudY = MAP_ROWS * TILE;
    this.add.rectangle(0, hudY, GAME_WIDTH, HUD_HEIGHT, 0x11141b).setOrigin(0).setDepth(1000);
    this.add.rectangle(0, hudY, GAME_WIDTH, 1, 0x2b3242).setOrigin(0).setDepth(1000);
    this.seedText = this.add
      .text(6, hudY + 6, '', { fontFamily: 'monospace', fontSize: '10px', color: '#8d97a8' })
      .setDepth(1000)
      .setResolution(4);

    this.showMap(this.seed);
    this.input.keyboard?.on('keydown-N', () => this.showMap(this.seeds.int(1, 999_999)));
  }

  snapshot(): GameSnapshot {
    const layout = this.map.tiles.map((t) => (t.prop ? t.prop[0] : '.')).join('');
    return { seed: this.seed, mapSeed: this.map.seed, layout };
  }

  private showMap(seed: number): void {
    this.map = generateForest(seed, MAP_COLS, MAP_ROWS);
    this.mapLayer.removeAll(true);
    const { key } = FOREST_SHEET;
    const add = (x: number, y: number, frame: string, depth: number): Phaser.GameObjects.Image =>
      this.add.image(x, y, key, frame).setDepth(depth);

    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        this.mapLayer.add(add(x * TILE, y * TILE, 'grass', DEPTH.ground).setOrigin(0));
      }
    }
    for (const d of this.map.decals) {
      this.mapLayer.add(add(d.x * TILE, d.y * TILE, `dirt${d.kind}`, DEPTH.decal).setOrigin(0));
    }
    this.map.tiles.forEach((t, i) => {
      if (!t.prop || !t.anchor) return;
      const x = i % this.map.cols;
      const y = Math.floor(i / this.map.cols);
      const centerX = (x + PROPS[t.prop].width / 2) * TILE;
      const bottom = (y + 1) * TILE;
      const img = add(centerX, bottom, propFrame(t.prop, x, y), DEPTH.standing + bottom);
      this.mapLayer.add(img.setOrigin(0.5, 1));
    });
    // Containers draw children in list order, so sort by depth.
    this.mapLayer.sort('depth');
    this.seedText.setText(`FOREST  ·  map ${this.map.seed}  ·  N: new map`);
  }
}

/** Seed from the URL (?seed=123) for repeatable runs, otherwise the default. */
function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEED;
}
