import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { calculate } from './calc';
import type { Build, Rarity, SlotState } from './types';

// Every expected value below is worked out by hand from the game's formulas
// (see src/engine/sim/behaviours.ts).
//
// Layout: the core square plus square "s" on the core's right edge (edge 1).
// Core edges 0 top, 2 bottom, 3 left are free; s.e1 top, s.e2 right, s.e3
// bottom are free. core.c and s.c connect. As in the game, an edge slot
// connects to its own module's centre and to the neighbouring module's
// centre, unless it faces away from it: core.e3 and s.e2 reach only their own.
// The body's centre is halfway between the two modules.

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
    evolutions: [],
    mutations: {},
    plasmids: {},
    params: { staminaLimits: 0 },
    targets: 1,
    custom: [],
    ...extra,
  };
}

const dps = (b: Build, slot: string) => calculate(b, gameData).items.get(slot)!.weapon!.dps;

/** Attacks per second for a cooldown: the game checks weapons once per physics tick (1/60s). */
const rate = (cooldown: number) => 60 / Math.max(1, Math.ceil(cooldown * 60 - 1e-6));
// Caustic Secretor: 6.5 damage, 0.105s cooldown = 7 ticks.
const CAUSTIC = 6.5;
const BASE = CAUSTIC * rate(0.105);
// With 1 Overcharge: 0.105 / 1.3 = 0.081s = 5 ticks, 12 shots a second.
const CHARGED = CAUSTIC * rate(0.105 / 1.3);

describe('weapons', () => {
  it('Caustic Secretor: 6.5 damage every 0.105s, rounded up to whole physics ticks', () => {
    expect(rate(0.105)).toBeCloseTo(60 / 7);
    expect(dps(build({ 'core.e0': org('caustic-secretor') }), 'core.e0')).toBeCloseTo(BASE);
    // Rare: 6.5 x 1.4 damage every 0.105 x 0.9 seconds
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'rare') }), 'core.e0')).toBeCloseTo(6.5 * 1.4 * rate(0.105 * 0.9));
  });

  it('Tri-phase Tendril: every third strike deals 3x but comes 0.4s later', () => {
    expect(dps(build({ 'core.e0': org('tri-phase-tendril') }), 'core.e0')).toBeCloseTo((40 * 5) / (2 * 0.6 + 1.0));
  });

  it('Blastocyst Mortar: the explosion deals the shell damage and scales with level', () => {
    expect(dps(build({ 'core.e0': org('blastocyst-mortar') }), 'core.e0')).toBeCloseTo(300 / 1.7);
    const level3 = build({ 'core.e0': org('blastocyst-mortar') }, { params: { staminaLimits: 0, level: 3 } });
    expect(dps(level3, 'core.e0')).toBeCloseTo((300 * 2.5) / 1.7);
  });

  it('Rotary Extruder only fires with 0.9 Overcharge', () => {
    const r = calculate(build({ 'core.e0': org('rotary-extruder') }), gameData).items.get('core.e0')!;
    expect(r.weapon!.dps).toBe(0);
    expect(r.notes.join(' ')).toMatch(/Needs Overcharge/);
    // Entrant Mitochondrion: 15s per 30s room = 50% uptime; 0.04s / 1.3 rounds up to 2 ticks
    const withMito = build({ 'core.e0': org('rotary-extruder'), 'core.c': org('entrant-mitochondrion') });
    expect(dps(withMito, 'core.e0')).toBeCloseTo(0.5 * 9 * 30);
  });

  it('counts pellets that hit for shotguns', () => {
    // Cluster Ejector: 5 pellets x 19 every 1.5s, 70% of pellets land
    expect(dps(build({ 'core.e0': org('cluster-ejector') }), 'core.e0')).toBeCloseTo((5 * 19 * 0.7) / 1.5);
  });

  it('Oxidator: each flame adds 2 burn, which deals about twice that', () => {
    // 0.03s = 2 ticks: 30 flames a second, 0.7 + 2 x 2 each
    expect(dps(build({ 'core.e0': org('oxidator') }), 'core.e0')).toBeCloseTo(30 * (0.7 + 4));
  });

  it('Galvanic Conduit: bolts deal 80% on average and come early at random', () => {
    const w = calculate(build({ 'core.e0': org('galvanic-conduit') }), gameData).items.get('core.e0')!.weapon!;
    expect(w.dps / w.attacksPerSecond).toBeCloseTo(20 * 0.8);
    expect(w.attacksPerSecond).toBeGreaterThan(1 / 0.3);
  });

  it('Luciferase Pump: a held beam hitting 10 times a second; Overcharge adds damage', () => {
    expect(dps(build({ 'core.e0': org('luciferase-pump') }), 'core.e0')).toBeCloseTo(80);
    const charged = build({ 'core.e0': org('luciferase-pump'), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    expect(dps(charged, 'core.e0')).toBeCloseTo(80 * 1.3);
  });

  it('pseudopods strike on their own, without stamina', () => {
    // Kinetic Pseudopod: 20 damage every 2s
    const r = calculate(build({ 'core.e0': org('kinetic-pseudopod') }, { params: {} }), gameData);
    expect(r.items.get('core.e0')!.weapon!.dps).toBeCloseTo(10);
    expect(r.items.get('core.e0')!.weapon!.staminaPerSecond).toBe(0);
  });

  it('Exocytotic Chamber: charges 2s, then fires 140% of the weapon damage, replacing flat infuser bonuses', () => {
    const chamber = build({ 'core.e0': org('caustic-secretor'), 's.c': org('exocytotic-chamber') });
    const expected = (2 * (6.5 / 0.105) * 1.4) / (2 + 2 / 60);
    expect(dps(chamber, 'core.e0')).toBeCloseTo(expected);
    // Oxysome's flat bonus on the weapon is replaced, but it also touches the chamber,
    // which applies its neighbours to each of the 15 shots of a full cluster (+25% of 6.5 each).
    chamber.slots['core.c'] = org('oxysome');
    expect(dps(chamber, 'core.e0')).toBeCloseTo(expected + (15 * 6.5 * 0.25) / (2 + 2 / 60));
  });
});

