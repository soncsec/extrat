import type Phaser from 'phaser';
import { FOREST } from '../config/tuning';
import type { UnitKind } from '../logic/battle';
import type { LandscapeId } from '../logic/landscapes';
import type { PropKind } from '../logic/map';
import { SHIP_TEXTURE } from './shipArt';

/** The crash site's texture (crashArt.ts builds it from the forest sheet and drawn pieces). */
export const CRASH_KEY = 'crash';
/** The coast's texture (coastArt.ts builds it from the forest sheet and drawn pieces). */
export const COAST_KEY = 'coast';
/** The rocky hills' texture (hillsArt.ts builds it from the mountain and forest sheets). */
export const HILLS_KEY = 'hills';
/** The coast's sandy rows below the sea; the row after them is where sand meets grass. */
const BEACH_ROWS = { first: FOREST.treeLineRows, last: FOREST.treeLineRows + 2 } as const;

/** Where each piece of art sits in its sheet. Pixel rectangles measured from the files. */
export const FOREST_SHEET = {
  key: 'forest',
  url: 'assets/forest/top-down-forest-tileset.png',
  frames: {
    grass: [128, 32, 16, 16],
    bushA: [128, 64, 16, 16],
    bushB: [128, 128, 16, 16],
    rocks: [128, 96, 16, 16],
    oak: [160, 48, 48, 48],
    pine: [160, 112, 48, 48],
    boulder: [224, 64, 32, 32],
    dirt0: [64, 32, 48, 48],
    dirt1: [64, 96, 48, 64],
  },
} as const;

/** The Tiny RPG town tileset (M4.3): autumn trees, a cottage, garden walls, shrubs. */
export const TOWN_SHEET = {
  key: 'town',
  url: 'assets/town/top-down-town-tileset.png',
  frames: {
    townGrass: [288, 16, 16, 16],
    townGrassB: [304, 16, 16, 16],
    townTuft: [320, 16, 16, 16],
    townFlowers: [336, 16, 16, 16],
    autumn: [118, 16, 54, 63],
    cypress: [33, 96, 15, 31],
    stump: [64, 99, 32, 29],
    shrubA: [113, 96, 14, 16],
    shrubB: [145, 96, 14, 16],
    stone: [37, 167, 25, 25],
    ledge: [112, 160, 16, 16],
    house: [192, 25, 80, 127],
    path: [320, 80, 48, 48],
  },
} as const;

/** How a landscape is drawn: its sheet, ground, decals and the picture for each prop. */
export interface LandscapeArt {
  key: string;
  /** Ground tiles, picked by position for a little variety. */
  ground: readonly string[];
  /** The ground tile at a position, for landscapes whose ground changes by row. */
  groundAt?(x: number, y: number, hash: number): string;
  /** Pictures for decal kinds 0 and 1 (walkable patches drawn on the ground). */
  decals: readonly [string, string];
  /** The frame for a prop at a tile. */
  prop(kind: PropKind, x: number, y: number): string;
}

/** Two pictures alternating by position, so rows of the same prop don't look stamped. */
const alternate = (a: string, b: string, x: number, y: number): string =>
  (x * 31 + y * 17) % 2 === 0 ? a : b;

