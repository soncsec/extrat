import type Phaser from 'phaser';

/*
 * The alien ship's art (M4.3). The pack has the floor, the hull wall and specimen tanks,
 * but nothing low to hide behind, so a crate, a console and a bulkhead pillar are drawn
 * here in the Top-Down Dungeon Sci-Fi tileset's own colours. Everything is painted into
 * one canvas texture, so the ship draws from a single sheet like the other landscapes.
 */

/** The tileset's own colours, by the letter used in the pictures below. */
export const SHIP_PALETTE: Readonly<Record<string, string>> = {
  k: '#0c1a26', // outline
  R: '#445a5e', // metal rim, lit
  m: '#2f3e41', // metal top
  f: '#1a2e39', // metal face
  d: '#132432', // metal face, shaded
  p: '#593e66', // hull purple, lit
  q: '#3f294b', // hull purple
  a: '#2a1c34', // hull purple, dark
  g: '#67334f', // magenta trim
  l: '#ff5db9', // pink light
  w: '#fff2f9', // light glint
};

/** One picture per drawn piece; '.' is transparent. Each is one tile wide. */
export const SHIP_PICTURES: Readonly<Record<'crate' | 'console' | 'pillar', readonly string[]>> = {
  crate: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kRRRRRRRRRRRRk.',
    '.kRmmmmppmmmmRk.',
    '.kRmmmmppmmmmRk.',
    '.kRmmmmppmmmmRk.',
    '.kRmmmmppmmmmRk.',
    '.kRRRRRRRRRRRRk.',
    '.kkkkkkkkkkkkkk.',
    '.kffffffqqffffk.',
    '.kfddddfqqfddfk.',
    '.kfdlldfqqfddfk.',
    '.kfddddfqqfddfk.',
    '.kffffffqqffffk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  console: [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kppppppppppk..',
    '..kpkkkkkkkkpk..',
    '..kpkllwlllkpk..',
    '..kpkllllllkpk..',
    '..kpkkkkkkkkpk..',
    '..kqqqqqqqqqqk..',
    '.kqqaaaaaaaaqqk.',
    '.kqaawaaawaaaqk.',
    '.kqaaaaaaaaaaqk.',
    '.kqaagglaaaaaqk.',
    '.kqqqqqqqqqqqqk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  pillar: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kppppppppppppk.',
    '.kpRRRRRRRRRRpk.',
    '.kppppppppppppk.',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqapaaaapaqk..',
    '..kqapaaaapaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaallaaaqk..',
    '..kqaaawlaaaqk..',
    '..kqaaallaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqapaaaapaqk..',
    '..kqapaaaapaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaaaaaaaqk..',
    '..kqaaallaaaqk..',
    '..kqaaaaaaaaqk..',
    '.kppppppppppppk.',
    '.kpRRRRRRRRRRpk.',
    '.kpmmmmmmmmmmpk.',
    '.kpddddddddddpk.',
    '.kppppppppppppk.',
    '.kkkkkkkkkkkkkk.',
  ],
};

/** Where each source image goes in the ship texture. */
export const SHIP_SOURCES = {
  tiles: { key: 'ship-tiles', url: 'assets/ship/tileset-top-down-sci-fi.png', x: 0 },
  tank1: { key: 'ship-tank-1', url: 'assets/ship/tank-1.png', x: 288 },
  tank2: { key: 'ship-tank-2', url: 'assets/ship/tank-2.png', x: 336 },
  tank3: { key: 'ship-tank-3', url: 'assets/ship/tank-3.png', x: 384 },
} as const;

/** The drawn pieces' top-left corners in the ship texture. */
const DRAWN_AT = { crate: [432, 0], console: [432, 16], pillar: [448, 0] } as const;

export const SHIP_TEXTURE = { key: 'ship', width: 464, height: 176 } as const;

/** Frames in the ship texture: [x, y, width, height]. */
export const SHIP_FRAMES = {
  // Floor plates, and grates laid over them as decals.
  plateA: [0, 80, 16, 16],
  plateB: [16, 80, 16, 16],
  plateC: [32, 80, 16, 16],
  plateD: [224, 80, 16, 16],
  grateA: [176, 96, 48, 48],
  grateB: [16, 112, 32, 48],
  // The hull wall: one tile wide and two tall (pipes on top, the wall's face below).
  hullA: [208, 48, 16, 32],
  hullB: [240, 48, 16, 32],
  hullC: [272, 48, 16, 32],
  hullLights: [128, 48, 16, 32],
  hullConsole: [16, 48, 16, 32],
  tank1: [288, 0, 48, 122],
  tank2: [336, 0, 48, 122],
  tank3: [384, 0, 48, 122],
  crate: [432, 0, 16, 16],
  console: [432, 16, 16, 16],
  pillar: [448, 0, 16, 30],
} as const;

/** Paints a picture with its top-left at (x, y). */
function paint(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number): void {
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const color = SHIP_PALETTE[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x + i, y + j, 1, 1);
    });
  });
}

/** Builds the ship texture from the loaded images and the drawn pieces (call once, after loading). */
export function buildShipTexture(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(SHIP_TEXTURE.key, SHIP_TEXTURE.width, SHIP_TEXTURE.height);
  if (!tex) throw new Error('could not create the ship texture');
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  for (const s of Object.values(SHIP_SOURCES)) {
    ctx.drawImage(textures.get(s.key).getSourceImage() as CanvasImageSource, s.x, 0);
  }
  for (const [name, [x, y]] of Object.entries(DRAWN_AT)) {
    paint(ctx, SHIP_PICTURES[name as keyof typeof SHIP_PICTURES], x, y);
  }
  tex.refresh();
}
