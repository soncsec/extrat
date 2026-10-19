import type Phaser from 'phaser';
import { AUDIO } from '../config/tuning';
import { readSettings, writeSettings } from './storage';

/*
 * Sound effects (M6.1, owner 2026-10-19: made in code). Each sound is a few layers, each
 * a tone or noise sweeping from one pitch to another while it fades, like the classic
 * sfxr tool. They are rendered to audio buffers once while the game loads and played
 * through Phaser's sound manager, which waits for the player's first tap or click
 * before any sound starts (browsers require that). No audio files, nothing fetched.
 */

export type SoundId =
  | 'shot'
  | 'alienShot'
  | 'miss'
  | 'hit'
  | 'death'
  | 'throw'
  | 'explosion'
  | 'reload'
  | 'overwatch'
  | 'select'
  | 'click'
  | 'spotted'
  | 'poison'
  | 'charge'
  | 'blast'
  | 'win'
  | 'lose';

/** One layer of a sound. Times are in seconds. */
export interface Layer {
  /** A tone's shape, or noise. */
  wave: 'square' | 'triangle' | 'sine' | 'noise';
  /**
   * Pitch at the start and end, in Hz. For noise these are the cut-off of the filter it
   * passes through: high is a hiss, low is a rumble.
   */
  from: number;
  to: number;
  /** When the layer starts, after the start of the sound. */
  at?: number;
  length: number;
  /** Loudness, 0 to 1. */
  volume: number;
  /** Fade-in time (default: a few milliseconds, so it doesn't click). */
  attack?: number;
}

/** A short run of notes, for the win and lose jingles. */
function notes(pitches: readonly number[], each: number, volume: number): Layer[] {
  return pitches.map((p, i) => ({
    wave: 'triangle',
    from: p,
    to: p,
    at: i * each,
    length: each * 1.6,
    volume,
  }));
}

export const SOUNDS: Readonly<Record<SoundId, readonly Layer[]>> = {
  // A rifle crack: a burst of hiss over a low thump.
  shot: [
    { wave: 'noise', from: 7000, to: 1200, length: 0.14, volume: 0.55 },
    { wave: 'square', from: 180, to: 60, length: 0.09, volume: 0.25 },
  ],
  // An alien's zap: a falling buzz.
  alienShot: [
    { wave: 'square', from: 1100, to: 180, length: 0.2, volume: 0.22 },
    { wave: 'noise', from: 3000, to: 900, length: 0.07, volume: 0.2 },
  ],
  // A shot going wide: a thin whistle past.
  miss: [{ wave: 'noise', from: 5000, to: 2500, length: 0.08, volume: 0.18 }],
  hit: [
    { wave: 'noise', from: 1800, to: 250, length: 0.12, volume: 0.5 },
    { wave: 'sine', from: 140, to: 55, length: 0.14, volume: 0.45 },
  ],
  death: [
    { wave: 'triangle', from: 420, to: 55, length: 0.5, volume: 0.35 },
    { wave: 'noise', from: 900, to: 100, length: 0.35, volume: 0.22 },
  ],
  // The grenade's arc: a rising whoosh.
  throw: [{ wave: 'noise', from: 500, to: 2600, length: 0.3, volume: 0.16, attack: 0.1 }],
  explosion: [
    { wave: 'noise', from: 2600, to: 70, length: 0.95, volume: 0.85 },
    { wave: 'sine', from: 75, to: 30, length: 0.6, volume: 0.55 },
  ],
  // Two clicks: the clip out, the clip in.
  reload: [
    { wave: 'square', from: 1700, to: 1500, length: 0.03, volume: 0.16 },
    { wave: 'square', from: 1100, to: 1000, at: 0.12, length: 0.04, volume: 0.18 },
  ],
  overwatch: [{ wave: 'triangle', from: 520, to: 790, length: 0.14, volume: 0.2 }],
  select: [{ wave: 'square', from: 640, to: 960, length: 0.05, volume: 0.1 }],
  click: [{ wave: 'square', from: 900, to: 900, length: 0.03, volume: 0.08 }],
  // Aliens spotted: a two-note alarm.
  spotted: [
    { wave: 'square', from: 330, to: 620, length: 0.1, volume: 0.16 },
    { wave: 'square', from: 330, to: 620, at: 0.13, length: 0.1, volume: 0.16 },
  ],
  poison: [
    { wave: 'sine', from: 320, to: 140, length: 0.25, volume: 0.25 },
    { wave: 'noise', from: 600, to: 300, length: 0.2, volume: 0.1 },
  ],
  // The boss charging: a long rising whine.
  charge: [{ wave: 'square', from: 110, to: 620, length: 0.85, volume: 0.18, attack: 0.2 }],
  blast: [
    { wave: 'noise', from: 3200, to: 50, length: 1.3, volume: 0.9 },
    { wave: 'sine', from: 60, to: 25, length: 0.9, volume: 0.6 },
  ],
  // C E G C up for a win, G E C down for a loss.
  win: notes([523, 659, 784, 1047], 0.12, 0.22),
  lose: notes([392, 330, 262], 0.22, 0.22),
};