export const LANDSCAPE_ART: Readonly<Record<LandscapeId, LandscapeArt>> = {
  forest: {
    key: FOREST_SHEET.key,
    ground: ['grass'],
    decals: ['dirt0', 'dirt1'],
    prop: (kind, x, y) => (kind === 'bush' ? alternate('bushA', 'bushB', x, y) : kind),
  },
  town: {
    key: TOWN_SHEET.key,
    // Mostly plain grass; tufts and flowers now and then.
    ground: [
      ...Array<string>(6).fill('townGrass'),
      ...Array<string>(5).fill('townGrassB'),
      'townTuft',
      'townTuft',
      'townFlowers',
    ],
    decals: ['path', 'townFlowers'],
    prop: (kind, x, y) => (kind === 'shrub' ? alternate('shrubA', 'shrubB', x, y) : kind),
  },
  coast: {
    key: COAST_KEY,
    ground: ['grass'],
    // Sand below the sea, then a row where the beach meets the grass, then grass.
    groundAt: (_x, y, hash) => {
      if (y <= BEACH_ROWS.last) return hash % 3 === 0 ? 'sandB' : 'sandA';
      return y === BEACH_ROWS.last + 1 ? 'shore' : 'grass';
    },
    decals: ['dirt0', 'dirt1'],
    prop: (kind, x, y) => {
      if (kind === 'sea') return SEA[(Math.imul(x + 5, 2654435761) >>> 0) % SEA.length] as string;
      // On the beach, rocks and boulders without the forest's ring of grass.
      if (y <= BEACH_ROWS.last && kind === 'rocks') return 'rocksSand';
      if (y <= BEACH_ROWS.last && kind === 'boulder') return 'boulderSand';
      if (kind === 'bush') return alternate('bushA', 'bushB', x, y);
      return kind;
    },
  },
  hills: {
    key: HILLS_KEY,
    // Mostly bare gravel; grass tufts and pebbles now and then.
    ground: [...Array<string>(9).fill('gravel'), 'tuftA', 'tuftB', 'pebbles'],
    decals: ['patch', 'pebbles'],
    prop: (kind, x, y) => {
      if (kind === 'cliff') return alternate('cliffA', 'cliffB', x, 0);
      if (kind === 'pine') return 'pineGravel';
      if (kind === 'bush') return alternate('bushGravelA', 'bushGravelB', x, y);
      return kind;
    },
  },
  crash: {
    key: CRASH_KEY,
    ground: ['grass'],
    decals: ['scorchA', 'scorchB'],
    prop: (kind, x, y) => {
      if (kind === 'bush') return alternate('bushA', 'bushB', x, y);
      if (kind === 'scrap') return alternate('scrapA', 'scrapB', x, y);
      if (kind === 'wreck') return alternate('wreck', 'wreckB', x, y);
      return kind;
    },
  },
  ship: {
    key: SHIP_TEXTURE.key,
    // Mostly the same plate; the others break up the grid now and then.
    ground: [...Array<string>(8).fill('plateA'), 'plateB', 'plateB', 'plateC', 'plateD'],
    decals: ['grateA', 'grateB'],
    prop: (kind, x, y) => {
      if (kind === 'hull')
        return HULL[(Math.imul(x + 3, 2654435761) >>> 0) % HULL.length] as string;
      if (kind === 'tank') return TANKS[(x + y) % TANKS.length] as string;
      return kind;
    },
  },
};

/** Hull pieces along the ship's wall: plain mostly, with lights and consoles here and there. */
const HULL = ['hullA', 'hullB', 'hullC', 'hullA', 'hullB', 'hullLights', 'hullC', 'hullConsole'];
const TANKS = ['tank1', 'tank2', 'tank3'];
/** The sea's pieces along the coast: each wave pattern shifted, so the edge doesn't repeat. */
const SEA = ['seaA', 'seaB', 'seaC'];

/** Adds the named frames to a loaded sheet's texture. */
export function addFrames(
  textures: Phaser.Textures.TextureManager,
  key: string,
  frames: Readonly<Record<string, readonly [number, number, number, number]>>,
): void {
  const tex = textures.get(key);
  for (const [name, [x, y, w, h]] of Object.entries(frames)) tex.add(name, 0, x, y, w, h);
}

/** A character sheet: frames of equal size, and where the feet are inside a frame. */
export interface CharacterSheet {
  key: string;
  url: string;
  frameWidth: number;
  frameHeight: number;
  /**
   * Feet position as a fraction of the frame, as drawn in the sheet. A flyer's "feet"
   * are below it: the point over its tile, so it hovers.
   */
  originX: number;
  originY: number;
  /** Height of the character above its feet, in pixels (for markers over its head). */
  height: number;
  /** Where shots leave from, relative to the feet, for a sprite facing right. */
  muzzle: { x: number; y: number };
  /** Animations: first frame index and frame count. */
  anims: Readonly<Record<string, { start: number; count: number; fps: number }>>;
  /** The sheet draws the character facing left (the others face right). */
  facesLeft?: boolean;
}

/** The marine atlas has 10 columns; each row is one animation. */
export const MARINE_SHEET: CharacterSheet = {
  key: 'marine',
  url: 'assets/marine/space-marine.png',
  frameWidth: 75,
  frameHeight: 48,
  originX: 37.5 / 75,
  originY: 1,
  height: 36,
  muzzle: { x: 20, y: 22 },
  anims: {
    idle: { start: 0, count: 4, fps: 6 },
    run: { start: 10, count: 10, fps: 14 },
    die: { start: 20, count: 3, fps: 8 },
    shoot: { start: 40, count: 2, fps: 12 },
    crouch: { start: 50, count: 3, fps: 6 },
    crouchShoot: { start: 60, count: 2, fps: 10 },
  },
};

