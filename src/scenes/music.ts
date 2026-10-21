import type Phaser from 'phaser';
import { AUDIO } from '../config/tuning';

/*
 * Music (M7, owner 2026-10-20: retro synth, made in code like the sound effects). A
 * track is written as notes: a chord per bar, and parts that play over the chords (a
 * melody, a bass line, an arpeggio, a pad, drums), on a grid of 16 steps a bar. It is
 * rendered once, the first time it is needed, into an audio buffer that loops without a
 * seam, and played through Phaser's sound manager, so the SND button and M mute it with
 * the sound effects. No audio files, nothing fetched.
 */

export type TrackId = 'theme' | 'calm' | 'tense' | 'boss';

type Tone = 'square' | 'triangle' | 'sine';
type Drum = 'kick' | 'snare' | 'hat';

/** One part of a track. Rhythms have one character per step (16 a bar). */
export type Part =
  /** Notes written out bar by bar: 'A4:4 C5:2 .:2 ...' (a note or '.' rest, then steps). */
  | { type: 'melody'; wave: Tone; duty?: number; volume: number; bars: readonly string[] }
  /** The chord's root: 'x' at `octave`, 'o' an octave up, 'f' its fifth; '.' rest. */
  | { type: 'bass'; wave: Tone; duty?: number; volume: number; octave: number; rhythm: string }
  /** The chord's notes in turn, one step each, at each 'x'. */
  | { type: 'arp'; wave: Tone; duty?: number; volume: number; octave: number; rhythm: string }
  /** The chord's notes held for the whole bar, fading in slowly. */
  | { type: 'pad'; wave: Tone; volume: number; octave: number }
  /** A drum at each 'x' of its rhythm. */
  | { type: 'drums'; volume: number; kick: string; snare: string; hat: string };

export interface Track {
  bpm: number;
  /** One chord per bar: a root with an optional sharp or flat, 'm' for minor ('Am', 'F#'). */
  chords: readonly string[];
  parts: readonly Part[];
}

/** Steps in a bar: sixteenth notes. */
export const STEPS = 16;

/** One note to play, in seconds from the start of the loop. */
export interface NoteEvent {
  at: number;
  length: number;
  wave: Tone | Drum;
  /** Pitch in Hz (drums: unused). */
  freq: number;
  /** A square wave's share of high (0.5 is even). */
  duty: number;
  volume: number;
  /** Fade-in time, in seconds. */
  attack: number;
}

/** The title and briefing theme: A minor, heroic, 16 bars. */
const THEME: Track = {
  bpm: 112,
  chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E', 'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
  parts: [
    {
      type: 'melody',
      wave: 'square',
      duty: 0.25,
      volume: 0.15,
      bars: [
        'A4:4 C5:2 E5:2 D5:4 C5:4',
        'A4:4 F4:2 A4:2 C5:6 .:2',
        'G4:2 E4:2 G4:4 C5:4 E5:4',
        'D5:6 B4:2 G4:8',
        'A4:2 A4:2 C5:2 E5:2 A5:6 G5:2',
        'F5:4 E5:2 D5:2 C5:8',
        'B4:4 D5:4 G5:4 F5:2 D5:2',
        'E5:8 D5:4 B4:4',
        'E5:4 A5:4 G5:2 E5:2 C5:4',
        'C5:4 F5:4 E5:2 C5:2 A4:4',
        'G4:4 C5:4 E5:4 G5:4',
        'F5:2 E5:2 D5:4 B4:8',
        'C5:2 B4:2 A4:4 E5:4 A5:4',
        'A5:4 G5:2 F5:2 E5:4 C5:4',
        'D5:4 B4:4 G4:4 B4:2 D5:2',
        'E5:4 B4:4 G#4:4 B4:4',
      ],
    },
    {
      type: 'arp',
      wave: 'square',
      duty: 0.125,
      volume: 0.05,
      octave: 4,
      rhythm: 'xxxxxxxxxxxxxxxx',
    },
    { type: 'bass', wave: 'triangle', volume: 0.3, octave: 2, rhythm: 'x.x.o.x.x.x.o.x.' },
    {
      type: 'drums',
      volume: 0.45,
      kick: 'x.....x.x.......',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
    },
  ],
};

