/**
 * Seeded pseudo-random number generator (mulberry32).
 * Gameplay randomness goes through this so tests can replay a run exactly (ADR-006).
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/**
 * One step of the generator as a pure function, for random state kept inside
 * saved game state: returns a float in [0, 1) and the state to use next time.
 */
export function rngStep(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    const step = rngStep(state);
    state = step.state;
    return step.value;
  };

  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`invalid int range [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    range(min, max) {
      if (max < min) throw new RangeError(`invalid range [${min}, ${max})`);
      return min + next() * (max - min);
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('cannot pick from an empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}
