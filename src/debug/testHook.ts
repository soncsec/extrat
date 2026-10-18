import type Phaser from 'phaser';
import type { BattleScene, GameSnapshot } from '../scenes/BattleScene';

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
  snapshot(): GameSnapshot | null;
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
    setAmmo: (unitId, ammo) =>
      (game.scene.getScene('Battle') as BattleScene).debugSetAmmo(unitId, ammo),
    snapshot: () => {
      const s = game.scene.getScene('Battle') as BattleScene | null;
      return s && game.scene.isActive('Battle') ? s.snapshot() : null;
    },
  };
}
