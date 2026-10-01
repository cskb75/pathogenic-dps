// The Godot engine's string hash and RandomNumberGenerator, bit for bit, so
// the app can redo the random choices a run's seed makes.
//
// - hash(String) is djb2 over the string's code points (String::hash).
// - RandomNumberGenerator is PCG32 (thirdparty/misc/pcg.cpp) with Godot's
//   seeding and float conversions (core/math/random_pcg.h). real_t is a
//   32-bit float, so randf() and randf_range() round like the engine does.

const MASK64 = (1n << 64n) - 1n;
const MULTIPLIER = 6364136223846793005n;
/** RandomPCG::DEFAULT_INC, as pcg32_srandom_r turns it into the stream increment. */
const DEFAULT_INC = 1442695040888963407n;

/** GDScript's hash() of a String: an unsigned 32-bit number. */
export function godotHash(text: string): number {
  let h = 5381;
  for (const ch of text) h = (Math.imul(h, 33) + ch.codePointAt(0)!) >>> 0;
  return h;
}

/** A RandomNumberGenerator with its `seed` set. */
export class GodotRng {
  private state = 0n;
  private readonly inc: bigint;

  constructor(seed: number | bigint, initseq: bigint = DEFAULT_INC) {
    this.inc = ((initseq << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.next();
    this.state = (this.state + BigInt.asUintN(64, BigInt(seed))) & MASK64;
    this.next();
  }

  private next(): number {
    const old = this.state;
    this.state = (old * MULTIPLIER + this.inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** randi(): 0 to 2^32 - 1. */
  randi(): number {
    return this.next();
  }

  /** randf(): 0 to 1, as a 32-bit float. */
  randf(): number {
    const exponent = this.next();
    if (exponent === 0) return 0;
    const significand = Math.fround((this.next() | 0x80000001) >>> 0);
    return Math.fround(significand * 2 ** (-32 - Math.clz32(exponent)));
  }

  /** randi_range(from, to), both ends included. */
  randiRange(from: number, to: number): number {
    if (from === to) return from;
    const min = Math.min(from, to);
    const diff = (Math.max(from, to) - min) >>> 0;
    if (diff === 0xffffffff) return this.next() + min;
    return this.bounded(diff + 1) + min;
  }

  /** randf_range(from, to), in 32-bit floats. */
  randfRange(from: number, to: number): number {
    const a = Math.fround(from);
    const b = Math.fround(to);
    return Math.fround(Math.fround(this.randf() * Math.fround(b - a)) + a);
  }

  private bounded(bound: number): number {
    const threshold = (0x100000000 - bound) % bound;
    for (;;) {
      const r = this.next();
      if (r >= threshold) return r % bound;
    }
  }
}

/** GDScript's roundi(): halves away from zero. */
export const roundi = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
