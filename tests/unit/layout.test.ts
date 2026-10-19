import { describe, expect, it } from 'vitest';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  HUD_SIDE_WIDTH,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '../../src/config/tuning';
import { designFit, isShort, layoutFor, TITLE_ROWS } from '../../src/logic/layout';
import { wrapLines } from '../../src/logic/text';

describe('layout (owner decision 2026-10-19: the HUD beside the map on phones)', () => {
  it('keeps the desktop as designed, and puts the panel beside the map on touchscreens', () => {
    expect(layoutFor(false)).toEqual({ width: GAME_WIDTH, height: GAME_HEIGHT, hud: 'bottom' });
    expect(layoutFor(true)).toEqual({
      width: MAP_WIDTH + HUD_SIDE_WIDTH,
      height: MAP_HEIGHT,
      hud: 'side',
    });
    expect(isShort(layoutFor(false))).toBe(false);
    expect(isShort(layoutFor(true))).toBe(true);
  });

  it('shows menus at 1x: unmoved on desktops, centred side to side on phones', () => {
    expect(designFit(layoutFor(false))).toEqual({
      zoom: 1,
      view: { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT },
    });
    const phone = designFit(layoutFor(true));
    expect(phone.zoom).toBe(1);
    expect(phone.view.x).toBe(-Math.round(HUD_SIDE_WIDTH / 2));
    expect(phone.view).toMatchObject({
      y: 0,
      width: MAP_WIDTH + HUD_SIDE_WIDTH,
      height: MAP_HEIGHT,
    });
  });

  it('fits every title row inside its screen', () => {
    for (const [name, rows, height] of [
      ['tall', TITLE_ROWS.tall, GAME_HEIGHT],
      ['short', TITLE_ROWS.short, MAP_HEIGHT],
    ] as const) {
      const ys = [rows.title, rows.tagline, rows.panel, ...rows.saved, ...rows.fresh, rows.damaged];
      for (const y of ys) expect(y, name).toBeLessThan(height - 6);
      // The big title (5x, 7 pixels tall) clears the top edge.
      expect(rows.title - (7 * 5) / 2, name).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('wrapLines', () => {
  it('starts a line at each double space and wraps words to the width', () => {
    expect(wrapLines('RKE TANAKA  HP 4/4  AP 2/2', 15)).toBe('RKE TANAKA\nHP 4/4\nAP 2/2');
    expect(wrapLines('Tap a marine to select it', 12)).toBe('Tap a marine\nto select it');
    expect(wrapLines('Alien turn   Space or tap: fast forward', 15)).toBe(
      'Alien turn\nSpace or tap:\nfast forward',
    );
  });

  it('cuts a word longer than a line, keeps given lines, and leaves short text alone', () => {
    expect(wrapLines('ABCDEFGHIJ', 4)).toBe('ABCD\nEFGH\nIJ');
    expect(wrapLines('one\ntwo', 10)).toBe('one\ntwo');
    expect(wrapLines('short', 10)).toBe('short');
    expect(wrapLines('anything', 0)).toBe('anything');
    for (const line of wrapLines('It fires next turn: leave the red squares', 15).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(15);
    }
  });
});