/** The two battle tracks share a key, tempo and chords, so one fades into the other. */
const BATTLE_CHORDS = [
  'Dm',
  'Dm',
  'Bb',
  'Bb',
  'Gm',
  'Gm',
  'A',
  'A',
  'Dm',
  'Dm',
  'Bb',
  'C',
  'Gm',
  'Gm',
  'A',
  'A',
] as const;

/** Battle, while every alien still waits hidden (M7.2): sparse and watchful. */
const CALM: Track = {
  bpm: 96,
  chords: BATTLE_CHORDS,
  parts: [
    {
      type: 'melody',
      wave: 'triangle',
      volume: 0.09,
      bars: [
        '.:16',
        '.:8 A4:4 F4:4',
        '.:16',
        '.:8 D5:4 C5:4',
        '.:16',
        '.:8 Bb4:4 G4:4',
        'A4:8 .:8',
        'C#5:8 E5:8',
        '.:16',
        'F5:4 E5:4 D5:8',
        '.:16',
        'E5:4 D5:4 C5:8',
        '.:16',
        'D5:4 Bb4:4 G4:8',
        'A4:8 .:8',
        'E4:4 A4:4 C#5:8',
      ],
    },
    { type: 'arp', wave: 'sine', volume: 0.05, octave: 4, rhythm: 'x..x..x...x..x..' },
    { type: 'pad', wave: 'triangle', volume: 0.06, octave: 3 },
    { type: 'bass', wave: 'triangle', volume: 0.22, octave: 2, rhythm: 'x.......f.......' },
  ],
};

/** Battle, while aliens are awake (M7.2): the same chords, driven by drums and bass. */
const TENSE: Track = {
  bpm: 96,
  chords: BATTLE_CHORDS,
  parts: [
    {
      type: 'melody',
      wave: 'square',
      duty: 0.25,
      volume: 0.1,
      bars: [
        'D5:6 C5:2 A4:8',
        '.:16',
        'D5:4 F5:4 E5:4 D5:4',
        'F5:8 .:8',
        'G5:6 F5:2 D5:8',
        '.:16',
        'E5:4 C#5:4 A4:8',
        'C#5:4 E5:4 G5:8',
        'D5:6 C5:2 A4:8',
        '.:16',
        'D5:4 F5:4 G5:4 A5:4',
        'G5:8 E5:8',
        'Bb5:6 A5:2 G5:8',
        'D5:8 .:8',
        'E5:4 F5:4 E5:4 C#5:4',
        'A4:8 .:8',
      ],
    },
    {
      type: 'arp',
      wave: 'square',
      duty: 0.125,
      volume: 0.045,
      octave: 4,
      rhythm: 'xxxxxxxxxxxxxxxx',
    },
    { type: 'pad', wave: 'triangle', volume: 0.05, octave: 3 },
    { type: 'bass', wave: 'triangle', volume: 0.28, octave: 2, rhythm: 'x.xox.xox.xox.xo' },
    {
      type: 'drums',
      volume: 0.4,
      kick: 'x.....x...x.....',
      snare: '....x.......x..x',
      hat: '..x...x...x...x.',
    },
  ],
};

