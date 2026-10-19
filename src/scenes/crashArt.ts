import type Phaser from 'phaser';
import { CRASH_KEY, FOREST_SHEET } from './art';

/*
 * The alien crash site's art (M4.3): a forest clearing where part of the alien ship came
 * down. The ground, trees and rocks are the forest's; the wreckage and burnt ground
 * aren't in the pack, so they are drawn here in the ship's colours (shipArt.ts) and in
 * soot and embers. Everything is painted into one canvas texture with the forest sheet.
 */

/** Colours by the letter used in the pictures below. */
export const CRASH_PALETTE: Readonly<Record<string, string>> = {
  k: '#0c1a26', // outline (the ship's)
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
  s: '#17130f', // soot
  c: '#2a2119', // charred ground
  e: '#43362a', // scorched earth
  o: '#e8742a', // ember
  y: '#f6c453', // ember, bright
};

type CrashPicture = 'wreck' | 'wreckB' | 'scrapA' | 'scrapB' | 'scorchA' | 'scorchB';

/**
 * One picture per drawn piece; '.' is transparent. The wreck is a torn hull section
 * on 3 x 2 tiles (wreckB is the same, mirrored, so they don't all lie the same way).
 * Scrap is one tile, in plain metal: no lights, which could pass for eyes in the fog.
 * The scorch marks are walkable decals.
 */
