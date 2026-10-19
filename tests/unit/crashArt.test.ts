import { describe, expect, it } from 'vitest';
import { PROPS } from '../../src/logic/map';
import { TILE } from '../../src/config/tuning';
import {
  CRASH_FRAMES,
  CRASH_PALETTE,
  CRASH_PICTURES,
  CRASH_TEXTURE,
} from '../../src/scenes/crashArt';

describe("the crash site's drawn art (M4.3)", () => {
  it('pictures are rectangular and use only palette colours', () => {
    for (const [name, rows] of Object.entries(CRASH_PICTURES)) {
      for (const row of rows) {
        expect(row, name).toHaveLength(rows[0]?.length ?? 0);
        for (const ch of row)
          expect(ch === '.' || ch in CRASH_PALETTE, `${name}: '${ch}'`).toBe(true);
      }
    }
  });

  it('draws the wreck as wide as its footprint, and scrap one tile', () => {
    expect(CRASH_PICTURES.wreck[0]).toHaveLength(PROPS.wreck.width * TILE);
    expect(CRASH_PICTURES.wreck.length).toBeGreaterThanOrEqual(PROPS.wreck.height * TILE);
    for (const s of [CRASH_PICTURES.scrapA, CRASH_PICTURES.scrapB]) {
      expect(s).toHaveLength(TILE);
      expect(s[0]).toHaveLength(TILE);
    }
  });

  it('frames sit inside the texture, and drawn frames match their pictures', () => {
    for (const [name, [x, y, w, h]] of Object.entries(CRASH_FRAMES)) {
      expect(x + w, name).toBeLessThanOrEqual(CRASH_TEXTURE.width);
      expect(y + h, name).toBeLessThanOrEqual(CRASH_TEXTURE.height);
    }
    for (const [name, rows] of Object.entries(CRASH_PICTURES)) {
      const frame = CRASH_FRAMES[name as keyof typeof CRASH_PICTURES];
      expect(frame[2], name).toBe(rows[0]?.length);
      expect(frame[3], name).toBe(rows.length);
    }
  });

  it('drawn pieces sit right of the forest sheet and never overlap', () => {
    const drawn = Object.keys(CRASH_PICTURES).map(
      (n) => CRASH_FRAMES[n as keyof typeof CRASH_PICTURES],
    );
    for (const [x] of drawn) expect(x).toBeGreaterThanOrEqual(432);
    drawn.forEach(([ax, ay, aw, ah], i) =>
      drawn.slice(i + 1).forEach(([bx, by, bw, bh]) => {
        const apart = ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay;
        expect(apart).toBe(true);
      }),
    );
  });
});
