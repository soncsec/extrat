import Phaser from 'phaser';
import './style.css';
import { GAME_HEIGHT, GAME_WIDTH } from './config/tuning';
import { integerZoom } from './logic/scaling';
import { BattleScene } from './scenes/BattleScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ResultScene } from './scenes/ResultScene';
import { TitleScene } from './scenes/TitleScene';

const zoomForWindow = (): number =>
  integerZoom(window.innerWidth, window.innerHeight, GAME_WIDTH, GAME_HEIGHT);

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#11141b',
  pixelArt: true,
  roundPixels: true,
  scale: {
    // Whole-number zoom keeps pixels crisp; the page's CSS centers the canvas.
    mode: Phaser.Scale.NONE,
    zoom: zoomForWindow(),
  },
  scene: [PreloadScene, TitleScene, BattleScene, ResultScene],
});

window.addEventListener('resize', () => {
  const zoom = zoomForWindow();
  if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
});

// The e2e build adds a test hook. Vite replaces MODE at build time, so this
// branch and the hook module are left out of the normal build entirely.
if (import.meta.env.MODE === 'e2e') {
  void import('./debug/testHook').then(({ installTestHook }) => installTestHook(game));
}
