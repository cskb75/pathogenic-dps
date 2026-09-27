import { describe, expect, it } from 'vitest';
import { flat, mul, pct } from '../data/helpers';
import { calculate } from './calc';
import type { Build, GameData, OrganelleDef, SlotState } from './types';

// Engine tests use their own small data set so they don't depend on the
// placeholder numbers in src/data.
const organelles: OrganelleDef[] = [
  {
    id: 'gun',
    name: 'Gun',
    slot: 'external',
    category: 'weapon',
    description: '',
    attack: { tags: ['projectile'], damage: [100, 200], attackSpeed: 1 },
    overcharge: { description: '', modifiers: [mul('damage', 1.65)] },
  },
  { id: 'beam', name: 'Beam', slot: 'external', category: 'weapon', description: '', attack: { tags: ['beam'], damage: 10, attackSpeed: 10 } },
  {
    id: 'blade',
    name: 'Blade',
    slot: 'external',
    category: 'weapon',
    description: '',
    attack: { tags: ['melee'], damage: 100, attackSpeed: 1, critChance: 0.1 },
    overcharge: { description: '', modifiers: [flat('critChance', 0.1, { perCharge: true })] },
  },
  {
    id: 'extruder',
    name: 'Extruder',
    slot: 'external',
    category: 'weapon',
    description: '',
    attack: { tags: ['projectile'], damage: 10, attackSpeed: 10 },
    requiresOvercharge: true,
  },
  {
    id: 'torch',
    name: 'Torch',
    slot: 'external',
    category: 'weapon',
    description: '',
    attack: { tags: ['projectile'], damage: 10, attackSpeed: 2, onHit: [{ status: 'burn', chance: 1 }] },
  },
  {
    id: 'infuser',
    name: 'Infuser',
    slot: 'internal',
    category: 'infuser',
    description: '',
    grants: [{ scope: 'connected', to: { tags: ['attack'] }, modifiers: [pct('damage', 0.25)] }],
  },
  {
    id: 'proj-infuser',
    name: 'Projectile Infuser',
    slot: 'internal',
    category: 'infuser',
    description: '',
    grants: [{ scope: 'connected', to: { tags: ['projectile'] }, modifiers: [pct('damage', 0.5), flat('forks', 1)] }],
  },
  {
    id: 'hot-infuser',
    name: 'Hot Infuser',
    slot: 'internal',
    category: 'infuser',
    description: '',
    grants: [{ scope: 'connected', to: { tags: ['attack'] }, modifiers: [pct('damage', 0.2, { when: 'burning' })] }],
  },
  {
    id: 'amp',
    name: 'Amp',
    slot: 'internal',
    category: 'support',
    description: '',
    grants: [{ scope: 'connected', to: { categories: ['infuser'] }, modifiers: [pct('potency', 0.3)] }],
  },
  {
    id: 'capacitor',
    name: 'Capacitor',
    slot: 'internal',
    category: 'support',
    description: '',
    grants: [{ scope: 'global', to: { tags: ['attack'] }, modifiers: [pct('damage', 0.04, { per: { param: 'armor' } })] }],
  },
  {
    id: 'mito',
    name: 'Mito',
    slot: 'internal',
    category: 'mitochondrion',
    description: '',
    mitochondrion: { trigger: 'test', defaultUptime: 0.5, charges: 1 },
  },
];

