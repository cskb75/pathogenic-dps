// Organelles.
//
// PLACEHOLDER DATA. Names marked "Sample" are made up to exercise the engine.
// The others are real organelles, but every number here is a guess until it
// is checked against the in-game tooltips. Set `placeholder: false` once an
// entry has been verified.
//
// Per-rarity lists are ordered Common, Rare, Epic, Legendary, Mythic.

import type { OrganelleDef } from '../engine/types';
import { ATTACKS, INFUSERS, PROJECTILES, WEAPONS, flat, mul, pct } from './helpers';

export const organelles: OrganelleDef[] = [
  // --- External: weapons -----------------------------------------------------
  {
    id: 'caustic-secretor',
    name: 'Caustic Secretor',
    slot: 'external',
    category: 'weapon',
    description: 'Basic gun that shoots acidic bullets.',
    attack: { tags: ['projectile'], damage: [10, 13, 17, 22, 30], attackSpeed: 3 },
    overcharge: { description: 'x1.5 attack speed while Overcharged.', modifiers: [mul('attackSpeed', 1.5)] },
    placeholder: true,
  },
  {
    id: 'oxidator',
    name: 'Oxidator',
    slot: 'external',
    category: 'weapon',
    description: 'Flamethrower-like stream of burning acid at short range. Burn on hit is doubled at Epic and above.',
    attack: {
      tags: ['projectile'],
      damage: [3, 4, 5, 6, 8],
      attackSpeed: 10,
      pierce: 2,
      onHit: [{ status: 'burn', chance: 1, potency: [1, 1, 2, 2, 2] }],
    },
    overcharge: { description: '+50% damage while Overcharged.', modifiers: [pct('damage', 0.5)] },
    placeholder: true,
  },
  {
    id: 'thermal-lance',
    name: 'Thermal Lance',
    slot: 'external',
    category: 'weapon',
    description: 'Continuous beam.',
    attack: { tags: ['beam'], damage: [6, 8, 10, 13, 18], attackSpeed: 8, pierce: 3 },
    overcharge: { description: 'x1.65 damage while Overcharged.', modifiers: [mul('damage', 1.65)] },
    placeholder: true,
  },
  {
    id: 'katanosome',
    name: 'Katanosome',
    slot: 'external',
    category: 'weapon',
    description: 'Melee slashes. 10% base crit chance.',
    attack: { tags: ['melee'], damage: [25, 32, 42, 55, 75], attackSpeed: 1.2, critChance: 0.1 },
    overcharge: {
      description: '+10% crit chance per Overcharge charge.',
      modifiers: [flat('critChance', 0.1, { perCharge: true })],
    },
    placeholder: true,
  },
  {
    id: 'rotary-extruder',
    name: 'Rotary Extruder',
    slot: 'external',
    category: 'weapon',
    description: 'Rapid-fire projectiles. Only works while Overcharged.',
    attack: { tags: ['projectile'], damage: [6, 8, 10, 13, 18], attackSpeed: 12 },
    requiresOvercharge: true,
    overcharge: { description: 'Fires while Overcharged.', modifiers: [] },
    placeholder: true,
  },

  // --- External: flagella ----------------------------------------------------
  {
    id: 'pyroflagellum',
    name: 'Pyroflagellum',
    slot: 'external',
    category: 'flagellum',
    description: 'Leaves a burning trail when you dodge. Uses the "Dodges per second" parameter.',
    attack: {
      tags: ['trail', 'area'],
      damage: [5, 7, 9, 12, 16],
      attackSpeed: 0,
      area: true,
      onHit: [{ status: 'burn', chance: 1 }],
    },
    modifiers: [flat('attackSpeed', 1, { per: { param: 'dodgeRate' } })],
    placeholder: true,
  },

  // --- Internal: infusers ----------------------------------------------------
  {
    id: 'sample-attack-infuser',
    name: 'Sample Attack Infuser',
    slot: 'internal',
    category: 'infuser',
    description: 'Attack infuser: +25% damage to attacks from connected organelles.',
    grants: [{ scope: 'connected', to: ATTACKS, modifiers: [pct('damage', [0.25, 0.3, 0.35, 0.45, 0.6])] }],
    overcharge: { description: 'x1.5 potency while Overcharged.', modifiers: [mul('potency', 1.5)] },
    placeholder: true,
  },
  {
    id: 'sample-fork-infuser',
    name: 'Sample Fork Infuser',
    slot: 'internal',
    category: 'infuser',
    description: 'Projectile infuser: projectiles from connected organelles fork to 1 extra enemy.',
    grants: [{ scope: 'connected', to: PROJECTILES, modifiers: [flat('forks', [1, 1, 2, 2, 3])] }],
    placeholder: true,
  },
  {
    id: 'sample-rapid-infuser',
    name: 'Sample Rapid Infuser',
    slot: 'internal',
    category: 'infuser',
    description: 'Weapon infuser: +20% attack speed for connected weapons.',
    grants: [{ scope: 'connected', to: WEAPONS, modifiers: [pct('attackSpeed', [0.2, 0.25, 0.3, 0.4, 0.5])] }],
    placeholder: true,
  },
  {
    id: 'sample-burn-infuser',
    name: 'Sample Burn Infuser',
    slot: 'internal',
    category: 'infuser',
    description: 'Attack infuser: 30% chance to Burn. +20% damage against burning targets.',
    grants: [
      {
        scope: 'connected',
        to: ATTACKS,
        onHit: [{ status: 'burn', chance: [0.3, 0.35, 0.4, 0.5, 0.6] }],
        modifiers: [pct('damage', 0.2, { when: 'targetBurning' })],
      },
    ],
    placeholder: true,
  },
  {
    id: 'resonant-cavity',
    name: 'Resonant Cavity',
    slot: 'internal',
    category: 'infuser',
    description: 'Connected weapons gain +3% attack speed per consecutive hit (decays on miss). Uses the "Consecutive hits" parameter.',
    grants: [
      {
        scope: 'connected',
        to: WEAPONS,
        modifiers: [pct('attackSpeed', [0.03, 0.03, 0.04, 0.05, 0.06], { per: { param: 'resonantHits' } })],
      },
    ],
    placeholder: true,
  },
  {
    id: 'sample-amplifier',
    name: 'Sample Infuser Amplifier',
    slot: 'internal',
    category: 'support',
    description: 'Connected infusers are 30% stronger.',
    grants: [{ scope: 'connected', to: INFUSERS, modifiers: [pct('potency', [0.3, 0.35, 0.4, 0.5, 0.65])] }],
    placeholder: true,
  },
  {
    id: 'sample-armor-capacitor',
    name: 'Sample Armor Capacitor',
    slot: 'internal',
    category: 'support',
    description: 'All attacks deal +4% damage per point of Armor. Uses the "Armor" parameter.',
    grants: [{ scope: 'global', to: ATTACKS, modifiers: [pct('damage', [0.04, 0.05, 0.06, 0.08, 0.1], { per: { param: 'armor' } })] }],
    placeholder: true,
  },

  // --- Internal: mitochondria ------------------------------------------------
  {
    id: 'sample-mito-stationary',
    name: 'Sample Mitochondrion (Stationary)',
    slot: 'internal',
    category: 'mitochondrion',
    description: 'Overcharges connected organelles while you stand still.',
    mitochondrion: { trigger: 'Standing still', defaultUptime: 0.5, charges: [1, 1, 2, 2, 3] },
    placeholder: true,
  },
  {
    id: 'sample-mito-killstreak',
    name: 'Sample Mitochondrion (Kill streak)',
    slot: 'internal',
    category: 'mitochondrion',
    description: 'Overcharges connected organelles during a kill streak.',
    mitochondrion: { trigger: 'Kill streak', defaultUptime: 0.4, charges: [1, 1, 2, 2, 3] },
    placeholder: true,
  },
  {
    id: 'sample-mito-damaged',
    name: 'Sample Mitochondrion (Damaged)',
    slot: 'internal',
    category: 'mitochondrion',
    description: 'Overcharges connected organelles after you take damage.',
    mitochondrion: { trigger: 'Taking damage', defaultUptime: 0.2, charges: [1, 2, 2, 3, 4] },
    placeholder: true,
  },

  // --- Internal: consumers ---------------------------------------------------
  {
    id: 'ossificator',
    name: 'Ossificator',
    slot: 'internal',
    category: 'consumer',
    description: 'Generates 1 Armor after staying Overcharged for 60 seconds. No direct damage.',
    overcharge: { description: 'Builds toward +1 Armor.', modifiers: [] },
    placeholder: true,
  },
];