/** The Overseer's fight (M7.3): E minor, fast, every part driving. */
const BOSS: Track = {
  bpm: 140,
  chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B', 'Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B'],
  parts: [
    {
      type: 'melody',
      wave: 'square',
      duty: 0.5,
      volume: 0.1,
      bars: [
        'E5:4 G5:4 B5:4 G5:4',
        'F#5:4 E5:4 D5:4 B4:4',
        'C5:6 E5:2 G5:8',
        'F#5:4 A5:4 F#5:4 D5:4',
        'E5:2 E5:2 G5:2 E5:2 B5:8',
        'A5:4 G5:4 F#5:4 E5:4',
        'G5:4 E5:4 C5:4 E5:4',
        'D#5:8 F#5:4 B4:4',
        'B5:4 A5:4 G5:4 E5:4',
        'G5:4 F#5:4 E5:8',
        'E5:4 G5:4 C6:8',
        'D6:4 C6:4 A5:8',
        'B5:6 A5:2 G5:8',
        'E5:4 F#5:4 G5:4 A5:4',
        'G5:4 E5:4 C5:8',
        'B4:4 D#5:4 F#5:4 B5:4',
      ],
    },
    {
      type: 'arp',
      wave: 'square',
      duty: 0.125,
      volume: 0.045,
      octave: 4,
      rhythm: 'xxxxxxxxxxxxxxxx',
    },
    { type: 'bass', wave: 'triangle', volume: 0.3, octave: 2, rhythm: 'xoxoxoxoxoxoxoxo' },
    {
      type: 'drums',
      volume: 0.45,
      kick: 'x...x...x...x.x.',
      snare: '....x.......x...',
      hat: 'xxxxxxxxxxxxxxxx',
    },
  ],
};

export const TRACKS: Readonly<Record<TrackId, Track>> = {
  theme: THEME,
  calm: CALM,
  tense: TENSE,
  boss: BOSS,
};

