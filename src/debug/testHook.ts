import type Phaser from 'phaser';
import type { BattleScene, GameSnapshot } from '../scenes/BattleScene';
import { currentMusic } from '../scenes/music';
import { isMuted } from '../scenes/sfx';

/**
 * Test-only hook for Playwright (ADR-006). It is loaded only in the e2e build
 * (`vite build --mode e2e`), so the build players get never includes it.
 * Add controls here as the game grows (spawn an enemy, skip a level, ...).
 */
export interface TestHook {
  /** The key of the scene that is running, or null while loading. */
  scene(): string | null;
  /** Keys of every running scene (the result screen runs over the battle). */
  scenes(): string[];
  /** Sets a unit's health in the battle, to reach the win and loss screens quickly. */
  setHp(unitId: string, hp: number): void;
  /** Sets a unit's ammo, to test reloading. */
  setAmmo(unitId: string, ammo: number): void;
  /** Slows down (or speeds up) the battle's animations, for frame-by-frame visual checks. */
  setSpeed(scale: number): void;
  snapshot(): GameSnapshot | null;
  /** Stops or restarts the game's frames, as a hidden or overloaded browser may. */
  pauseFrames(paused: boolean): void;
  /** The sound effects made while loading (M6.1), whether sound is muted, and the music track playing (M7). */
  audio(): { sounds: string[]; muted: boolean; music: string | null };
}

declare global {
  interface Window {
    __game?: TestHook;
  }
}

export function installTestHook(game: Phaser.Game): void {
  window.__game = {
    scene: () => game.scene.getScenes(true)[0]?.scene.key ?? null,
    scenes: () => game.scene.getScenes(true).map((s) => s.scene.key),
    setHp: (unitId, hp) => (game.scene.getScene('Battle') as BattleScene).debugSetHp(unitId, hp),
    setSpeed: (scale) => {
      const battle = game.scene.getScene('Battle');
      battle.tweens.timeScale = scale;
      battle.time.timeScale = scale;
      game.anims.globalTimeScale = scale;
    },
    setAmmo: (unitId, ammo) =>
      (game.scene.getScene('Battle') as BattleScene).debugSetAmmo(unitId, ammo),
    pauseFrames: (paused) => (paused ? game.loop.sleep() : game.loop.wake()),
    audio: () => ({
      sounds: game.cache.audio.getKeys().filter((k) => k.startsWith('sfx-')),
      muted: isMuted(),
      music: currentMusic(),
    }),
    snapshot: () => {
      const s = game.scene.getScene('Battle') as BattleScene | null;
      return s && game.scene.isActive('Battle') ? s.snapshot() : null;
    },
  };
}
