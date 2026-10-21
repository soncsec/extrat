import { describe, expect, it } from 'vitest';
import {
  chordNotes,
  frequency,
  loopLength,
  noteNumber,
  parseBar,
  PEAK,
  renderTrack,
  schedule,
  STEPS,
  TRACKS,
} from '../../src/scenes/music';

const RATE = 22_050;

describe('music made in code (M7)', () => {
  it('reads notes and chords', () => {
    expect(noteNumber('A4')).toBe(69);
    expect(noteNumber('C4')).toBe(60);
    expect(noteNumber('G#4')).toBe(68);
    expect(noteNumber('Bb3')).toBe(58);
    expect(frequency(69)).toBeCloseTo(440);
    expect(frequency(81)).toBeCloseTo(880);
    expect(chordNotes('Am', 4)).toEqual([69, 72, 76]);
    expect(chordNotes('E', 3)).toEqual([52, 56, 59]);
    expect(() => noteNumber('H4')).toThrow();
    expect(() => chordNotes('Xm', 4)).toThrow();
    expect(() => parseBar('A4:0')).toThrow();
  });

  it('writes every track bar by bar: whole bars, a melody bar per chord, 16-step rhythms', () => {
    for (const [id, track] of Object.entries(TRACKS)) {
      expect(track.chords.length, id).toBeGreaterThan(0);
      for (const chord of track.chords) expect(() => chordNotes(chord, 3), id).not.toThrow();
      for (const p of track.parts) {
        if (p.type === 'melody') {
          expect(p.bars, id).toHaveLength(track.chords.length);
          p.bars.forEach((bar, i) => {
            const steps = parseBar(bar).reduce((sum, [, n]) => sum + n, 0);
            expect(steps, `${id} bar ${i + 1}: ${bar}`).toBe(STEPS);
          });
        }
        const rhythms =
          p.type === 'drums' ? [p.kick, p.snare, p.hat] : 'rhythm' in p ? [p.rhythm] : [];
        for (const r of rhythms) expect(r, id).toMatch(/^[xof.]{16}$/);
      }
    }
  });

  it('keeps every note in the hearing range and every part at a sane volume', () => {
    for (const [id, track] of Object.entries(TRACKS)) {
      const events = schedule(track);
      expect(events.length, id).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.at, id).toBeGreaterThanOrEqual(0);
        expect(e.at, id).toBeLessThan(loopLength(track));
        expect(e.length, id).toBeGreaterThan(0);
        expect(e.volume, id).toBeGreaterThan(0);
        expect(e.volume, id).toBeLessThanOrEqual(1);
        if (!['kick', 'snare', 'hat'].includes(e.wave)) {
          expect(e.freq, id).toBeGreaterThan(30);
          expect(e.freq, id).toBeLessThan(4000);
        }
      }
    }
  });

  it('renders each track to one loop of samples, below clipping, audible, the same every time', () => {
    for (const [id, track] of Object.entries(TRACKS)) {
      const samples = renderTrack(track, RATE);
      expect(samples.length, id).toBe(Math.round(loopLength(track) * RATE));
      // One check at the end, not one a sample: a loop is hundreds of thousands of them.
      let peak = 0;
      let finite = true;
      for (const v of samples) {
        if (!Number.isFinite(v)) finite = false;
        peak = Math.max(peak, Math.abs(v));
      }
      expect(finite, `${id} has only numbers`).toBe(true);
      expect(peak, id).toBeLessThanOrEqual(PEAK + 1e-6);
      expect(peak, `${id} is audible`).toBeGreaterThan(0.2);
      // The same every time (compared in a loop: toEqual on ~1 million samples is very slow).
      const again = renderTrack(track, RATE);
      let same = again.length === samples.length;
      for (let i = 0; same && i < samples.length; i++) same = again[i] === samples[i];
      expect(same, `${id} renders the same every time`).toBe(true);
      // The loop has no seam: the last sample runs on into the first without a jump.
      const seam = Math.abs((samples[0] ?? 0) - (samples[samples.length - 1] ?? 0));
      expect(seam, `${id} seam`).toBeLessThan(0.25);
    }
  });

  it('loops long enough not to grate: at least 20 seconds', () => {
    for (const [id, track] of Object.entries(TRACKS)) {
      expect(loopLength(track), id).toBeGreaterThanOrEqual(20);
    }
  });
});
