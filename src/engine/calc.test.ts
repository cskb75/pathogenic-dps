import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { calculate } from './calc';
import type { Build, Rarity, SlotState } from './types';

// Every expected value below is worked out by hand from the game's formulas
// (see src/engine/sim/behaviours.ts).
//
// Layout: the core square plus square "s" on the core's right edge (edge 1).
// Core edges 0 top, 2 bottom, 3 left are free; s.e1..s.e3 are free. A weapon
// on an edge connects only to its own module's centre; core.c and s.c connect.

const org = (id: string, rarity: Rarity = 'common', traits: string[] = []): SlotState => ({ organelle: { id, rarity, traits } });

function build(slots: Record<string, SlotState>, extra: Partial<Build> = {}): Build {
  return {
    version: 2,
    name: 'test',
    classId: 'nanobot',
    pieces: [
      { id: 'core', type: 'core' },
      { id: 's', type: 'square', attach: { to: 'core', edge: 1 } },
    ],
    slots,
    upgrades: {},
    mutations: {},
    plasmids: {},
    params: { staminaLimits: 0 },
    targets: 1,
    custom: [],
    ...extra,
  };
}

const dps = (b: Build, slot: string) => calculate(b, gameData).items.get(slot)!.weapon!.dps;

describe('weapons', () => {
  it('Caustic Secretor: 6 damage every 0.1s, scaling with rarity', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor') }), 'core.e0')).toBeCloseTo(60);
    // Rare: 6 x 1.4 damage every 0.1 x 0.9 seconds
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'rare') }), 'core.e0')).toBeCloseTo((6 * 1.4) / 0.09);
  });

  it('Tri-phase Tendril: every third strike deals 3x but comes 0.4s later', () => {
    expect(dps(build({ 'core.e0': org('tri-phase-tendril') }), 'core.e0')).toBeCloseTo((30 * 5) / (3 * 0.6 + 0.4));
  });

  it('Blastocyst Mortar: the explosion deals the shell damage and scales with level', () => {
    expect(dps(build({ 'core.e0': org('blastocyst-mortar') }), 'core.e0')).toBeCloseTo(200 / 1.7);
    const level3 = build({ 'core.e0': org('blastocyst-mortar') }, { params: { staminaLimits: 0, level: 3 } });
    expect(dps(level3, 'core.e0')).toBeCloseTo((200 * 2.5) / 1.7);
  });

  it('Rotary Extruder only fires with Overcharge', () => {
    const r = calculate(build({ 'core.e0': org('rotary-extruder') }), gameData).items.get('core.e0')!;
    expect(r.weapon!.dps).toBe(0);
    expect(r.notes.join(' ')).toMatch(/Needs Overcharge/);
    // Entrant Mitochondrion: 15s per 30s room = 50% uptime, 1 Overcharge -> x1.3 attack speed
    const withMito = build({ 'core.e0': org('rotary-extruder'), 'core.c': org('entrant-mitochondrion') });
    expect(dps(withMito, 'core.e0')).toBeCloseTo(0.5 * (8 / 0.04) * 1.3);
  });

  it('counts pellets that hit for shotguns', () => {
    // Cluster Ejector: 5 pellets x 19 every 1.5s, 70% of pellets land
    expect(dps(build({ 'core.e0': org('cluster-ejector') }), 'core.e0')).toBeCloseTo((5 * 19 * 0.7) / 1.5);
  });
});