export const WALKER_SHEET: CharacterSheet = {
  key: 'walker',
  url: 'assets/alien-walker/alien-enemy-idle.png',
  frameWidth: 48,
  frameHeight: 48,
  originX: 29.5 / 48,
  originY: 45 / 48,
  height: 30,
  muzzle: { x: 14, y: 16 },
  anims: { idle: { start: 0, count: 4, fps: 5 } },
};

/**
 * The Overseer, the final mission's boss (M5.6): Warped's mech unit, ten 96 x 80 frames
 * of a heavy walk. It stands on a 2 x 2 footprint, its feet at the middle of the square.
 */
export const OVERSEER_SHEET: CharacterSheet = {
  key: 'overseer',
  url: 'assets/overseer/mech-unit.png',
  frameWidth: 96,
  frameHeight: 80,
  originX: 43 / 96,
  originY: 1,
  height: 64,
  muzzle: { x: 23, y: 30 },
  anims: {
    idle: { start: 0, count: 1, fps: 1 },
    run: { start: 0, count: 10, fps: 10 },
  },
};

export const WALKER_WALK_SHEET: CharacterSheet = {
  key: 'walker-walk',
  url: 'assets/alien-walker/alien-enemy-walk.png',
  frameWidth: 57,
  frameHeight: 42,
  originX: 30 / 57,
  originY: 38 / 42,
  height: 30,
  muzzle: WALKER_SHEET.muzzle,
  anims: { run: { start: 0, count: 6, fps: 10 } },
};

/** The flyer flaps the same way whether it hovers or moves. Measured: body 24-77 wide, 1-57 tall. */
export const FLYER_SHEET: CharacterSheet = {
  key: 'flyer',
  url: 'assets/alien-flyer/alien-flyer.png',
  frameWidth: 83,
  frameHeight: 64,
  originX: 40 / 83,
  // It hovers 8 pixels above the ground.
  originY: 66 / 64,
  height: 62,
  muzzle: { x: 12, y: 36 },
  anims: { idle: { start: 0, count: 8, fps: 12 }, run: { start: 0, count: 8, fps: 16 } },
  facesLeft: true,
};

/** Lizard frames are 64 x 32 with the body in the left 26 pixels (room for the tongue). */
export const LIZARD_SHEET: CharacterSheet = {
  key: 'lizard',
  url: 'assets/lizard/lizard-idle.png',
  frameWidth: 64,
  frameHeight: 32,
  originX: 14 / 64,
  originY: 32 / 32,
  height: 12,
  muzzle: { x: 11, y: 7 },
  anims: { idle: { start: 0, count: 4, fps: 6 } },
};

export const LIZARD_WALK_SHEET: CharacterSheet = {
  ...LIZARD_SHEET,
  key: 'lizard-walk',
  url: 'assets/lizard/lizard-walk.png',
  anims: { run: { start: 0, count: 6, fps: 12 } },
};

export const LIZARD_TONGUE_SHEET: CharacterSheet = {
  ...LIZARD_SHEET,
  key: 'lizard-tongue',
  url: 'assets/lizard/lizard-tongue.png',
  // Only the opening frames: the scene draws the tongue itself, toward any target.
  anims: { shoot: { start: 0, count: 2, fps: 10 } },
};

export const LIZARD_HURT_SHEET: CharacterSheet = {
  ...LIZARD_SHEET,
  key: 'lizard-hurt',
  url: 'assets/lizard/lizard-hurt.png',
  anims: { hurt: { start: 0, count: 3, fps: 10 } },
};

export const SNAKE_SHEET: CharacterSheet = {
  key: 'snake',
  url: 'assets/snake/snake-idle.png',
  frameWidth: 20,
  frameHeight: 20,
  originX: 9 / 20,
  originY: 20 / 20,
  height: 17,
  muzzle: { x: 11, y: 14 },
  anims: { idle: { start: 0, count: 4, fps: 6 } },
};

export const SNAKE_WALK_SHEET: CharacterSheet = {
  ...SNAKE_SHEET,
  key: 'snake-walk',
  url: 'assets/snake/snake-walk.png',
  frameWidth: 27,
  originX: 12 / 27,
  anims: { run: { start: 0, count: 4, fps: 10 } },
};

export const SNAKE_SHOOT_SHEET: CharacterSheet = {
  ...SNAKE_SHEET,
  key: 'snake-shoot',
  url: 'assets/snake/snake-shoot.png',
  frameWidth: 27,
  frameHeight: 21,
  originX: 9 / 27,
  originY: 21 / 21,
  anims: { shoot: { start: 0, count: 4, fps: 12 } },
};

