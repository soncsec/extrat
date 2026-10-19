import type Phaser from 'phaser';
import { designFit, layoutFor } from '../logic/layout';
import { isTouchDevice } from './touch';

/** This device's layout, settled once as the game starts. */
export const LAYOUT = layoutFor(isTouchDevice());

/**
 * Points a menu screen's camera so its GAME_WIDTH-wide design is centred on the canvas
 * (unchanged on desktops). Returns the area the canvas shows, for backgrounds to cover
 * and bottom rows to sit in (see designFit).
 */
export function fitDesign(scene: Phaser.Scene): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { zoom, view } = designFit(LAYOUT);
  const cam = scene.cameras.main;
  cam.setZoom(zoom);
  cam.setScroll(view.x, view.y);
  return view;
}