const data: GameData = {
  gameVersion: 'test',
  rarities: [],
  organelles,
  traits: [
    { id: 'excitable', name: 'Excitable', description: '', attackModifiers: [pct('damage', 0.5)], otherModifiers: [], requiresOvercharge: true },
  ],
  grafts: [
    { id: 'volatile', name: 'Volatile', description: '', modifiers: [pct('damage', 0.4)] },
    { id: 'conductive', name: 'Conductive', description: '', modifiers: [pct('overchargeStrength', 0.4)] },
    { id: 'omni', name: 'Omni', description: '', accepts: ['internal', 'external'], modifiers: [] },
  ],
  statuses: [{ id: 'burn', name: 'Burn', description: '', dpsFlat: 5, dpsFromHit: 0.5, duration: 2, maxStacks: 1 }],
  conditions: [{ id: 'burning', name: 'Burning', description: '' }],
  params: [{ id: 'armor', name: 'Armor', description: '', default: 5, min: 0, max: 10, step: 1 }],
  classes: [
    {
      id: 'nano',
      name: 'Nano',
      description: '',
      corePiece: 'core',
      pieceTypes: [
        { id: 'core', name: 'Core', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: false },
        { id: 'square', name: 'Square', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: true },
        { id: 'triangle', name: 'Triangle', sides: 3, centerSlot: 'internal', edgeSlot: 'external', addable: true },
      ],
      upgrades: [
        {
          id: 'tri',
          name: 'Triangle damage',
          description: '',
          maxStacks: 1,
          grants: [{ scope: 'global', to: { pieceTypes: ['triangle'], tags: ['attack'] }, modifiers: [pct('damage', 0.4)] }],
        },
      ],
      passives: [],
    },
  ],
  constants: { baseCritMultiplier: 2 },
};

const org = (id: string, rarity: 'common' | 'rare' = 'common', traits: string[] = []): SlotState => ({
  organelle: { id, rarity, traits },
});

// Layout used below: core square, plus square "s" on the core's right edge
// (core edge 1). Core edges: 0 top, 1 right, 2 bottom, 3 left. Edge 0 of an
// attached piece is always the shared edge, so s.e1..s.e3 are free.
function build(slots: Record<string, SlotState>, extra: Partial<Build> = {}): Build {
  return {
    version: 1,
    name: 'test',
    classId: 'nano',
    pieces: [
      { id: 'core', type: 'core' },
      { id: 's', type: 'square', attach: { to: 'core', edge: 1 } },
    ],
    slots,
    upgrades: {},
    conditions: {},
    params: {},
    targets: 1,
    custom: [],
    ...extra,
  };
}

const dpsOf = (b: Build, slot: string) => calculate(b, data).items.get(slot)!.attack!.dps;

describe('damage pipeline', () => {
  it('uses the rarity-specific base damage', () => {
    expect(dpsOf(build({ 'core.e0': org('gun') }), 'core.e0')).toBeCloseTo(100);
    expect(dpsOf(build({ 'core.e0': org('gun', 'rare') }), 'core.e0')).toBeCloseTo(200);
  });

  it('matches the 100 -> 125 -> 206 infuser + overcharge example', () => {
    const b = build({ 'core.e0': org('gun'), 'core.c': org('infuser') });
    expect(dpsOf(b, 'core.e0')).toBeCloseTo(125);
    // Mitochondrion on the neighbouring centre can't reach the gun on the core's edge...
    const withMito = build({ 'core.e0': org('gun'), 'core.c': org('infuser'), 's.c': org('mito', 'common'), 's.e1': org('gun') });
    withMito.slots['s.c'].uptime = 1;
    const r = calculate(withMito, data);
    expect(r.items.get('core.e0')!.attack!.dps).toBeCloseTo(125);
    // ...but it does reach the gun on its own edge: 100 x 1.65
    expect(r.items.get('s.e1')!.attack!.dps).toBeCloseTo(165);
  });

  it('multiplies overcharge on top of percent bonuses', () => {
    // An edge weapon touches only one centre slot, so a global +25% stands in
    // for the infuser here.
    const b = build({ 's.e1': org('gun'), 's.c': org('mito') });
    b.slots['s.c'].uptime = 1;
    b.custom = [{ id: 'x', label: 'Infuser-like', target: 'attacks', stat: 'damage', op: 'percent', value: 0.25 }];
    expect(dpsOf(b, 's.e1')).toBeCloseTo(206.25);
  });

  it('adds percents together and multiplies multipliers', () => {
    const b = build({ 'core.e0': { ...org('gun'), graft: 'volatile' }, 'core.c': org('infuser') });
    // (1 + 0.25 + 0.4) = 1.65
    expect(dpsOf(b, 'core.e0')).toBeCloseTo(165);
  });
});

