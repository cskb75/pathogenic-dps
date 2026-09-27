// All game data in one place. PLACEHOLDER numbers throughout: see README.md
// for how to verify and fill them in.

import type { GameData } from '../engine/types';
import { pct } from './helpers';
import { nanobot } from './nanobot';
import { organelles } from './organelles';

export const gameData: GameData = {
  gameVersion: 'unverified',
  rarities: [
    { id: 'common', name: 'Common', color: '#9ca3af' },
    { id: 'rare', name: 'Rare', color: '#60a5fa' },
    { id: 'epic', name: 'Epic', color: '#c084fc' },
    { id: 'legendary', name: 'Legendary', color: '#facc15' },
    { id: 'mythic', name: 'Mythic', color: '#f87171' },
  ],
  organelles,
  traits: [
    {
      id: 'cancerous',
      name: 'Cancerous',
      description: 'Small stat boost. Spreads through its slot type, turning other organelles into copies of itself.',
      attackModifiers: [pct('damage', 0.1)],
      otherModifiers: [pct('potency', 0.1)],
      placeholder: true,
    },
    {
      id: 'eternal',
      name: 'Eternal',
      description: 'Moderate stat boost. Locked to its slot; only Autophagy removes it.',
      attackModifiers: [pct('damage', 0.25)],
      otherModifiers: [pct('potency', 0.25)],
      placeholder: true,
    },
    {
      id: 'excitable',
      name: 'Excitable',
      description: 'Large stat boost, but only works while Overcharged.',
      attackModifiers: [pct('damage', 0.5)],
      otherModifiers: [pct('potency', 0.5)],
      requiresOvercharge: true,
      excludes: ['rotary-extruder'],
      placeholder: true,
    },
  ],
  grafts: [
    {
      id: 'volatile',
      name: 'Volatile',
      description: '+40% damage for the organelle in this slot.',
      modifiers: [pct('damage', 0.4)],
    },
    {
      id: 'conductive',
      name: 'Conductive',
      description: 'Overcharge effects are 40% stronger in this slot (mitochondria produce more, others absorb more).',
      modifiers: [pct('overchargeStrength', 0.4)],
    },
    {
      id: 'omni',
      name: 'Omni',
      description: 'Accepts both internal and external organelles.',
      accepts: ['internal', 'external'],
      modifiers: [],
    },
  ],
  statuses: [
    {
      id: 'burn',
      name: 'Burn',
      description: 'Damage over time. Re-applying refreshes the duration.',
      dpsFlat: 2,
      dpsFromHit: 0.25,
      duration: 3,
      maxStacks: 1,
      placeholder: true,
    },
  ],
  conditions: [{ id: 'targetBurning', name: 'Target is burning', description: 'The enemy you are hitting has Burn on it.' }],
  params: [
    { id: 'armor', name: 'Armor', description: 'Armor you are holding during the fight.', default: 4, min: 0, max: 10, step: 1 },
    {
      id: 'resonantHits',
      name: 'Consecutive hits',
      description: 'Average consecutive hits without missing (Resonant Cavity).',
      default: 20,
      min: 0,
      max: 100,
      step: 1,
    },
    { id: 'dodgeRate', name: 'Dodges per second', description: 'How often you dodge during the fight.', default: 0.5, min: 0, max: 3, step: 0.1 },
  ],
  classes: [nanobot],
  constants: { baseCritMultiplier: 2 },
};

