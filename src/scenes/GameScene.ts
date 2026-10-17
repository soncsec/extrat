import Phaser from 'phaser';
import { DEFAULT_SEED, GAME_HEIGHT, GAME_WIDTH, PLAYER } from '../config/tuning';
import { screenBounds, step, type Axis, type Point } from '../logic/movement';
import { createRng, type Rng } from '../logic/rng';

/** Read-only view of the game state, used by the e2e test hook. */
export interface GameSnapshot {
  player: Point;
  seed: number;
}

type Keys = Record<
  'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd',
  Phaser.Input.Keyboard.Key
>;

/** Placeholder scene: replace with the real game. */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private pos: Point = { x: 0, y: 0 };
  private keys!: Keys;
  private rng!: Rng;
  private seed = DEFAULT_SEED;
  private readonly bounds = screenBounds(GAME_WIDTH, GAME_HEIGHT, PLAYER.size);

  constructor() {
    super('Game');
  }

  create(): void {
    this.seed = seedFromUrl();
    this.rng = createRng(this.seed);
    // A seeded star field shows the RNG in use; same ?seed= gives the same stars.
    for (let i = 0; i < 60; i++) {
      this.add.rectangle(
        this.rng.int(0, GAME_WIDTH - 1),
        this.rng.int(0, GAME_HEIGHT - 1),
        1,
        1,
        0xffffff,
        0.6,
      );
    }
    this.pos = { x: GAME_WIDTH / 2, y: GAME_HEIGHT * PLAYER.startY };
    this.player = this.add.rectangle(
      this.pos.x,
      this.pos.y,
      PLAYER.size,
      PLAYER.size,
      PLAYER.color,
    );

    const kb = this.input.keyboard;
    if (!kb) throw new Error('keyboard input is not available');
    this.keys = kb.addKeys({
      up: 'UP',
      down: 'DOWN',
      left: 'LEFT',
      right: 'RIGHT',
      w: 'W',
      a: 'A',
      s: 'S',
      d: 'D',
    }) as Keys;
  }

  override update(_time: number, deltaMs: number): void {
    this.pos = step(this.pos, this.readAxis(), deltaMs / 1000, PLAYER.speed, this.bounds);
    this.player.setPosition(this.pos.x, this.pos.y);
  }

  snapshot(): GameSnapshot {
    return { player: { ...this.pos }, seed: this.seed };
  }

  private readAxis(): Axis {
    const k = this.keys;
    const left = k.left.isDown || k.a.isDown;
    const right = k.right.isDown || k.d.isDown;
    const up = k.up.isDown || k.w.isDown;
    const down = k.down.isDown || k.s.isDown;
    return {
      x: left === right ? 0 : left ? -1 : 1,
      y: up === down ? 0 : up ? -1 : 1,
    };
  }
}

/** Seed from the URL (?seed=123) for repeatable runs, otherwise the default. */
function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEED;
}