describe('connections', () => {
  it('only lets an infuser reach organelles directly connected to it', () => {
    // Infuser in the core centre; gun on s's edge connects to s.c only.
    const b = build({ 'core.c': org('infuser'), 's.e1': org('gun') });
    expect(dpsOf(b, 's.e1')).toBeCloseTo(100);
  });

  it('lets a support boost a connected infuser, which then boosts its weapon', () => {
    // amp (core.c) -> infuser (s.c) -> gun (s.e1)
    const b = build({ 'core.c': org('amp'), 's.c': org('infuser'), 's.e1': org('gun') });
    const r = calculate(b, data);
    expect(r.items.get('s.c')!.potency!.average).toBeCloseTo(1.3);
    expect(r.items.get('s.e1')!.attack!.dps).toBeCloseTo(100 * (1 + 0.25 * 1.3));
    expect(r.interactions).toEqual(
      expect.arrayContaining([
        { from: 'core.c', to: 's.c', kind: 'grant' },
        { from: 's.c', to: 's.e1', kind: 'grant' },
      ]),
    );
    // amp's +potency does nothing for the gun directly (it only targets infusers)
    expect(r.interactions).not.toContainEqual({ from: 'core.c', to: 's.e1', kind: 'grant' });
  });

  it('respects projectile-only infusers', () => {
    const b = build({ 'core.c': org('proj-infuser'), 'core.e0': org('gun'), 'core.e2': org('beam') });
    const r = calculate(b, data);
    expect(r.items.get('core.e0')!.attack!.dps).toBeCloseTo(150);
    expect(r.items.get('core.e2')!.attack!.dps).toBeCloseTo(100);
  });

  it('rejects an organelle in the wrong kind of slot unless the slot is Omni', () => {
    const wrong = calculate(build({ 'core.c': org('gun') }), data);
    expect(wrong.items.size).toBe(0);
    expect(wrong.warnings[0]).toMatch(/only accepts internal/);
    const omni = calculate(build({ 'core.c': { ...org('gun'), graft: 'omni' } }), data);
    expect(omni.totalDps).toBeCloseTo(100);
  });
});

describe('overcharge', () => {
  it('averages DPS over mitochondrion uptime', () => {
    const b = build({ 's.c': org('mito'), 's.e1': org('gun') }); // default uptime 0.5
    expect(dpsOf(b, 's.e1')).toBeCloseTo(0.5 * 165 + 0.5 * 100);
  });

  it('scales overcharge effects with Overcharge Strength', () => {
    const b = build({ 's.c': org('mito'), 's.e1': { ...org('gun'), graft: 'conductive' } });
    b.slots['s.c'].uptime = 1;
    // x1.65 becomes x(1 + 0.65 * 1.4)
    expect(dpsOf(b, 's.e1')).toBeCloseTo(100 * (1 + 0.65 * 1.4));
  });

  it('combines several mitochondria into uptime and average charges', () => {
    const one = calculate(build({ 'core.c': org('mito'), 's.c': org('amp') }), data).items.get('s.c')!.overcharge;
    expect(one.uptime).toBeCloseTo(0.5);
    expect(one.charges).toBeCloseTo(1);

    // Squares on the core's right and bottom edges: the core centre touches both.
    const ring = build(
      { 'r.c': org('mito'), 'd.c': org('mito'), 'core.c': org('amp') },
      {
        pieces: [
          { id: 'core', type: 'core' },
          { id: 'r', type: 'square', attach: { to: 'core', edge: 1 } },
          { id: 'd', type: 'square', attach: { to: 'core', edge: 2 } },
        ],
      },
    );
    // Two independent 50% triggers: up 75% of the time, 1 charge expected
    // overall, so 1/0.75 charges on average while up.
    const two = calculate(ring, data).items.get('core.c')!.overcharge;
    expect(two.uptime).toBeCloseTo(0.75);
    expect(two.charges).toBeCloseTo(1 / 0.75);
  });

  it('gives per-charge bonuses for each charge held', () => {
    const b = build({ 's.c': { ...org('mito'), uptime: 1 }, 's.e1': org('blade') });
    // 10% base + 10% per charge (1 charge) = 20% crit, x2 crit damage => x1.2
    expect(dpsOf(b, 's.e1')).toBeCloseTo(120);
  });

  it('gives zero DPS to organelles that need Overcharge when none is connected', () => {
    const r = calculate(build({ 'core.e0': org('extruder') }), data);
    expect(r.items.get('core.e0')!.attack!.dps).toBe(0);
    expect(r.items.get('core.e0')!.notes[0]).toMatch(/Needs Overcharge/);
  });

  it('runs Overcharge-only organelles for the uptime share of the fight', () => {
    const b = build({ 's.c': org('mito'), 's.e1': org('extruder') });
    expect(dpsOf(b, 's.e1')).toBeCloseTo(0.5 * 100);
  });

  it('treats the Excitable trait as needing Overcharge', () => {
    const b = build({ 's.c': org('mito'), 's.e1': org('gun', 'common', ['excitable']) });
    // Only charged half the time: 100 x 1.5 (trait) x 1.65 (overcharge)
    expect(dpsOf(b, 's.e1')).toBeCloseTo(0.5 * 100 * 1.5 * 1.65);
  });
});