export const CRASH_PICTURES: Readonly<Record<CrashPicture, readonly string[]>> = {
  wreck: [
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '.........kkkkkkkkkkkkkkkkkkkkkkk....kkkk........',
    '......kkkRRRRRRaRRRRRRRRRRRRRaRRkcckRRRRkc......',
    '....kkpppppppppapppppppppppppappkccckkkkc.......',
    '...kpppppppppppapppppppppppppappkkkcccc.........',
    '..kppppppppppppappppapaaaapppapppppkckkk........',
    '..kqqqRqqqqqqqqRqqqaaaaaaqaaqaqqqRqkkRRRk.......',
    '..kqqqqqqqqqqqqaqqaqaqqaaaqqqaqqqqqkkdddk.......',
    '..kqqqqqqqqqqqqaqqqaqqqqaaqaqaqqkkkcckok........',
    '..kqqqqqqqqqqqqaqqqqqqqqaqqqqaqqkcccckqk........',
    '..kqqqRqqqqqqqqRqqqqqqqqRqqqqaqqkkccckqqk.......',
    '..kqqqqqqqqqqqqaqqqqqqqqqqqqqaqqqqkccckk........',
    '..kggggggggggggggggggggggggggggggggkc...........',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaak............',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaaakkkko.......',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqakaaaakRRRRk......',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaakoydddk......',
    '..kqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkkksskkkk.......',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaakkss............',
    '..kaaaawlllaaaaqaaaaaaaaaaaaaqaaaakkks..........',
    '..kaaaallllaaaaqaaaaaaaaaaaaaqaaaaaaakkk........',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaaaaaRok.......',
    '..kqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkydk.......',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaaoaakk........',
    '..kaaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaaakkee........',
    '...kaaaaaaaaaaaqaaaaaaaaaaaaaqaaaaakcccccccee...',
    '..eckkaaaaaaaaaaaaaaaaaaaaaaaaakaaakssssssccceee',
    '..eccckkkkkkkkkkkkkkkkkkkkkkkkkskkksssssssscccce',
    '.ecccccccssssssssssssssssssssssssssssssssscccccc',
    '.ecccccccsssssssssssssssssssssssssssssssscccceee',
    '..ecccccccssssssssssssssssssssssssssssscccceeeee',
    '....eeeeeccssssssssssssssssssssssssscccceee.....',
    '..........ccsssssssssssssssssssssscceeee........',
    '...........eeccccccccceeeeeccccccce.............',
  ],
  wreckB: [
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '........kkkk....kkkkkkkkkkkkkkkkkkkkkkk.........',
    '......ckRRRRkcckRRaRRRRRRRRRRRRRaRRRRRRkkk......',
    '.......ckkkkccckppapppppppppppppapppppppppkk....',
    '.........cccckkkppapppppppppppppapppppppppppk...',
    '........kkkckpppppapppaaaapappppappppppppppppk..',
    '.......kRRRkkqRqqqaqaaqaaaaaaqqqRqqqqqqqqRqqqk..',
    '.......kdddkkqqqqqaqqqaaaqqaqaqqaqqqqqqqqqqqqk..',
    '........kokcckkkqqaqaqaaqqqqaqqqaqqqqqqqqqqqqk..',
    '........kqkcccckqqaqqqqaqqqqqqqqaqqqqqqqqqqqqk..',
    '.......kqqkccckkqqaqqqqRqqqqqqqqRqqqqqqqqRqqqk..',
    '........kkccckqqqqaqqqqqqqqqqqqqaqqqqqqqqqqqqk..',
    '...........ckggggggggggggggggggggggggggggggggk..',
    '............kaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '.......okkkkaaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '......kRRRRkaaaakaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '......kdddyokaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '.......kkkksskkkqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk..',
    '............sskkaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '..........skkkaaaaqaaaaaaaaaaaaaqaaaalllwaaaak..',
    '........kkkaaaaaaaqaaaaaaaaaaaaaqaaaallllaaaak..',
    '.......koRaaaaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '.......kdykqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk..',
    '........kkaaoaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '........eekkaaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaaak..',
    '...eeccccccckaaaaaqaaaaaaaaaaaaaqaaaaaaaaaaak...',
    'eeecccsssssskaaakaaaaaaaaaaaaaaaaaaaaaaaaakkce..',
    'eccccsssssssskkkskkkkkkkkkkkkkkkkkkkkkkkkkccce..',
    'ccccccsssssssssssssssssssssssssssssssssccccccce.',
    'eeeccccssssssssssssssssssssssssssssssssccccccce.',
    'eeeeeccccsssssssssssssssssssssssssssssccccccce..',
    '.....eeeccccssssssssssssssssssssssssscceeeee....',
    '........eeeeccsssssssssssssssssssssscc..........',
    '.............eccccccceeeeecccccccccee...........',
  ],
  scrapA: [
    '................',
    '................',
    '......kkkkkkkkk.',
    '.....kppppappppk',
    '.....kppppappppk',
    '....kpRppappppk.',
    '....kqqqqaqqqqk.',
    '....kqqqqaqqqqk.',
    '...kqqqqaqqqqk..',
    '...kqqqqaqRqqk..',
    '...kqqqqaqqqqk..',
    '..kqqqqgqqqqk...',
    '..kqqqqaqqqqosc.',
    '.ckaaaaaaaaakss.',
    '...kkkkkkkkkssc.',
    '....ccsssssc....',
  ],
  scrapB: [
    '................',
    '................',
    '................',
    '................',
    '...kkkkkkkk.....',
    '..kRRRRRRRRk....',
    '..kmmmmmmmmkk...',
    '..kmmmmmmmmmmkk.',
    '..kmmmmmmfffRRRk',
    '..kmfffffdddfkk.',
    '..kmmmmmmffffk..',
    '..kmmmmmmffffk..',
    '..kmfffffdddfkc.',
    '.ckmmmmmmffffksc',
    '..ckkkkkkkkkksc.',
    '....ccssssscc...',
  ],
  scorchA: [
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '......................eeeee.....................',
    '....................eeeeeeeeee..................',
    '..................eeeeeeeeeeeeeeeeeee...........',
    '..............eeeeeeeeeeeeeeeeeeeeeeee..........',
    '............eeeeeeeeeeeeccccccccceeeeee.........',
    '..........eeeeeeeeeeecccccccccccccceeee.........',
    '.........eeeeeeeeeecccccccccsssccccceee.........',
    '.........eeeeeeeccccccccccsssssscccceeee........',
    '........eeeeeecccccccsssossssssccccceeee........',
    '........eeeeeccccccsssssssssssscccceeeee........',
    '.........eeecccccsssosssssssssccccceeeee........',
    '.........eecccccsssssssssssssscccceeeee.........',
    '.........eecccccsssssssssssssccccceeeee.........',
    '.........eecccccsssssssssssosccccceeeee.........',
    '.........eeeccccsssssssssssssccccceeeeee........',
    '.........eeecccccssssssssssscccccceeeeeee.......',
    '.........eeecccccsssssssssscccccccceeeeeee......',
    '.........eeeecccccsssssccccccccceeeeeeeeeee.....',
    '.........eeeeecccccccccccccccceeeeeeeeeeee......',
    '..........eeeeeccccccccccccceeeeeeeeeeeee.......',
    '..........eeeeeeeccccceeeeeeeeeeeeeeee..........',
    '...........eeeeeeeeeeeeeeeeeeeee................',
    '............eeeeeeeeeeeeeeee....................',
    '.............ee.................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
  ],
  scorchB: [
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '.................eeeeeeee.......................',
    '................eeeeeeeeee......................',
    '...............eeeeeeeeeeee.....................',
    '...........eeeeeeeeccccceeeeeeee................',
    '........eeeeeeeeeeccccccceeeeeeeeeee............',
    '......eeeeeeeeeeeccccccccceeeeeeeeeee...........',
    '......eeeeeeeeecccccccccccceeeeeeeeeee..........',
    '.....eeeeeeeeccccccccccccccccceeeeeeee..........',
    '.....eeeeeeccccccccccccccccccccceeeeee..........',
    '....eeeeeeccccccccccccccccccccccceeeeee.........',
    '....eeeeeccccccccccccccccccccccccceeeee.........',
    '.....eeeeecccccccccccccccccccccccceeeee.........',
    '.....eeeeeeccccccccccccccccccccccceeeee.........',
    '......eeeeeecccccccccccccccccccccceeeee.........',
    '.......eeeeeeccccccccccccccccccccceeeee.........',
    '........eeeeeeccceeeeeecccccccccceeeee..........',
    '.........eeeeeeeeeeeeeeeccccccccceeeee..........',
    '.........eeeeeeeeeeeeeeeeccccccceeeeee..........',
    '..........eeeeeeeeeeeeeeeeccccceeeeee...........',
    '...........eeeeeeeeeeeeeeeeeeeeeee..............',
    '...........eeeeeeeeeeeeeeeeeeeee................',
    '............eeeeeeeeeeeeeeeeee..................',
    '............eeeeeeeeeeeeee......................',
    '.............eeeeeeeeeeee.......................',
    '.................eeeeee.........................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
  ],
};

