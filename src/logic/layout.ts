import { GAME_HEIGHT, GAME_WIDTH, HUD_SIDE_WIDTH, MAP_HEIGHT, MAP_WIDTH } from '../config/tuning';

/** The canvas and where the info bar goes: under the map, or beside it on touchscreens. */
export interface Layout {
  width: number;
  height: number;
  hud: 'bottom' | 'side';
}

/**
 * Desktops: the info bar under the map. Phones and tablets: the info panel beside it,
 * so the map gets the full height of a sideways screen (owner decision 2026-10-19).
 */
export function layoutFor(touch: boolean): Layout {
  return touch
    ? { width: MAP_WIDTH + HUD_SIDE_WIDTH, height: MAP_HEIGHT, hud: 'side' }
    : { width: GAME_WIDTH, height: GAME_HEIGHT, hud: 'bottom' };
}

/**
 * Where a menu screen (laid out GAME_WIDTH wide, x from 0) sits on a canvas of this
 * layout: at 1x always (the pixel font loses columns at other scales), centred side to
 * side. Returns the area the canvas shows in the screen's own coordinates: backgrounds
 * reach across it, and screens place their bottom rows by its height (shorter on
 * phones).
 */
export function designFit(layout: Layout): {
  zoom: number;
  view: { x: number; y: number; width: number; height: number };
} {
  return {
    zoom: 1,
    view: {
      x: Math.round((GAME_WIDTH - layout.width) / 2),
      y: 0,
      width: layout.width,
      height: layout.height,
    },
  };
}

/** True if the layout is shorter than the menus were designed for (phones). */
export function isShort(layout: Layout): boolean {
  return layout.height < GAME_HEIGHT;
}

/** Where the title screen's rows sit (y), as designed (desktops) and on shorter phones. */
export const TITLE_ROWS = {
  tall: {
    title: 34,
    tagline: 64,
    panel: 113,
    /** CONTINUE, NEW CAMPAIGN, BACK TO GAMES, and the key hint. */
    saved: [166, 186, 206, 226],
    /** START, BACK TO GAMES, and the key hint. */
    fresh: [172, 194, 214],
    damaged: 236,
  },
  short: {
    title: 32,
    tagline: 58,
    panel: 97,
    saved: [142, 160, 178, 196],
    fresh: [146, 166, 186],
    damaged: 213,
  },
} as const;
