/**
 * A whole number from the URL, such as `?seed=123`, in any capitalisation (the debrief
 * shows links as ?SEED=123: the pixel font has only capitals). Null if it's missing or
 * not a number. Only ever used as a number: never put into the page or sent anywhere.
 */
export function urlNumber(key: string, search: string = window.location.search): number | null {
  const params = [...new URLSearchParams(search)];
  const raw = params.find(([k]) => k.toLowerCase() === key)?.[1] ?? null;
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** A fresh random seed, so every game is different. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] as number) % 1_000_000;
}

/**
 * The seed a new game starts from: `?seed=123` in the URL for a repeatable
 * battle (tests, bug reports), otherwise a fresh random one so every game is
 * different. Everything random after this comes from the seeded generator.
 */
export function initialSeed(search: string = window.location.search): number {
  return urlNumber('seed', search) ?? randomSeed();
}

/**
 * A short word from the URL, such as `?landscape=town`, lower-cased and cut to 32
 * characters; null if missing. Callers check it against a fixed list before use.
 */
export function urlWord(key: string, search: string = window.location.search): string | null {
  const params = [...new URLSearchParams(search)];
  const raw = params.find(([k]) => k.toLowerCase() === key)?.[1] ?? null;
  return raw === null ? null : raw.toLowerCase().slice(0, 32);
}