export const SNAKE_HURT_SHEET: CharacterSheet = {
  ...SNAKE_SHEET,
  key: 'snake-hurt',
  url: 'assets/snake/snake-hurt.png',
  frameWidth: 24,
  originX: 11 / 24,
  anims: { hurt: { start: 0, count: 3, fps: 10 } },
};

/** The snake's venom blob: two 7 x 5 frames. */
export const SPIT = { key: 'fx-spit', url: 'assets/snake/snake-spit.png', size: [7, 5] } as const;

export type AnimName = 'idle' | 'run' | 'die' | 'shoot' | 'hurt';

/** Which sheet holds each unit kind's animations. A missing one means the kind has none. */
export const UNIT_ANIMS: Readonly<Record<UnitKind, Partial<Record<AnimName, CharacterSheet>>>> = {
  marine: { idle: MARINE_SHEET, run: MARINE_SHEET, die: MARINE_SHEET, shoot: MARINE_SHEET },
  walker: { idle: WALKER_SHEET, run: WALKER_WALK_SHEET },
  flyer: { idle: FLYER_SHEET, run: FLYER_SHEET },
  lizard: {
    idle: LIZARD_SHEET,
    run: LIZARD_WALK_SHEET,
    shoot: LIZARD_TONGUE_SHEET,
    hurt: LIZARD_HURT_SHEET,
  },
  snake: {
    idle: SNAKE_SHEET,
    run: SNAKE_WALK_SHEET,
    shoot: SNAKE_SHOOT_SHEET,
    hurt: SNAKE_HURT_SHEET,
  },
  overseer: { idle: OVERSEER_SHEET, run: OVERSEER_SHEET },
};

/** The sheet that sets each kind's size: its height and muzzle. */
export const BASE_SHEETS: Readonly<Record<UnitKind, CharacterSheet>> = {
  marine: MARINE_SHEET,
  walker: WALKER_SHEET,
  flyer: FLYER_SHEET,
  lizard: LIZARD_SHEET,
  snake: SNAKE_SHEET,
  overseer: OVERSEER_SHEET,
};

/** Registers a sheet's animations as `<key>-<name>`, once. */
export function addAnims(anims: Phaser.Animations.AnimationManager, sheet: CharacterSheet): void {
  for (const [name, a] of Object.entries(sheet.anims)) {
    const key = `${sheet.key}-${name}`;
    if (anims.exists(key)) continue;
    anims.create({
      key,
      frames: anims.generateFrameNumbers(sheet.key, { start: a.start, end: a.start + a.count - 1 }),
      frameRate: a.fps,
      // One-off moves hold their last frame; crouch is a stand-to-crouch transition.
      repeat: ['die', 'shoot', 'crouch', 'hurt'].includes(name) ? 0 : -1,
    });
  }
}

/** One-shot effects: frames of equal size in a strip. */
export const EFFECTS = {
  death: {
    key: 'fx-death',
    url: 'assets/fx/enemy-death.png',
    frameWidth: 48,
    frameHeight: 48,
    count: 8,
    fps: 16,
  },
  blast: {
    key: 'fx-blast',
    url: 'assets/fx/grenade-blast.png',
    frameWidth: 32,
    frameHeight: 32,
    count: 8,
    fps: 16,
  },
  hit: {
    key: 'fx-hit',
    url: 'assets/fx/hit.png',
    frameWidth: 31,
    frameHeight: 32,
    count: 3,
    fps: 16,
  },
  /** An alien's shot landing: a star burst, tinted green by the scene. */
  sparkle: {
    key: 'fx-sparkle',
    url: 'assets/fx/hit-sparkle.png',
    frameWidth: 32,
    frameHeight: 32,
    count: 7,
    fps: 20,
  },
  /** A walker's claws. */
  slash: {
    key: 'fx-slash',
    url: 'assets/fx/slash.png',
    frameWidth: 65,
    frameHeight: 40,
    count: 5,
    fps: 18,
  },
  /** A small creature (lizard, snake) dying: a puff. */
  smallDeath: {
    key: 'fx-small-death',
    url: 'assets/fx/small-death.png',
    frameWidth: 64,
    frameHeight: 64,
    count: 7,
    fps: 14,
  },
} as const;

export const BULLET = { key: 'fx-bullet', url: 'assets/fx/bullet.png' } as const;
