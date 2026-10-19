import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/config/tuning';
import {
  SHIP_FRAMES,
  SHIP_PALETTE,
  SHIP_PICTURES,
  SHIP_SOURCES,
  SHIP_TEXTURE,
} from '../../src/scenes/shipArt';

describe("the alien ship's drawn art", () => {
  it('pictures are one tile wide, rectangular, and use only palette colours', () => {
    for (const [name, rows] of Object.entries(SHIP_PICTURES)) {
      for (const row of rows) {
        expect(row, name).toHaveLength(TILE);
        for (const ch of row)
          expect(ch === '.' || ch in SHIP_PALETTE, `${name}: '${ch}'`).toBe(true);
      }
    }
  });

  it('frames sit inside the texture, and drawn frames match their pictures', () => {
    for (const [name, [x, y, w, h]] of Object.entries(SHIP_FRAMES)) {
      expect(x + w, name).toBeLessThanOrEqual(SHIP_TEXTURE.width);
      expect(y + h, name).toBeLessThanOrEqual(SHIP_TEXTURE.height);
    }
    for (const [name, rows] of Object.entries(SHIP_PICTURES)) {
      const frame = SHIP_FRAMES[name as keyof typeof SHIP_FRAMES];
      expect(frame[2], name).toBe(rows[0]?.length);
      expect(frame[3], name).toBe(rows.length);
    }
  });

  it('loads only our own bundled files', () => {
    for (const s of Object.values(SHIP_SOURCES))
      expect(s.url).toMatch(/^assets\/ship\/[a-z0-9-]+\.png$/);
  });
});