describe('infusers and chains', () => {
  it('Oxysome adds 25% of base damage to a connected weapon', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('oxysome') }), 'core.e0')).toBeCloseTo(75);
  });

  it('does not reach a weapon on another module', () => {
    expect(dps(build({ 's.e1': org('caustic-secretor'), 'core.c': org('oxysome') }), 's.e1')).toBeCloseTo(60);
  });

  it('Vesicle passes the attack on to the next module, and can double up from Rare', () => {
    const b = build({ 's.e1': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': org('oxysome') });
    expect(dps(b, 's.e1')).toBeCloseTo(75);
    b.slots['s.c'] = org('vesicle', 'rare');
    // 20% chance to trigger Oxysome twice: +25% x 1.2
    expect(dps(b, 's.e1')).toBeCloseTo(78);
    const links = calculate(b, gameData).links;
    expect(links).toContainEqual({ from: 's.e1', to: 's.c', kind: 'attack' });
    expect(links).toContainEqual({ from: 's.c', to: 'core.c', kind: 'attack' });
  });

  it('Pyrosome burn pools and halves each second: about 2x its amount per hit', () => {
    // 6 bullet + 2 x 5 burn per hit, 10 hits a second
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('pyrosome') }), 'core.e0')).toBeCloseTo(160);
  });

  it('passes the burn down the chain, so a chained Oxysome boosts the burn only', () => {
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('pyrosome'), 's.c': org('oxysome') });
    // bullet 6 (Oxysome is not connected to the weapon) + burn 2 x (5 x 1.25)
    expect(dps(b, 'core.e0')).toBeCloseTo(10 * (6 + 2 * 6.25));
  });

  it('Triosome side shots land half the time, or always with Attractor down the chain', () => {
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('triosome') });
    // 2 side shots x 25% damage, 50% land
    expect(dps(b, 'core.e0')).toBeCloseTo(10 * (6 + 2 * 1.5 * 0.5));
    b.slots['s.c'] = org('attractor');
    expect(dps(b, 'core.e0')).toBeCloseTo(10 * (6 + 2 * 1.5));
  });

  it('only links attack-speed effects that actually apply', () => {
    // A Vesicle with no weapon infuser behind it does nothing for attack speed.
    const plain = calculate(build({ 's.e1': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': org('oxysome') }), gameData);
    expect(plain.links.filter((l) => l.kind === 'gun')).toEqual([]);
    // Resonant Cavity behind a Vesicle speeds up the weapon (not doubled: Vesicle only doubles attack effects).
    const b = build({ 's.e1': org('caustic-secretor'), 's.c': org('vesicle', 'legendary'), 'core.c': org('resonant-cavity') });
    const r = calculate(b, gameData);
    // Common secretor: 60 DPS x (1 + 0.01 x 20 stacks)
    expect(r.items.get('s.e1')!.weapon!.dps).toBeCloseTo(60 * 1.2);
    expect(r.links).toContainEqual({ from: 'core.c', to: 's.c', kind: 'gun' });
    expect(r.links).toContainEqual({ from: 's.c', to: 's.e1', kind: 'gun' });
  });

  it('Resonant Cavity adds attack speed at max stacks', () => {
    // (0.01 per hit) x 20 hits = +20%
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('resonant-cavity') }), 'core.e0')).toBeCloseTo(72);
  });

  it('Echosome splash only adds multi-target damage', () => {
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('echosome') }, { targets: 3 });
    const w = calculate(b, gameData).items.get('core.e0')!.weapon!;
    expect(w.dps).toBeCloseTo(60);
    // each hit splashes 40% of 6 onto the 2 other enemies
    expect(w.multiDps).toBeCloseTo(60 + 10 * 2.4 * 2);
  });
});

describe('slots, traits and Overcharge', () => {
  it('Volatile slots add 40% of base damage', () => {
    expect(dps(build({ 'core.e0': { ...org('caustic-secretor'), graft: 'volatile' } }), 'core.e0')).toBeCloseTo(84);
  });

  it('treats a trait as extra rarity steps', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'common', ['cancerous']) }), 'core.e0')).toBeCloseTo((6 * 1.4) / 0.09);
  });

  it('Excitable needs Overcharge', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'common', ['excitable']) }), 'core.e0')).toBe(0);
  });

  it('averages over mitochondrion uptime', () => {
    // Entrant: active half the time, x1.3 attack speed while active
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('entrant-mitochondrion') });
    expect(dps(b, 'core.e0')).toBeCloseTo(0.5 * 60 + 0.5 * 78);
    b.slots['core.c'].uptime = 1;
    expect(dps(b, 'core.e0')).toBeCloseTo(78);
  });

  it('adds Conductive Overcharge bonuses together', () => {
    const b = build({ 'core.e0': { ...org('caustic-secretor'), graft: 'conductive' }, 'core.c': { ...org('entrant-mitochondrion'), graft: 'conductive', uptime: 1 } });
    // 1 Overcharge x (1 + 0.4 + 0.4) = 1.8 -> x(1 + 0.3 x 1.8) attack speed
    expect(dps(b, 'core.e0')).toBeCloseTo(60 * (1 + 0.3 * 1.8));
  });

  it('relays Overcharge through a Vesicle', () => {
    const b = build({ 's.e1': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    expect(dps(b, 's.e1')).toBeCloseTo(78);
  });
});