describe('infusers and chains', () => {
  it('Oxysome adds 25% of base damage to a connected weapon', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('oxysome') }), 'core.e0')).toBeCloseTo(1.25 * BASE);
  });

  it('reaches a weapon on a neighbouring module, unless the weapon faces away', () => {
    expect(dps(build({ 's.e1': org('caustic-secretor'), 'core.c': org('oxysome') }), 's.e1')).toBeCloseTo(1.25 * BASE);
    expect(dps(build({ 's.e2': org('caustic-secretor'), 'core.c': org('oxysome') }), 's.e2')).toBeCloseTo(BASE);
  });

  it('Vesicle passes the attack on to the next module, and can double up from Rare', () => {
    const b = build({ 's.e2': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': org('oxysome') });
    expect(dps(b, 's.e2')).toBeCloseTo(1.25 * BASE);
    b.slots['s.c'] = org('vesicle', 'rare');
    // 20% chance to trigger Oxysome twice: +25% x 1.2
    expect(dps(b, 's.e2')).toBeCloseTo(1.3 * BASE);
    const links = calculate(b, gameData).links;
    expect(links).toContainEqual({ from: 's.e2', to: 's.c', kind: 'attack' });
    expect(links).toContainEqual({ from: 's.c', to: 'core.c', kind: 'attack' });
  });

  it('Pyrosome burn pools and halves each second: about 2x its amount per hit', () => {
    // 6.5 bullet + 2 x 4 burn per hit
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('pyrosome') }), 'core.e0')).toBeCloseTo((6.5 + 8) * rate(0.105));
  });

  it('burns pool on the enemy, so chained modifiers only touch them once and are ignored', () => {
    const b = build({ 'core.e3': org('caustic-secretor'), 'core.c': org('pyrosome'), 's.c': org('oxysome') });
    expect(dps(b, 'core.e3')).toBeCloseTo((6.5 + 8) * rate(0.105));
  });

  it('Triosome side shots land half the time, or always with Attractor down the chain', () => {
    const b = build({ 'core.e3': org('caustic-secretor'), 'core.c': org('triosome') });
    // 2 side shots x 25% damage, 50% land
    expect(dps(b, 'core.e3')).toBeCloseTo((6.5 + 2 * 6.5 * 0.25 * 0.5) * rate(0.105));
    b.slots['s.c'] = org('attractor');
    expect(dps(b, 'core.e3')).toBeCloseTo((6.5 + 2 * 6.5 * 0.25) * rate(0.105));
  });

  it('only links attack-speed effects that actually apply', () => {
    // A Vesicle with no weapon infuser behind it does nothing for attack speed.
    const plain = calculate(build({ 's.e2': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': org('oxysome') }), gameData);
    expect(plain.links.filter((l) => l.kind === 'gun')).toEqual([]);
    // Resonant Cavity behind a Vesicle speeds up the weapon (not doubled: Vesicle only doubles attack effects).
    const b = build({ 's.e2': org('caustic-secretor'), 's.c': org('vesicle', 'legendary'), 'core.c': org('resonant-cavity') });
    const r = calculate(b, gameData);
    // +1.5% x 40 hits = +60% attack speed
    expect(r.items.get('s.e2')!.weapon!.dps).toBeCloseTo(6.5 * rate(0.105 / 1.6));
    expect(r.links).toContainEqual({ from: 'core.c', to: 's.c', kind: 'gun' });
    expect(r.links).toContainEqual({ from: 's.c', to: 's.e2', kind: 'gun' });
  });

  it('Resonant Cavity adds attack speed at max stacks', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('resonant-cavity') }), 'core.e0')).toBeCloseTo(6.5 * rate(0.105 / 1.6));
  });

  it('Echosome splash only adds multi-target damage', () => {
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('echosome') }, { targets: 3 });
    const w = calculate(b, gameData).items.get('core.e0')!.weapon!;
    expect(w.dps).toBeCloseTo(BASE);
    // each hit splashes 35% of 6.5 onto the 2 other enemies
    expect(w.multiDps).toBeCloseTo(BASE + rate(0.105) * 6.5 * 0.35 * 2);
  });

  it('Peroxisome explodes every hit for twice its damage, catching the enemy hit', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('peroxisome') }), 'core.e0')).toBeCloseTo(3 * BASE);
  });

  it('Katanosome: a 10% chance to double the attack', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor'), 'core.c': org('katanosome') }), 'core.e0')).toBeCloseTo(1.1 * BASE);
  });
});

