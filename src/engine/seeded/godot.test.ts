import { describe, expect, it } from 'vitest';
import { GodotRng, godotHash } from './godot';

// Expected values come from Godot's own C++ (thirdparty/misc/pcg.cpp and the
// RandomPCG methods in core/math/random_pcg.h), compiled and run as is.
describe('Godot RNG port', () => {
  it('is PCG32: the reference generator gives the published numbers', () => {
    const rng = new GodotRng(42, 54n);
    expect(Array.from({ length: 6 }, () => rng.randi())).toEqual([2707161783, 2068313097, 3122475824, 2211639955, 3215226955, 3421331566]);
  });

  it('hashes strings like GDScript hash()', () => {
    expect(godotHash('')).toBe(5381);
    expect(godotHash('A')).toBe(177638);
    expect(godotHash('ABCD3467mut1')).toBe(1580175530);
    expect(godotHash('ABCD3467rewards1')).toBe(4022697900);
    expect(godotHash('123456_7')).toBe(938408784);
  });

  const cases: [number, number[], number[], number[], number[]][] = [
    [0, [881477183, 1327520283, 692503688, 2153658078], [0.202271849, 0.125359401, 0.358580858, 0.168866158], [6, 5, 2, 5, 5, 25], [1.06068158, 1.03760779, 1.10757422]],
    [1, [1811587497, 683407368, 2033395789, 2375931748], [0.329559088, 0.276594847, 0.509809613, 0.74202168], [6, 0, 5, 1, 14, 14], [1.09886765, 1.08297849, 1.1529429]],
    [42, [492690617, 1919685028, 3561993920, 683038915], [0.11837019, 0.659032404, 0.298186809, 0.03759671], [6, 2, 2, 6, 28, 8], [1.03551102, 1.19770968, 1.08945608]],
    [4294967295, [1866142959, 445709547, 1895696473, 2770767185], [0.301887423, 0.322559744, 0.394426852, 0.414842099], [2, 3, 6, 4, 28, 13], [1.09056616, 1.0967679, 1.11832809]],
    [2166136261, [946602610, 3880973335, 707235219, 140552601], [0.225902379, 0.133181244, 0.208334222, 0.102709644], [2, 1, 5, 0, 26, 2], [1.06777072, 1.03995442, 1.06250024]],
  ];

  it.each(cases)('seed %d: randi, randf, randi_range and randf_range match the engine', (seed, ints, floats, ranges, franges) => {
    let rng = new GodotRng(seed);
    expect(Array.from({ length: 4 }, () => rng.randi())).toEqual(ints);
    rng = new GodotRng(seed);
    // The engine printed these 32-bit floats to 9 significant digits.
    for (const f of floats) expect(Number(rng.randf().toPrecision(9))).toBe(f);
    rng = new GodotRng(seed);
    expect([0, 0, 0, 0].map(() => rng.randiRange(0, 6)).concat([0, 0].map(() => rng.randiRange(0, 30)))).toEqual(ranges);
    rng = new GodotRng(seed);
    for (const f of franges) expect(Number(rng.randfRange(1.0, 1.3).toPrecision(9))).toBe(f);
  });
});