describe('performance', () => {
  it('stays fast on a dense web of Vesicles and chainable infusers', () => {
    // 3x3 grid of squares with a Vesicle or chainable infuser in every centre.
    const pieces: Build['pieces'] = [{ id: 'core', type: 'core' }];
    const add = (id: string, to: string, edge: number) => pieces.push({ id, type: 'square', attach: { to, edge } });
    add('r', 'core', 1);
    add('l', 'core', 3);
    add('u', 'core', 0);
    add('d', 'core', 2);
    const slots: Record<string, SlotState> = {};
    slots['core.c'] = org('vesicle', 'legendary');
    slots['r.c'] = org('pyrosome', 'legendary');
    slots['l.c'] = org('vesicle', 'legendary');
    slots['u.c'] = org('echosome', 'legendary');
    slots['d.c'] = org('entrant-mitochondrion', 'legendary');
    for (const p of ['r', 'l', 'u', 'd']) for (const e of [1, 2, 3]) slots[`${p}.e${e}`] = org('caustic-secretor');
    const start = performance.now();
    const r = calculate(build(slots, { pieces, targets: 4 }), gameData);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(r.warnings).toEqual([]);
    expect(r.weapons).toHaveLength(12);
    expect(Number.isFinite(r.totalMultiDps)).toBe(true);
  });
});

describe('stamina', () => {
  it('pauses about 1.5s after draining 100 stamina', () => {
    const b = build({ 'core.e0': org('caustic-secretor') }, { params: {} });
    // 0.5 stamina x 10 shots/s: 20s of firing, then 1s + 100/190s refilling
    const firing = 100 / 5;
    expect(dps(b, 'core.e0')).toBeCloseTo((60 * firing) / (firing + 1 + 100 / 190));
  });

  it('Glycogen Synthesizer refunds the stamina of weapons it touches', () => {
    const b = build({ 'core.e0': org('pressurized-spicule'), 'core.c': org('glycogen-synthesizer') }, { params: {} });
    expect(dps(b, 'core.e0')).toBeCloseTo(140 / 2.5);
  });
});

