/**
 * The seed a new game starts from: `?seed=123` in the URL for a repeatable
 * battle (tests, bug reports), otherwise a fresh random one so every game is
 * different. Everything random after this comes from the seeded generator.
 */
export function initialSeed(search: string = window.location.search): number {
  const raw = new URLSearchParams(search).get('seed');
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isFinite(n)) return n;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] as number) % 1_000_000;
}