/** Where the forest sheet and each drawn piece go in the crash texture. */
const FOREST_AT = [0, 0] as const;
const DRAWN_AT: Readonly<Record<CrashPicture, readonly [number, number]>> = {
  wreck: [432, 0],
  wreckB: [496, 0],
  scrapA: [480, 0],
  scrapB: [480, 16],
  scorchA: [432, 48],
  scorchB: [432, 96],
};

export const CRASH_TEXTURE = { key: CRASH_KEY, width: 544, height: 176 } as const;

/** Frames in the crash texture: [x, y, width, height]. The forest's keep their places. */
export const CRASH_FRAMES = {
  ...FOREST_SHEET.frames,
  wreck: [432, 0, 48, 40],
  wreckB: [496, 0, 48, 40],
  scrapA: [480, 0, 16, 16],
  scrapB: [480, 16, 16, 16],
  scorchA: [432, 48, 48, 48],
  scorchB: [432, 96, 48, 48],
} as const;

/** Paints a picture with its top-left at (x, y). */
function paint(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number): void {
  rows.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const color = CRASH_PALETTE[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x + i, y + j, 1, 1);
    });
  });
}

/** Builds the crash texture from the loaded forest sheet and the drawn pieces (once, after loading). */
export function buildCrashTexture(textures: Phaser.Textures.TextureManager): void {
  const tex = textures.createCanvas(CRASH_TEXTURE.key, CRASH_TEXTURE.width, CRASH_TEXTURE.height);
  if (!tex) throw new Error('could not create the crash texture');
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const forest = textures.get(FOREST_SHEET.key).getSourceImage() as CanvasImageSource;
  ctx.drawImage(forest, FOREST_AT[0], FOREST_AT[1]);
  for (const [name, [x, y]] of Object.entries(DRAWN_AT)) {
    paint(ctx, CRASH_PICTURES[name as CrashPicture], x, y);
  }
  tex.refresh();
}
