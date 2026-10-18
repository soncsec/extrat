import { describe, expect, it } from 'vitest';
import { initialSeed, urlNumber } from '../../src/scenes/seed';

describe('initialSeed', () => {
  it('uses ?seed= from the URL', () => {
    expect(initialSeed('?seed=42')).toBe(42);
    expect(initialSeed('?foo=1&seed=7')).toBe(7);
  });

  it('reads the link as the debrief shows it, in capitals', () => {
    expect(initialSeed('?SEED=7961')).toBe(7961);
    expect(initialSeed('?Seed=5')).toBe(5);
  });

  it('picks a random seed below one million otherwise', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const s = initialSeed('');
      expect(Number.isInteger(s) && s >= 0 && s < 1_000_000).toBe(true);
      seeds.add(s);
    }
    expect(seeds.size).toBeGreaterThan(1);
    expect(initialSeed('?seed=abc')).toBeLessThan(1_000_000);
  });
});

describe('urlNumber', () => {
  it('reads a whole number for a key, or null', () => {
    expect(urlNumber('campaign', '?campaign=12')).toBe(12);
    expect(urlNumber('campaign', '?CAMPAIGN=12')).toBe(12);
    expect(urlNumber('campaign', '?seed=12')).toBeNull();
    expect(urlNumber('campaign', '?campaign=<script>')).toBeNull();
    expect(urlNumber('seed', '')).toBeNull();
  });
});