describe('mutations, plasmids and run state', () => {
  const caustic = (slot = 'core.e0') => ({ [slot]: org('caustic-secretor') });
  const run = (slots: Record<string, SlotState>, extra: Partial<Build>) => build(slots, extra);

  it('adds damage mutations per stack', () => {
    // Corrosive Acid x2: +20% of base damage
    expect(dps(run(caustic(), { mutations: { 'corrosive-acid': 2 } }), 'core.e0')).toBeCloseTo(72);
  });

  it('counts mutations granted by plasmids as extra stacks', () => {
    // Fast Twitch Fibers: +15% attack speed, from the plasmid and picked once more
    expect(dps(run(caustic(), { plasmids: { 'nanobot-startingmutationplasmid': 1 } }), 'core.e0')).toBeCloseTo(60 * 1.15);
    const both = run(caustic(), { plasmids: { 'nanobot-startingmutationplasmid': 1 }, mutations: { 'fast-twitch-fibers': 1 } });
    expect(dps(both, 'core.e0')).toBeCloseTo(60 * 1.3);
  });

  it('Argentic Coating: +0.5% damage per core held', () => {
    expect(dps(run(caustic(), { mutations: { 'argentic-coating': 1 }, params: { staminaLimits: 0, cores: 50 } }), 'core.e0')).toBeCloseTo(75);
  });

  it('Prokaryotic Ancestry: +20% per empty internal slot', () => {
    // core.c and s.c are both empty
    expect(dps(run(caustic(), { mutations: { 'prokaryotic-ancestry': 1 } }), 'core.e0')).toBeCloseTo(84);
    const filled = run({ ...caustic(), 'core.c': org('vesicle') }, { mutations: { 'prokaryotic-ancestry': 1 } });
    expect(dps(filled, 'core.e0')).toBeCloseTo(72);
  });

  it('Focused Specialization: +200%, minus 50 points per weapon', () => {
    expect(dps(run(caustic(), { mutations: { 'focused-specialization': 1 } }), 'core.e0')).toBeCloseTo(150);
    const three = run({ ...caustic(), ...caustic('core.e2'), ...caustic('s.e2') }, { mutations: { 'focused-specialization': 1 } });
    expect(dps(three, 'core.e0')).toBeCloseTo(90);
  });

  it('Chirality: weapons on one side gain, the other side lose, the middle is unaffected', () => {
    const b = run({ ...caustic('core.e3'), ...caustic('s.e1'), ...caustic('core.e0') }, { mutations: { 'sinistral-chirality': 1 } });
    expect(dps(b, 'core.e3')).toBeCloseTo(120);
    expect(dps(b, 's.e1')).toBeCloseTo(30);
    expect(dps(b, 'core.e0')).toBeCloseTo(60);
  });

  it('Adrenaline works at 2 HP or less', () => {
    const b = run(caustic(), { mutations: { adrenaline: 1 }, params: { staminaLimits: 0, hp: 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(60 * 1.4 * 1.4);
    b.params.hp = 3;
    expect(dps(b, 'core.e0')).toBeCloseTo(60);
  });

  it('Mitochondrial Augmentation strengthens Overcharge from mitochondria', () => {
    const b = run({ ...caustic(), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } }, { mutations: { 'mitochondrial-augmentation': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(60 * (1 + 0.3 * 1.15));
  });

  it('Respiratory Burst: +15% damage per active mitochondrion', () => {
    const b = run({ ...caustic(), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } }, { mutations: { 'respiratory-burst': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(60 * 1.15 * 1.3);
  });

  it('Myofibrillar Hypertrophy boosts melee attacks only', () => {
    const b = run({ ...caustic(), 'core.e2': org('tri-phase-tendril') }, { mutations: { 'myofibrillar-hypertrophy': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(60);
    expect(dps(b, 'core.e2')).toBeCloseTo(((30 * 5) / (3 * 0.6 + 0.4)) * 1.15);
  });

  it('Glycogen Reserve adds a stamina container', () => {
    const b = run(caustic(), { mutations: { 'glycogen-reserve': 1 }, params: {} });
    const firing = 200 / 5;
    expect(dps(b, 'core.e0')).toBeCloseTo((60 * firing) / (firing + 1 + 200 / 190));
    expect(calculate(b, gameData).maxStamina).toBe(200);
  });

  it('Starvation Reflex averages half a container missing while firing', () => {
    const b = run(caustic(), { mutations: { 'starvation-reflex': 1 }, params: {} });
    const firing = 100 / 5;
    expect(dps(b, 'core.e0')).toBeCloseTo((60 * 1.075 * firing) / (firing + 1 + 100 / 190));
  });

  it('Glycogen Funnel: no stamina cost, less damage', () => {
    const b = run(caustic(), { mutations: { 'glycogen-funnel': 1, 'starvation-reflex': 1 }, params: {} });
    expect(dps(b, 'core.e0')).toBeCloseTo(42);
  });

  it('plasmids add damage per node, and Virulent Adaptation per boss', () => {
    const b = run(caustic(), {
      plasmids: { 'nanobot-damagelowerhpplasmid2': 2, 'nanobot-damageprogressionplasmid': 1 },
      params: { staminaLimits: 0, bossesBeaten: 3 },
    });
    expect(dps(b, 'core.e0')).toBeCloseTo(60 * (1 + 0.3 + 0.15));
  });

  it('summarises what each pick does and warns about unknown ones', () => {
    const r = calculate(run(caustic(), { mutations: { 'corrosive-acid': 1, 'cilium-growth': 1, nope: 1 } }), gameData);
    expect(r.run).toContainEqual({ source: 'Corrosive Acid', text: '+10% damage', inactive: false });
    expect(r.run.find((l) => l.source === 'Cilium Growth')?.inactive).toBe(true);
    expect(r.warnings).toContain('Unknown mutation "nope"');
  });
});
