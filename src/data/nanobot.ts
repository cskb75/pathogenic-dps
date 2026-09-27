// The Nanobot pathogen.
//
// The body is built from square and triangle modules. Each module has an
// internal slot in its centre and an external slot on every free edge.

import type { ClassDef } from '../engine/types';
import { pct } from './helpers';

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
      description: 'Organelles on triangle modules deal +40% damage.',
      maxStacks: 1,
      grants: [{ scope: 'global', to: { pieceTypes: ['triangle'], tags: ['attack'] }, modifiers: [pct('damage', 0.4)] }],
      placeholder: true,
    },
  ],
  passives: [],
};
