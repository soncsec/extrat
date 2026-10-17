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
