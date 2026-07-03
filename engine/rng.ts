/**
 * Deterministic RNG. The entire simulation must draw randomness from here so
 * that a given seed reproduces the exact same history — this is what makes
 * runs replayable and on-chain snapshots verifiable. Never use Math.random()
 * anywhere in the engine or agent policies.
 */

/** mulberry32 — small, fast, good-enough PRNG for simulation purposes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary string seed into a 32-bit integer (xfnv1a-ish). */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private next: () => number;

  constructor(seed: string | number) {
    const s = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
    this.next = mulberry32(s);
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** In-place Fisher-Yates shuffle (deterministic). Returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Derive a named child RNG — useful to isolate streams (e.g. per-agent). */
  fork(label: string): Rng {
    return new Rng(hashSeed(label) ^ Math.floor(this.next() * 0xffffffff));
  }
}