/** How long a sound lasts, in seconds. */
export function soundLength(layers: readonly Layer[]): number {
  return Math.max(...layers.map((l) => (l.at ?? 0) + l.length));
}

/**
 * The samples of a sound at `rate` per second, between -1 and 1. The same every time:
 * noise comes from a fixed generator, not Math.random.
 */
export function render(layers: readonly Layer[], rate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.ceil(soundLength(layers) * rate));
  layers.forEach((layer, n) => {
    const start = Math.round((layer.at ?? 0) * rate);
    const count = Math.round(layer.length * rate);
    const attack = Math.max(1, Math.round((layer.attack ?? 0.004) * rate));
    let phase = 0;
    let noise = (0x9e3779b9 ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0;
    let filtered = 0;
    for (let i = 0; i < count && start + i < out.length; i++) {
      const t = i / count;
      // The pitch slides from `from` to `to` (evenly in musical terms).
      const freq = layer.from * Math.pow(layer.to / layer.from, t);
      let v: number;
      if (layer.wave === 'noise') {
        noise ^= noise << 13;
        noise ^= noise >>> 17;
        noise ^= noise << 5;
        noise >>>= 0;
        const white = noise / 0x7fffffff - 1;
        // A one-pole low-pass filter: its cut-off is the layer's pitch.
        filtered += (1 - Math.exp((-2 * Math.PI * freq) / rate)) * (white - filtered);
        v = filtered;
      } else {
        phase = (phase + freq / rate) % 1;
        v =
          layer.wave === 'square'
            ? phase < 0.5
              ? 1
              : -1
            : layer.wave === 'triangle'
              ? 1 - 4 * Math.abs(phase - 0.5)
              : Math.sin(2 * Math.PI * phase);
      }
      // Fade in over the attack, then away to nothing by the end.
      const envelope = Math.min(1, i / attack) * (1 - t) * (1 - t);
      out[start + i] = (out[start + i] ?? 0) + v * envelope * layer.volume;
    }
  });
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
  return out;
}

const keyOf = (id: SoundId): string => `sfx-${id}`;

/**
 * Renders every sound into Phaser's audio cache (once, while loading). Does nothing if
 * the browser has no Web Audio: the game then plays silently.
 */
export function registerSounds(scene: Phaser.Scene): void {
  const manager = scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>;
  const context = manager.context;
  if (!context) return;
  for (const [id, layers] of Object.entries(SOUNDS)) {
    const samples = render(layers, context.sampleRate);
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    scene.cache.audio.add(keyOf(id as SoundId), buffer);
  }
}

/** Plays a sound, if sounds were made and the game isn't muted. */
export function playSound(scene: Phaser.Scene, id: SoundId): void {
  if (!scene.cache.audio.exists(keyOf(id))) return;
  scene.sound.play(keyOf(id), { volume: AUDIO.volume });
}

/**
 * Muted? Kept here, not read back from Phaser: its mute is a volume in the audio
 * engine, which may not show the change until the engine next runs (or at all before
 * the player's first tap unlocks sound). Remembered between visits (settings).
 */
let muted = false;

/** True while sounds are muted. */
export function isMuted(): boolean {
  return muted;
}

/** Applies the remembered mute setting (once, while loading). */
export function restoreMute(scene: Phaser.Scene): void {
  muted = readSettings().muted;
  scene.sound.mute = muted;
}

/** Mutes or unmutes every sound, and remembers it. Returns whether it is now muted. */
export function toggleMute(scene: Phaser.Scene): boolean {
  muted = !muted;
  scene.sound.mute = muted;
  writeSettings({ muted });
  return muted;
}
