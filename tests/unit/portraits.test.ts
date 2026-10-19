import { describe, expect, it } from 'vitest';
import { MARINE_NAMES } from '../../src/logic/battle';
import {
  PORTRAIT_COLOURS,
  PORTRAIT_PALETTE,
  PORTRAIT_PICTURE,
  PORTRAIT_SIZE,
  PORTRAIT_TEXTURE,
} from '../../src/scenes/portraits';

describe('squad portraits (M6.2)', () => {
  it('is a square picture in the palette, with a stripe and a glint to colour', () => {
    expect(PORTRAIT_PICTURE).toHaveLength(PORTRAIT_SIZE);
    const all = PORTRAIT_PICTURE.join('');
    for (const row of PORTRAIT_PICTURE) {
      expect(row).toHaveLength(PORTRAIT_SIZE);
      for (const ch of row)
        expect(ch in PORTRAIT_PALETTE || ch === 'S' || ch === 'G', ch).toBe(true);
    }
    expect(all).toContain('S');
    expect(all).toContain('G');
  });

  it('gives every marine their own colours', () => {
    const stripes = new Set<string>();
    for (const name of MARINE_NAMES) {
      const own = PORTRAIT_COLOURS[name];
      expect(own, name).toBeDefined();
      expect(own?.stripe).toMatch(/^#[0-9a-f]{6}$/);
      expect(own?.glint).toMatch(/^#[0-9a-f]{6}$/);
      stripes.add(own?.stripe ?? '');
    }
    expect(stripes.size).toBe(MARINE_NAMES.length);
  });

  it('has room in the texture for one portrait per marine', () => {
    expect(PORTRAIT_TEXTURE.width).toBe(PORTRAIT_SIZE * MARINE_NAMES.length);
    expect(PORTRAIT_TEXTURE.height).toBe(PORTRAIT_SIZE);
  });
});
