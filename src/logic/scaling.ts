/**
 * Largest whole-number zoom at which the game still fits the window.
 * Whole numbers keep every art pixel the same size on screen (no blurry or uneven pixels).
 * Never below 1, even if the window is smaller than the game.
 */
export function integerZoom(
  viewWidth: number,
  viewHeight: number,
  gameWidth: number,
  gameHeight: number,
): number {
  if (gameWidth <= 0 || gameHeight <= 0) throw new RangeError('game size must be positive');
  const fit = Math.min(viewWidth / gameWidth, viewHeight / gameHeight);
  return Number.isFinite(fit) ? Math.max(1, Math.floor(fit)) : 1;
}

/**
 * The zoom (in CSS pixels) that shows the game as large as fits while every art pixel
 * covers a whole number of the screen's own pixels. Phones and high-density screens
 * have several device pixels per CSS pixel (`devicePixelRatio`), so they can show the
 * game at, say, 4/3 and still be crisp. With a ratio of 1 this is integerZoom.
 */
export function pixelZoom(
  viewWidth: number,
  viewHeight: number,
  gameWidth: number,
  gameHeight: number,
  devicePixelRatio: number,
): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return integerZoom(viewWidth * ratio, viewHeight * ratio, gameWidth, gameHeight) / ratio;
}

/**
 * The zoom that makes the game as large as the window allows, whole number or not
 * (owner decision 2026-10-19, for phones: an iPhone showed the game at about half the
 * screen). Art pixels may come out a hair uneven, which a phone's dense screen hides.
 * Never below `min`, and never a non-number.
 */
export function fitZoom(
  viewWidth: number,
  viewHeight: number,
  gameWidth: number,
  gameHeight: number,
  min = 1,
): number {
  if (gameWidth <= 0 || gameHeight <= 0) throw new RangeError('game size must be positive');
  const fit = Math.min(viewWidth / gameWidth, viewHeight / gameHeight);
  return Number.isFinite(fit) && fit > min ? fit : min;
}
