import Phaser from 'phaser';
import './style.css';
import { fitZoom, pixelZoom } from './logic/scaling';
import { BattleScene } from './scenes/BattleScene';
import { DifficultyScene } from './scenes/DifficultyScene';
import { BriefingScene } from './scenes/BriefingScene';
import { HelpScene } from './scenes/HelpScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ResultScene } from './scenes/ResultScene';
import { SquadScene } from './scenes/SquadScene';
import { TitleScene } from './scenes/TitleScene';
import { LAYOUT } from './scenes/layout';
import { isTouchDevice } from './scenes/touch';

/**
 * The visible area: Safari on iPhone shows and hides its bars without resizing the
 * window, but its visual viewport follows them.
 */
const view = (): { width: number; height: number } => ({
  width: window.visualViewport?.width ?? window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight,
});

/**
 * Phones and tablets fill the screen (owner decision 2026-10-19); desktops keep every
 * art pixel on whole screen pixels.
 */
const zoomForWindow = (): number => {
  const { width, height } = view();
  return isTouchDevice()
    ? fitZoom(width, height, LAYOUT.width, LAYOUT.height)
    : pixelZoom(width, height, LAYOUT.width, LAYOUT.height, window.devicePixelRatio);
};

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // Phones and tablets: the info panel beside the map (see LAYOUT).
  width: LAYOUT.width,
  height: LAYOUT.height,
  backgroundColor: '#11141b',
  pixelArt: true,
  roundPixels: true,
  // A long press on a touchscreen (or a right click) doesn't open the browser's menu.
  disableContextMenu: true,
  scale: {
    // Each art pixel covers a whole number of screen pixels, so pixels stay crisp; the
    // page's CSS centers the canvas.
    mode: Phaser.Scale.NONE,
    zoom: zoomForWindow(),
  },
  scene: [
    PreloadScene,
    TitleScene,
    DifficultyScene,
    BriefingScene,
    BattleScene,
    ResultScene,
    HelpScene,
    SquadScene,
  ],
});

/**
 * Fits the game again, and tells it where the canvas now is on the page, so a tap lands
 * on the tile under the finger (Safari's bars come and go, the phone turns).
 */
const refit = (): void => {
  const zoom = zoomForWindow();
  if (game.scale.zoom !== zoom) game.scale.setZoom(zoom);
  game.scale.updateBounds();
};
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', refit);
window.visualViewport?.addEventListener('resize', refit);
window.visualViewport?.addEventListener('scroll', refit);

// The e2e build adds a test hook. Vite replaces MODE at build time, so this
// branch and the hook module are left out of the normal build entirely.
if (import.meta.env.MODE === 'e2e') {
  void import('./debug/testHook').then(({ installTestHook }) => installTestHook(game));
}
