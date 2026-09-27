// The Nanobot pathogen.
//
// Not in the demo build, so these details come from public sources. The body
// is built from square and triangle modules: each has an internal slot in its
// centre and an external slot on every free edge.

import type { ClassDef } from '../engine/types';

export const nanobot: ClassDef = {
  id: 'nanobot',
  name: 'Nanobot',
  description:
    'Armored but Frail. Starts at 1 HP and leans on Armor (up to 10) instead of Health; 50% of Health pickups become Armor. Grows by attaching square and triangle modules.',
  corePiece: 'core',
  pieceTypes: [
    { id: 'core', name: 'Core', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: false },
    { id: 'square', name: 'Square module', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: true },
    { id: 'triangle', name: 'Triangle module', sides: 3, centerSlot: 'internal', edgeSlot: 'external', addable: true },
  ],
  upgrades: [
    {
      id: 'triangle-damage',
      name: 'Triangle damage',
      description: 'Weapons on triangle modules deal +40% damage (from player guides; not yet confirmed in game files).',
      maxStacks: 1,
      pieceDamage: { pieceTypes: ['triangle'], bonus: 0.4 },
      unverified: true,
    },
  ],
};