describe('global effects, conditions and parameters', () => {
  it('applies class upgrades to organelles on matching pieces only', () => {
    const b = build(
      { 't.e1': org('gun'), 'core.e0': org('gun') },
      {
        pieces: [
          { id: 'core', type: 'core' },
          { id: 't', type: 'triangle', attach: { to: 'core', edge: 1 } },
        ],
        upgrades: { tri: 1 },
      },
    );
    const r = calculate(b, data);
    expect(r.items.get('t.e1')!.attack!.dps).toBeCloseTo(140);
    expect(r.items.get('core.e0')!.attack!.dps).toBeCloseTo(100);
  });

  it('scales per-parameter bonuses with the build parameter', () => {
    const b = build({ 'core.c': org('capacitor'), 's.e1': org('gun') });
    expect(dpsOf(b, 's.e1')).toBeCloseTo(120); // default armor 5 -> +20%
    b.params = { armor: 10 };
    expect(dpsOf(b, 's.e1')).toBeCloseTo(140);
  });

  it('only applies conditional bonuses while the condition is on', () => {
    const b = build({ 'core.c': org('hot-infuser'), 'core.e0': org('gun') });
    expect(dpsOf(b, 'core.e0')).toBeCloseTo(100);
    b.conditions = { burning: true };
    expect(dpsOf(b, 'core.e0')).toBeCloseTo(120);
  });
});

describe('crits, statuses and multiple targets', () => {
  it('averages crits into hit damage', () => {
    expect(dpsOf(build({ 'core.e0': org('blade') }), 'core.e0')).toBeCloseTo(110);
  });

  it('adds burn damage over time from on-hit statuses', () => {
    const r = calculate(build({ 'core.e0': org('torch') }), data).items.get('core.e0')!.attack!;
    const burn = r.normal!.statuses[0];
    // 2 applications/s x 2 s duration >= 1: always up. (5 + 0.5 x 10) per second.
    expect(burn.stacks).toBeCloseTo(1);
    expect(burn.dps).toBeCloseTo(10);
    expect(r.dps).toBeCloseTo(20 + 10);
  });

  it('counts pierce and forks against several targets', () => {
    const b = build({ 'core.c': org('proj-infuser'), 'core.e0': org('gun') }, { targets: 3 });
    const r = calculate(b, data);
    const gun = r.items.get('core.e0')!.attack!;
    expect(gun.normal!.targetsHit).toBe(2); // 1 + 1 fork
    expect(gun.multiTargetDps).toBeCloseTo(300);
    expect(r.totalMultiTargetDps).toBeCloseTo(300);
  });

  it('leaves excluded organelles out of the total', () => {
    const b = build({ 'core.e0': org('gun'), 'core.e2': { ...org('gun'), excluded: true } });
    expect(calculate(b, data).totalDps).toBeCloseTo(100);
  });
});