describe('slots, traits and Overcharge', () => {
  it('Volatile slots add 40% of base damage', () => {
    expect(dps(build({ 'core.e0': { ...org('caustic-secretor'), graft: 'volatile' } }), 'core.e0')).toBeCloseTo(1.4 * BASE);
  });

  it('treats a trait as extra rarity steps', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'common', ['cancerous']) }), 'core.e0')).toBeCloseTo(6.5 * 1.4 * rate(0.105 * 0.9));
  });

  it('Excitable needs 0.9 Overcharge', () => {
    expect(dps(build({ 'core.e0': org('caustic-secretor', 'common', ['excitable']) }), 'core.e0')).toBe(0);
    const charged = build({ 'core.e0': org('caustic-secretor', 'common', ['excitable']), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    // Excitable adds 3 rarity steps
    expect(dps(charged, 'core.e0')).toBeCloseTo(6.5 * 2.2 * rate((0.105 * 0.7) / 1.3));
  });

  it('averages over mitochondrion uptime', () => {
    // Entrant: active half the time, x1.3 attack speed while active
    const b = build({ 'core.e0': org('caustic-secretor'), 'core.c': org('entrant-mitochondrion') });
    expect(dps(b, 'core.e0')).toBeCloseTo(0.5 * BASE + 0.5 * CHARGED);
    b.slots['core.c'].uptime = 1;
    expect(dps(b, 'core.e0')).toBeCloseTo(CHARGED);
  });

  it('adds Conductive Overcharge bonuses together', () => {
    const b = build({ 'core.e0': { ...org('caustic-secretor'), graft: 'conductive' }, 'core.c': { ...org('entrant-mitochondrion'), graft: 'conductive', uptime: 1 } });
    // 1 Overcharge x (1 + 0.4 + 0.4) = 1.8 -> x(1 + 0.3 x 1.8) attack speed
    expect(dps(b, 'core.e0')).toBeCloseTo(6.5 * rate(0.105 / (1 + 0.3 * 1.8)));
  });

  it('relays Overcharge through a Vesicle', () => {
    const b = build({ 's.e2': org('caustic-secretor'), 's.c': org('vesicle'), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    expect(dps(b, 's.e2')).toBeCloseTo(CHARGED);
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

describe('actives and self-charging organelles', () => {
  it('Explosive Charge fires every 10 Overcharge-seconds', () => {
    const b = build({ 'core.c': org('explosive-charge'), 's.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    expect(dps(b, 'core.c')).toBeCloseTo(100);
    // Half the uptime: half as many explosions.
    b.slots['s.c'].uptime = 0.5;
    expect(dps(b, 'core.c')).toBeCloseTo(50);
    // Autonomic Discharge: actives charge a third faster.
    b.slots['s.c'].uptime = 1;
    b.mutations = { 'autonomic-discharge': 1 };
    expect(dps(b, 'core.c')).toBeCloseTo(1000 / 7.5);
    // Metabolic Refinement: 35% faster.
    b.mutations = { 'metabolic-refinement': 1 };
    expect(dps(b, 'core.c')).toBeCloseTo(135);
  });

  it('does nothing without Overcharge, unless Basal Metabolism charges it', () => {
    expect(dps(build({ 'core.c': org('explosive-charge') }), 'core.c')).toBe(0);
    // 0.3 Overcharge of its own: an explosion every 33s
    expect(dps(build({ 'core.c': org('explosive-charge') }, { mutations: { 'basal-metabolism': 1 } }), 'core.c')).toBeCloseTo(30);
  });

  it('Cryopulse: a 40 damage wave for every 6 Overcharge-seconds', () => {
    const b = build({ 'core.c': org('cryopulse'), 's.c': { ...org('entrant-mitochondrion'), uptime: 1 } });
    expect(dps(b, 'core.c')).toBeCloseTo(40 / 6);
  });

  it('Galvanic Sac zaps nearby enemies as fast as it recharges', () => {
    // 0.5 energy per second / 0.25 per zap = 2 zaps/s, enemies nearby half the time
    const b = build({ 'core.c': org('galvanic-sac') }, { params: { staminaLimits: 0, nearbyTime: 0.5 } });
    expect(dps(b, 'core.c')).toBeCloseTo(20);
    b.mutations = { 'corrosive-acid': 1 };
    expect(dps(b, 'core.c')).toBeCloseTo(22);
  });

  it('counts organelles that never deal damage as modeled', () => {
    const r = calculate(build({ 'core.c': org('regenerator') }), gameData);
    expect(r.items.get('core.c')!.modeled).toBe(true);
    expect(r.items.get('core.c')!.notes).toContain('Heals.');
  });
});

describe('minions', () => {
  const engagedAll = () => ({ staminaLimits: 0, minionEngagement: 1 });

  it('Apex Nidus: a slash every 1.5s, a charge every 5s, and contact damage', () => {
    const b = build({ 'core.c': org('apex-nidus') }, { params: engagedAll() });
    expect(dps(b, 'core.c')).toBeCloseTo((1 / 1.5 + 1 / 5) * 50 + (0.5 / 0.8) * 15);
    // Half the time engaged: half the damage.
    b.params.minionEngagement = 0.5;
    expect(dps(b, 'core.c')).toBeCloseTo(((1 / 1.5 + 1 / 5) * 50 + (0.5 / 0.8) * 15) / 2);
  });

  it('Sentry Nidus: sentries pile up through the room, each firing a shell a second', () => {
    // 1 Overcharge: a sentry every 10s, each alive min(20s, 30s room / 2) = 15s on average.
    const b = build({ 'core.c': org('sentry-nidus'), 's.c': { ...org('entrant-mitochondrion'), uptime: 1 } }, { params: engagedAll() });
    expect(dps(b, 'core.c')).toBeCloseTo(0.1 * 15 * 80);
  });

  it('Nidublast: each minion slashes every 0.15s for 5s, with the gun\'s infusers', () => {
    const b = build({ 'core.e0': org('nidublast') }, { params: engagedAll() });
    expect(dps(b, 'core.e0')).toBeCloseTo((1 / 4) * (5 / 0.15) * 20);
    b.slots['core.c'] = org('oxysome');
    expect(dps(b, 'core.e0')).toBeCloseTo((1 / 4) * (5 / 0.15) * 25);
  });

  it('Mitotic Nidus: its minion fires connected weapons at 40% speed', () => {
    const r = calculate(build({ 'core.c': org('mitotic-nidus'), 'core.e0': org('caustic-secretor') }, { params: engagedAll() }), gameData);
    expect(r.items.get('core.c')!.weapon!.dps).toBeCloseTo(6.5 / (0.105 / 0.4 + 0.025));
    expect(r.items.get('core.e0')!.weapon!.dps).toBeCloseTo(BASE);
  });

  it('Symbiotic Pseudopod: +200% damage for the minion it supports', () => {
    const plain = dps(build({ 'core.c': org('apex-nidus') }, { params: engagedAll() }), 'core.c');
    const buffed = dps(build({ 'core.c': org('apex-nidus'), 'core.e0': org('symbiotic-pseudopod') }, { params: engagedAll() }), 'core.c');
    expect(buffed).toBeCloseTo(3 * plain);
  });
});

describe('stamina', () => {
  it('pauses about 1.5s after draining 100 stamina', () => {
    const b = build({ 'core.e0': org('caustic-secretor') }, { params: {} });
    // 0.5 stamina a shot: then 1s + 100/190s refilling
    const firing = 100 / (0.5 * rate(0.105));
    expect(dps(b, 'core.e0')).toBeCloseTo((BASE * firing) / (firing + 1 + 100 / 190));
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
    expect(dps(run(caustic(), { mutations: { 'corrosive-acid': 2 } }), 'core.e0')).toBeCloseTo(1.2 * BASE);
  });

  it('counts mutations granted by plasmids as extra stacks', () => {
    // Fast Twitch Fibers: +15% attack speed, from the plasmid and picked once more
    expect(dps(run(caustic(), { plasmids: { 'nanobot-startingmutationplasmid': 1 } }), 'core.e0')).toBeCloseTo(6.5 * rate(0.105 / 1.15));
    const both = run(caustic(), { plasmids: { 'nanobot-startingmutationplasmid': 1 }, mutations: { 'fast-twitch-fibers': 1 } });
    expect(dps(both, 'core.e0')).toBeCloseTo(6.5 * rate(0.105 / 1.3));
  });

  it('Argentic Coating: +0.5% damage per core held', () => {
    expect(dps(run(caustic(), { mutations: { 'argentic-coating': 1 }, params: { staminaLimits: 0, cores: 50 } }), 'core.e0')).toBeCloseTo(1.25 * BASE);
  });

  it('Prokaryotic Ancestry: +20% per empty internal slot', () => {
    // core.c and s.c are both empty
    expect(dps(run(caustic(), { mutations: { 'prokaryotic-ancestry': 1 } }), 'core.e0')).toBeCloseTo(1.4 * BASE);
    const filled = run({ ...caustic(), 'core.c': org('vesicle') }, { mutations: { 'prokaryotic-ancestry': 1 } });
    expect(dps(filled, 'core.e0')).toBeCloseTo(1.2 * BASE);
  });

  it('Focused Specialization: +200%, minus 50 points per gun', () => {
    expect(dps(run(caustic(), { mutations: { 'focused-specialization': 1 } }), 'core.e0')).toBeCloseTo(2.5 * BASE);
    const three = run({ ...caustic(), ...caustic('core.e2'), ...caustic('s.e2') }, { mutations: { 'focused-specialization': 1 } });
    expect(dps(three, 'core.e0')).toBeCloseTo(1.5 * BASE);
    // Pseudopods aren't guns.
    const pod = run({ ...caustic(), 'core.e2': org('kinetic-pseudopod') }, { mutations: { 'focused-specialization': 1 } });
    expect(dps(pod, 'core.e0')).toBeCloseTo(2.5 * BASE);
  });

  it('Chirality: weapons on one side gain, the other side lose, the middle is unaffected', () => {
    // Measured from the body's centre, halfway between the two modules.
    const b = run({ ...caustic('core.e3'), ...caustic('s.e2'), ...caustic('core.e0') }, { mutations: { 'sinistral-chirality': 1 } });
    expect(dps(b, 'core.e3')).toBeCloseTo(2 * BASE);
    expect(dps(b, 's.e2')).toBeCloseTo(0.5 * BASE);
    expect(dps(b, 'core.e0')).toBeCloseTo(2 * BASE);
    // On a lone core, its top edge is in the middle.
    const lone = run(caustic(), { mutations: { 'sinistral-chirality': 1 }, pieces: [{ id: 'core', type: 'core' }] });
    expect(dps(lone, 'core.e0')).toBeCloseTo(BASE);
  });

  it('Adrenaline works at 2 HP or less', () => {
    const b = run(caustic(), { mutations: { adrenaline: 1 }, params: { staminaLimits: 0, hp: 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(6.5 * 1.4 * rate(0.105 / 1.4));
    b.params.hp = 3;
    expect(dps(b, 'core.e0')).toBeCloseTo(BASE);
  });

  it('Mitochondrial Augmentation strengthens Overcharge from mitochondria', () => {
    const b = run({ ...caustic(), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } }, { mutations: { 'mitochondrial-augmentation': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(6.5 * rate(0.105 / (1 + 0.3 * 1.15)));
  });

  it('Respiratory Burst: +15% damage per active mitochondrion', () => {
    const b = run({ ...caustic(), 'core.c': { ...org('entrant-mitochondrion'), uptime: 1 } }, { mutations: { 'respiratory-burst': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(1.15 * CHARGED);
  });

  it('Myofibrillar Hypertrophy boosts melee attacks only', () => {
    const b = run({ ...caustic(), 'core.e2': org('tri-phase-tendril') }, { mutations: { 'myofibrillar-hypertrophy': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(BASE);
    expect(dps(b, 'core.e2')).toBeCloseTo(((40 * 5) / 2.2) * 1.15);
  });

  it('Chemotactic Cascade: +15% damage per pseudopod', () => {
    const b = run({ ...caustic(), 'core.e2': org('kinetic-pseudopod') }, { mutations: { 'chemotactic-cascade': 1 } });
    expect(dps(b, 'core.e0')).toBeCloseTo(1.15 * BASE);
  });

  it('Glycogen Reserve adds a stamina container', () => {
    const b = run(caustic(), { mutations: { 'glycogen-reserve': 1 }, params: {} });
    const firing = 200 / (0.5 * rate(0.105));
    expect(dps(b, 'core.e0')).toBeCloseTo((BASE * firing) / (firing + 1 + 200 / 190));
    expect(calculate(b, gameData).maxStamina).toBe(200);
  });

  it('Starvation Reflex averages half a container missing while firing', () => {
    const b = run(caustic(), { mutations: { 'starvation-reflex': 1 }, params: {} });
    const firing = 100 / (0.5 * rate(0.105));
    expect(dps(b, 'core.e0')).toBeCloseTo((BASE * 1.075 * firing) / (firing + 1 + 100 / 190));
  });

  it('Glycogen Funnel: no stamina cost, x0.7 damage', () => {
    const b = run(caustic(), { mutations: { 'glycogen-funnel': 1, 'starvation-reflex': 1 }, params: {} });
    expect(dps(b, 'core.e0')).toBeCloseTo(0.7 * BASE);
  });

  it('plasmids add damage, and Virulent Adaptation per boss', () => {
    const b = run(caustic(), {
      plasmids: { 'nanobot-damagelowerhpplasmid2': 1, 'nanobot-damageprogressionplasmid': 1 },
      params: { staminaLimits: 0, bossesBeaten: 3 },
    });
    expect(dps(b, 'core.e0')).toBeCloseTo(1.3 * BASE);
  });

  it('summarises what each pick does and warns about unknown ones', () => {
    const r = calculate(run(caustic(), { mutations: { 'corrosive-acid': 1, 'cilium-growth': 1, nope: 1 } }), gameData);
    expect(r.run).toContainEqual({ source: 'Corrosive Acid', text: '+10% damage', inactive: false });
    expect(r.run.find((l) => l.source === 'Cilium Growth')?.inactive).toBe(true);
    expect(r.warnings).toContain('Unknown mutation "nope"');
  });
});

describe('evolving classes', () => {
  function evolving(classId: string, slots: Record<string, SlotState>, extra: Partial<Build> = {}): Build {
    return {
      version: 2,
      name: 'test',
      classId,
      pieces: [],
      evolutions: [],
      slots,
      mutations: {},
      plasmids: {},
      params: { staminaLimits: 0 },
      targets: 1,
      custom: [],
      ...extra,
    };
  }
  const caustic = org('caustic-secretor');

  it('copies an organelle in a mirrored slot to its twin on the other side', () => {
    const r = calculate(evolving('bacterium', { ESlot2: caustic }), gameData);
    expect(r.warnings).toEqual([]);
    expect(r.weapons.map((w) => w.slotId).sort()).toEqual(['ESlot2', 'ESlot2Mirror']);
    expect(r.totalDps).toBeCloseTo(2 * BASE);
  });

  it('keeps grafts per slot, even on mirrored twins', () => {
    const b = evolving('bacterium', { ESlot2: caustic, ESlot2Mirror: { graft: 'volatile' } });
    expect(dps(b, 'ESlot2')).toBeCloseTo(BASE);
    expect(dps(b, 'ESlot2Mirror')).toBeCloseTo(1.4 * BASE);
  });

  it('adds evolution damage bonuses, which carry over to later evolutions', () => {
    // Bacillus Transversus: +15% damage
    const b = evolving('bacterium', { ESlot1: caustic }, { evolutions: ['bacterium-bacillus-transversus'] });
    expect(dps(b, 'ESlot1')).toBeCloseTo(1.15 * BASE);
    b.evolutions = ['bacterium-bacillus-transversus', '', 'bacterium-clostridium'];
    expect(dps(b, 'ESlot1')).toBeCloseTo(1.15 * BASE);
    b.evolutions = ['bacterium-coccus'];
    expect(dps(b, 'ESlot1')).toBeCloseTo(BASE);
  });

  it('ignores evolutions picked for the wrong tier', () => {
    const b = evolving('bacterium', { ESlot1: caustic }, { evolutions: ['bacterium-clostridium'] });
    expect(calculate(b, gameData).body.plan?.id).toBe('bacterium-start');
  });

  it('uses slots built into the body: Omni takes any organelle, Volatile adds damage', () => {
    // Fungal Spore: TSlot1 is an internal Omni slot, so a weapon fits.
    const omni = calculate(evolving('fungal-spore', { TSlot1: caustic }), gameData);
    expect(omni.warnings).toEqual([]);
    expect(omni.totalDps).toBeCloseTo(BASE);
    // Ascomycota: ESlot1 is a Volatile slot.
    expect(dps(evolving('fungal-spore', { ESlot1: caustic }, { evolutions: ['fungal-spore-ascomycota'] }), 'ESlot1')).toBeCloseTo(1.4 * BASE);
  });

  it('measures body halves from the body centre (Dorsal Dominance, Chirality)', () => {
    // Dorsal Dominance: weapons on the bottom half +70%
    const back = evolving('bacterium', { EBackSlot1: caustic, ESlot1: org('caustic-secretor') }, { plasmids: { 'bacterium-bottomdamageplasmid': 1 } });
    expect(dps(back, 'EBackSlot1')).toBeCloseTo(1.7 * BASE);
    expect(dps(back, 'ESlot1')).toBeCloseTo(BASE);
    // Sinistral Chirality: the left twin gains, the right twin loses.
    const sides = evolving('bacterium', { ESlot2: caustic }, { mutations: { 'sinistral-chirality': 1 } });
    expect(dps(sides, 'ESlot2')).toBeCloseTo(2 * BASE);
    expect(dps(sides, 'ESlot2Mirror')).toBeCloseTo(0.5 * BASE);
  });

  it('Sinistral Metabolism really strengthens mitochondria on the right half (the game swaps it with Dextral Conduction)', () => {
    // Lacerator Tendril: 90 damage, 1s cooldown
    const slots = { ESlot5: org('lacerator-tendril'), ESlot7: { ...org('entrant-mitochondrion'), uptime: 1 } };
    const plain = evolving('fungal-spore', slots, { evolutions: ['', '', 'fungal-spore-aspergillus'] });
    expect(dps(plain, 'ESlot5')).toBeCloseTo(90 * rate(1 / 1.3));
    const boosted = { ...plain, plasmids: { 'fungal-spore-leftactivesplasmid': 1 } };
    expect(dps(boosted, 'ESlot5')).toBeCloseTo(90 * rate(1 / (1 + 0.3 * 1.4)));
  });
});
