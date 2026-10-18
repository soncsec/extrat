/**
 * True on a phone or tablet: the main pointer is a finger. Used only to pick words
 * and buttons ("tap" rather than "click"); taps themselves are told apart per press.
 */
export function isTouchDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
