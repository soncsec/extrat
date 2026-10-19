import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/config/tuning';
import { PROPS } from '../../src/logic/map';
import {
  COAST_FRAMES,
  COAST_PALETTE,
  COAST_PICTURES,
  COAST_TEXTURE,
  SAND_FOR_GRASS,
} from '../../src/scenes/coastArt';

describe("the coast's drawn art (M4.3)", () => {
  it('pictures are rectangular and use only palette colours', () => {
    for (const [name, rows] of Object.entries(COAST_PICTURES)) {
      for (const row of rows) {
        expect(row, name).toHaveLength(rows[0]?.length ?? 0);
        for (const ch of row)
          expect(ch === '.' || ch in COAST_PALETTE, `${name}: '${ch}'`).toBe(true);
      }
    }
  });

  it('draws the sea one tile wide and two tall, ground one tile, a boat on two tiles', () => {
    for (const s of [COAST_PICTURES.seaA, COAST_PICTURES.seaB, COAST_PICTURES.seaC]) {
      expect(s).toHaveLength(2 * TILE);
      expect(s[0]).toHaveLength(TILE);
    }
    for (const g of [COAST_PICTURES.sandA, COAST_PICTURES.sandB, COAST_PICTURES.shore]) {
      expect(g).toHaveLength(TILE);
      expect(g[0]).toHaveLength(TILE);
      // Ground is solid: no see-through pixels.
      expect(g.join('')).not.toContain('.');
    }
    expect(COAST_PICTURES.boat[0]).toHaveLength(PROPS.boat.width * TILE);
  });

  it('frames sit inside the texture and never overlap the forest sheet or each other', () => {
    const drawn = Object.keys(COAST_PICTURES).concat(['rocksSand', 'boulderSand']);
    for (const [name, [x, y, w, h]] of Object.entries(COAST_FRAMES)) {
      expect(x + w, name).toBeLessThanOrEqual(COAST_TEXTURE.width);
      expect(y + h, name).toBeLessThanOrEqual(COAST_TEXTURE.height);
    }
    const boxes = drawn.map((n) => COAST_FRAMES[n] as readonly [number, number, number, number]);
    for (const [x] of boxes) expect(x).toBeGreaterThanOrEqual(432);
    boxes.forEach(([ax, ay, aw, ah], i) =>
      boxes.slice(i + 1).forEach(([bx, by, bw, bh]) => {
        expect(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay).toBe(true);
      }),
    );
  });

  it('swaps grass colours for sand colours from the palette', () => {
    for (const [grass, sand] of Object.entries(SAND_FOR_GRASS)) {
      expect(grass).toMatch(/^#[0-9a-f]{6}$/);
      expect(Object.values(COAST_PALETTE)).toContain(sand);
    }
  });
});
