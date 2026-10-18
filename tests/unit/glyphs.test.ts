import { describe, expect, it } from 'vitest';
import {
  GLYPH_CHARS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  GLYPHS,
  toFontText,
} from '../../src/scenes/glyphs';

describe('pixel font glyphs', () => {
  it('are all 5 x 7 grids of 0s and 1s', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      expect(rows, `glyph ${ch}`).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows)
        expect(row, `glyph ${ch}`).toMatch(new RegExp(`^[01]{${GLYPH_WIDTH}}$`));
    }
  });

  it('cover A-Z, 0-9 and the punctuation the screens use', () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:!?-'()/%+[]>=") {
      expect(GLYPH_CHARS, `missing ${ch}`).toContain(ch);
    }
  });

  it('gives every letter and digit at least one lit pixel, and only space none', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      const lit = rows.join('').includes('1');
      expect(lit, `glyph ${JSON.stringify(ch)}`).toBe(ch !== ' ');
    }
  });

  it('shows text in capitals and replaces unknown characters', () => {
    expect(toFontText('Play again')).toBe('PLAY AGAIN');
    expect(toFontText('Tab or 1-4: marine')).toBe('TAB OR 1-4: MARINE');
    expect(toFontText('a\nb')).toBe('A\nB');
    expect(toFontText('é~')).toBe('??');
  });
});
