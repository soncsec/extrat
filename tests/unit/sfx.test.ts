import { describe, expect, it } from 'vitest';
import { AUDIO } from '../../src/config/tuning';
import { render, soundLength, SOUNDS } from '../../src/scenes/sfx';

const RATE = 44_100;

describe('sound effects made in code (M6.1)', () => {
  it('render every sound to samples between -1 and 1, never silent', () => {
    for (const [id, layers] of Object.entries(SOUNDS)) {
      const samples = render(layers, RATE);
      expect(samples.length, id).toBe(Math.ceil(soundLength(layers) * RATE));
      let peak = 0;
      for (const v of samples) {
        expect(Number.isFinite(v), id).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, id).toBeLessThanOrEqual(1);
      expect(peak, `${id} is audible`).toBeGreaterThan(0.03);
    }
  });

  it('are the same every time (no Math.random)', () => {
    for (const layers of Object.values(SOUNDS)) {
      expect(render(layers, RATE)).toEqual(render(layers, RATE));
    }
  });

  it('are short, and start and end quietly (no clicks)', () => {
    for (const [id, layers] of Object.entries(SOUNDS)) {
      expect(soundLength(layers), id).toBeLessThanOrEqual(1.5);
      const samples = render(layers, RATE);
      expect(Math.abs(samples[0] ?? 1), `${id} start`).toBeLessThan(0.05);
      expect(Math.abs(samples[samples.length - 1] ?? 1), `${id} end`).toBeLessThan(0.05);
      for (const l of layers) {
        expect(l.volume, id).toBeGreaterThan(0);
        expect(l.volume, id).toBeLessThanOrEqual(1);
        expect(l.from, id).toBeGreaterThan(0);
        expect(l.to, id).toBeGreaterThan(0);
      }
    }
  });

  it('play at a volume between 0 and 1', () => {
    expect(AUDIO.volume).toBeGreaterThan(0);
    expect(AUDIO.volume).toBeLessThanOrEqual(1);
  });
});
