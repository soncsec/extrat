import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/config/tuning';
import { PROPS } from '../../src/logic/map';
import { FOREST_SHEET } from '../../src/scenes/art';
import {
  GRAVEL_FOR_GRASS,
  HILLS_FRAMES,
  HILLS_SOURCE,
  HILLS_TEXTURE,
} from '../../src/scenes/hillsArt';

describe("the rocky hills' art (M4.3)", () => {
  it('loads only our own bundled file', () => {
    expect(HILLS_SOURCE.url).toMatch(/^assets\/hills\/[a-z0-9-]+\.png$/);
  });

  it('frames sit inside the texture; the mountain sheet sits below the forest sheet', () => {
    for (const [name, [x, y, w, h]] of Object.entries(HILLS_FRAMES)) {
      expect(x + w, name).toBeLessThanOrEqual(HILLS_TEXTURE.width);
      expect(y + h, name).toBeLessThanOrEqual(HILLS_TEXTURE.height);
    }
    const forestBottom = Math.max(...Object.values(FOREST_SHEET.frames).map(([, y, , h]) => y + h));
    expect(HILLS_SOURCE.y).toBeGreaterThanOrEqual(forestBottom);
  });

  it('draws props as wide as their footprints, and the cliff two tiles tall', () => {
    expect(HILLS_FRAMES.crag[2]).toBe(PROPS.crag.width * TILE);
    expect(HILLS_FRAMES.slabs[2]).toBe(PROPS.slabs.width * TILE);
    expect(HILLS_FRAMES.mine[2]).toBe(PROPS.mine.width * TILE);
    expect(HILLS_FRAMES.mine[3]).toBeGreaterThanOrEqual(PROPS.mine.height * TILE);
    expect(HILLS_FRAMES.cliffA[3]).toBe(2 * TILE);
    expect(HILLS_FRAMES.cliffB[3]).toBe(2 * TILE);
  });

  it('puts the recoloured forest copies where nothing else is drawn', () => {
    const mountainRight = 368;
    for (const name of ['pineGravel', 'bushGravelA', 'bushGravelB'] as const) {
      const [x, y] = HILLS_FRAMES[name];
      expect(x, name).toBeGreaterThanOrEqual(mountainRight);
      expect(y, name).toBeGreaterThanOrEqual(HILLS_SOURCE.y);
    }
  });

  it('swaps grass colours for gravel colours', () => {
    for (const [grass, gravel] of Object.entries(GRAVEL_FOR_GRASS)) {
      expect(grass).toMatch(/^#[0-9a-f]{6}$/);
      expect(gravel).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
