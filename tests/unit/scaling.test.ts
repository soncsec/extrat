import { describe, expect, it } from 'vitest';
import { fitZoom, integerZoom, pixelZoom } from '../../src/logic/scaling';

describe('integerZoom', () => {
  it('picks the largest whole zoom that fits', () => {
    expect(integerZoom(1920, 1080, 256, 320)).toBe(3); // height limits: 1080 / 320 = 3.375
    expect(integerZoom(2560, 1440, 256, 320)).toBe(4); // 1440 / 320 = 4.5
    expect(integerZoom(800, 600, 256, 320)).toBe(1); // 600 / 320 = 1.875
  });

  it('uses the tighter of width and height', () => {
    expect(integerZoom(600, 2000, 256, 320)).toBe(2); // width limits: 600 / 256 = 2.34
  });

  it('returns exact multiples unchanged', () => {
    expect(integerZoom(512, 640, 256, 320)).toBe(2);
  });

  it('never goes below 1 for tiny or empty windows', () => {
    expect(integerZoom(100, 100, 256, 320)).toBe(1);
    expect(integerZoom(0, 0, 256, 320)).toBe(1);
    expect(integerZoom(Number.NaN, 600, 256, 320)).toBe(1);
  });

  it('rejects a non-positive game size', () => {
    expect(() => integerZoom(800, 600, 0, 320)).toThrow(RangeError);
    expect(() => integerZoom(800, 600, 256, -1)).toThrow(RangeError);
  });
});

describe('pixelZoom', () => {
  it('is integerZoom on an ordinary screen', () => {
    expect(pixelZoom(1920, 1080, 384, 256, 1)).toBe(integerZoom(1920, 1080, 384, 256));
  });

  it('uses the device pixels of a phone, so the game is bigger but still crisp', () => {
    // A phone held sideways: 844 x 390 CSS pixels, 3 device pixels each.
    const zoom = pixelZoom(844, 390, 384, 256, 3);
    expect(zoom).toBeCloseTo(4 / 3); // 1170 / 256 = 4.57: 4 device pixels per art pixel
    expect(Number.isInteger(zoom * 3)).toBe(true);
    expect(256 * zoom).toBeLessThanOrEqual(390);
    expect(zoom).toBeGreaterThan(integerZoom(844, 390, 384, 256));
  });

  it('fits a tablet', () => {
    // 1024 x 768 CSS pixels, 2 device pixels each. Width limits: 2048 / 384 = 5.3, so 5
    // device pixels per art pixel, and a map square 40 CSS pixels wide.
    expect(pixelZoom(1024, 768, 384, 256, 2)).toBe(2.5);
  });

  it('treats a missing or odd ratio as 1', () => {
    for (const r of [0, -2, Number.NaN, Infinity]) {
      expect(pixelZoom(800, 600, 384, 256, r)).toBe(integerZoom(800, 600, 384, 256));
    }
  });
});

describe('fitZoom (phones fill the screen, owner 2026-10-19)', () => {
  it('fills the limiting side exactly, whole number or not', () => {
    expect(fitZoom(844, 390, 384, 256)).toBeCloseTo(390 / 256, 10); // iPhone sideways
    expect(fitZoom(1180, 820, 384, 256)).toBeCloseTo(1180 / 384, 10); // tablet: width limits
    expect(fitZoom(600, 2000, 384, 256)).toBeCloseTo(600 / 384, 10); // width limits
  });

  it('never goes below its minimum or returns a non-number', () => {
    expect(fitZoom(100, 100, 384, 256)).toBe(1);
    expect(fitZoom(100, 100, 384, 256, 0.5)).toBe(0.5);
    expect(fitZoom(Number.NaN, 400, 384, 256)).toBe(1);
    expect(fitZoom(Infinity, Infinity, 384, 256)).toBe(1);
    expect(() => fitZoom(800, 600, 0, 256)).toThrow(RangeError);
  });
});