const NOTE = /^([A-G])(#|b)?(-?\d)$/;
const CHORD = /^([A-G])(#|b)?(m)?$/;
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The MIDI number of a note name such as 'A4' (69) or 'G#4'. Throws on anything else. */
export function noteNumber(name: string): number {
  const m = NOTE.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + (SEMITONE[m[1] as string] ?? 0) + shift;
}

/** The pitch of a MIDI note number, in Hz (A4 = 440). */
export function frequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** A chord's three notes (root, third, fifth), with the root in `octave`. */
export function chordNotes(name: string, octave: number): [number, number, number] {
  const m = CHORD.exec(name);
  if (!m) throw new Error(`not a chord: ${name}`);
  const root = noteNumber(`${m[1]}${m[2] ?? ''}${octave}`);
  return [root, root + (m[3] ? 3 : 4), root + 7];
}

/** A melody bar's notes: [note number or null for a rest, steps]. */
export function parseBar(bar: string): [number | null, number][] {
  return bar
    .split(' ')
    .filter((t) => t !== '')
    .map((token) => {
      const [name, steps] = token.split(':');
      const n = Number(steps);
      if (!name || !Number.isInteger(n) || n < 1) throw new Error(`bad note: ${token}`);
      return [name === '.' ? null : noteNumber(name), n];
    });
}

/** Seconds per step (a sixteenth note). */
export function stepLength(track: Track): number {
  return 60 / track.bpm / 4;
}

/** How long the track takes before it loops, in seconds. */
export function loopLength(track: Track): number {
  return track.chords.length * STEPS * stepLength(track);
}

/** Every note the track plays in one pass. */
export function schedule(track: Track): NoteEvent[] {
  const step = stepLength(track);
  const events: NoteEvent[] = [];
  const tone = (
    p: { wave: Tone; duty?: number; volume: number },
    at: number,
    steps: number,
    note: number,
    attack = 0.005,
  ): void => {
    events.push({
      at: at * step,
      length: steps * step,
      wave: p.wave,
      freq: frequency(note),
      duty: p.duty ?? 0.5,
      volume: p.volume,
      attack,
    });
  };
  track.chords.forEach((chord, bar) => {
    const start = bar * STEPS;
    for (const p of track.parts) {
      if (p.type === 'melody') {
        let at = start;
        for (const [note, steps] of parseBar(p.bars[bar] ?? '')) {
          if (note !== null) tone(p, at, steps, note);
          at += steps;
        }
      } else if (p.type === 'bass') {
        const [root, , fifth] = chordNotes(chord, p.octave);
        const hits = [...p.rhythm].flatMap((c, i) => (c === '.' ? [] : [i]));
        hits.forEach((i, k) => {
          const until = hits[k + 1] ?? STEPS;
          const c = p.rhythm[i];
          const note = c === 'o' ? root + 12 : c === 'f' ? fifth : root;
          tone(p, start + i, until - i, note);
        });
      } else if (p.type === 'arp') {
        const [root, third, fifth] = chordNotes(chord, p.octave);
        const cycle = [root, third, fifth, root + 12];
        let k = 0;
        [...p.rhythm].forEach((c, i) => {
          if (c === 'x') tone(p, start + i, 1, cycle[k++ % cycle.length] as number);
        });
      } else if (p.type === 'pad') {
        for (const note of chordNotes(chord, p.octave)) tone(p, start, STEPS, note, 0.3);
      } else {
        for (const drum of ['kick', 'snare', 'hat'] as const) {
          [...p[drum]].forEach((c, i) => {
            if (c !== 'x') return;
            events.push({
              at: (start + i) * step,
              length: DRUM_LENGTH[drum],
              wave: drum,
              freq: 0,
              duty: 0.5,
              volume: p.volume,
              attack: 0,
            });
          });
        }
      }
    }
  });
  return events;
}

const DRUM_LENGTH: Record<Drum, number> = { kick: 0.18, snare: 0.14, hat: 0.04 };

/** The loudest a rendered track may peak: a little under 1 so nothing clips. */
export const PEAK = 0.9;

/**
 * The samples of one pass of a track at `rate` per second, between -1 and 1. Notes that
 * ring past the end wrap round to the start, so the loop has no seam. The same every
 * time: noise comes from a fixed generator, not Math.random.
 */
export function renderTrack(track: Track, rate: number): Float32Array<ArrayBuffer> {
  const total = Math.round(loopLength(track) * rate);
  const out = new Float32Array(total);
  schedule(track).forEach((e, n) => {
    const start = Math.round(e.at * rate);
    const count = Math.round(e.length * rate);
    const attack = Math.max(1, Math.round(e.attack * rate));
    const release = Math.max(1, Math.min(count, Math.round(0.03 * rate)));
    // Exponential decays step by step, one multiply a sample (no Math.exp in the loop).
    const decay = (perSecond: number): number => Math.exp(-perSecond / rate);
    let phase = 0;
    let k = start % total;
    if (e.wave === 'kick') {
      // A thump: a sine falling fast from 150 Hz to 40 Hz.
      const [fall, fade] = [decay(30), decay(18)];
      let sweep = 110;
      let env = e.volume;
      for (let i = 0; i < count; i++, k = k + 1 === total ? 0 : k + 1) {
        phase += (40 + sweep) / rate;
        sweep *= fall;
        out[k] = (out[k] ?? 0) + Math.sin(2 * Math.PI * phase) * env;
        env *= fade;
      }
      return;
    }
    if (e.wave === 'snare' || e.wave === 'hat') {
      // Noise: the hat is the hiss alone (the change between samples: only the highs).
      const hat = e.wave === 'hat';
      const fade = decay(hat ? 90 : 25);
      let env = e.volume * (hat ? 0.5 : 0.7);
      let noise = (0x9e3779b9 ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0;
      let last = 0;
      for (let i = 0; i < count; i++, k = k + 1 === total ? 0 : k + 1) {
        noise ^= noise << 13;
        noise ^= noise >>> 17;
        noise ^= noise << 5;
        noise >>>= 0;
        const white = noise / 0x7fffffff - 1;
        out[k] = (out[k] ?? 0) + (hat ? (white - last) / 2 : white) * env;
        last = white;
        env *= fade;
      }
      return;
    }
    // A tone: in over the attack, a little decay to a held level, out over the last 30 ms.
    const step = e.freq / rate;
    const settle = decay(12);
    let extra = 0.25;
    for (let i = 0; i < count; i++, k = k + 1 === total ? 0 : k + 1) {
      phase += step;
      if (phase >= 1) phase -= 1;
      const wave =
        e.wave === 'square'
          ? phase < e.duty
            ? 1
            : -1
          : e.wave === 'triangle'
            ? 1 - 4 * Math.abs(phase - 0.5)
            : Math.sin(2 * Math.PI * phase);
      const fade = i < attack ? i / attack : count - i < release ? (count - i) / release : 1;
      out[k] = (out[k] ?? 0) + wave * (0.75 + extra) * fade * e.volume;
      extra *= settle;
    }
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > PEAK) for (let i = 0; i < out.length; i++) out[i] = ((out[i] ?? 0) * PEAK) / peak;
  return out;
}

/**
 * The sample rate tracks are rendered at: plenty for chiptune, and half the work of the
 * usual 48,000 (the browser converts it as it plays).
 */
export const MUSIC_RATE = 24_000;

const keyOf = (id: TrackId): string => `music-${id}`;

/** A playing track: its sound, and the level its fades move (0 to 1 of AUDIO.music). */
interface Playing {
  sound: Phaser.Sound.BaseSound;
  level: { value: number };
}

/** The track playing (or fading in), and tracks still fading out. */
let current: (Playing & { id: TrackId }) | null = null;
let fading: Playing[] = [];
/** Sounds already destroyed: a fade still running must not touch them. */
const gone = new WeakSet<Phaser.Sound.BaseSound>();

/** Sets a track's volume from its level, unless its sound is gone. */
function apply(p: Playing): void {
  if (!gone.has(p.sound)) {
    (p.sound as Phaser.Sound.WebAudioSound).setVolume(p.level.value * AUDIO.music);
  }
}

function stop(p: Playing): void {
  if (gone.has(p.sound)) return;
  gone.add(p.sound);
  p.sound.destroy();
}

/**
 * Fades a track's level. The tween moves a plain number, never the sound itself: a
 * sound destroyed mid-fade (by a quick change of track) is then simply skipped, where
 * setting its volume would throw and stop the game's frame.
 */
function fade(scene: Phaser.Scene, p: Playing, to: number, done?: () => void): void {
  scene.tweens.killTweensOf(p.level);
  scene.tweens.add({
    targets: p.level,
    value: to,
    duration: AUDIO.musicFadeMs,
    onUpdate: () => apply(p),
    onComplete: () => {
      apply(p);
      done?.();
    },
  });
}

/** The track playing now, or null (for tests). */
export function currentMusic(): TrackId | null {
  return current?.id ?? null;
}

/** Renders a track into Phaser's audio cache the first time it is needed. */
export function ensureRendered(scene: Phaser.Scene, id: TrackId): boolean {
  if (scene.cache.audio.exists(keyOf(id))) return true;
  const context = (scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>).context;
  if (!context) return false;
  const samples = renderTrack(TRACKS[id], MUSIC_RATE);
  const buffer = context.createBuffer(1, samples.length, MUSIC_RATE);
  buffer.copyToChannel(samples, 0);
  scene.cache.audio.add(keyOf(id), buffer);
  return true;
}

/**
 * Plays a track on a loop, fading over from the one playing; null fades the music out.
 * Asking for the track already playing keeps it going, at full volume. Without Web
 * Audio the game stays silent.
 */
export function playMusic(scene: Phaser.Scene, id: TrackId | null): void {
  // A fade the last scene started may have stopped with that scene: finish it now.
  for (const p of fading) stop(p);
  fading = [];
  if (current && current.id === id) {
    scene.tweens.killTweensOf(current.level);
    current.level.value = 1;
    apply(current);
    return;
  }
  if (current) {
    const old: Playing = current;
    fading.push(old);
    fade(scene, old, 0, () => {
      fading = fading.filter((p) => p !== old);
      stop(old);
    });
    current = null;
  }
  if (id === null || !ensureRendered(scene, id)) return;
  const sound = scene.sound.add(keyOf(id), { loop: true, volume: 0 });
  sound.play();
  current = { id, sound, level: { value: 0 } };
  fade(scene, current, 1);
}
