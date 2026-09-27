// The Nanobot pathogen.
//
// Not in the demo build, so these details come from public sources. The body
// is built from square and triangle modules: each has an internal slot in its
// centre and an external slot on every free edge.

import type { ClassDef } from '../engine/types';
import { plasmids } from './plasmids';

export const nanobot: ClassDef = {
  id: 'nanobot',
  name: 'Nanobot',
  tagline: 'Modular machine. 50% of health pickups become armor',
  description:
    'Armored but Frail. Starts at 1 HP and leans on Armor (up to 10) instead of Health. Grows by attaching square and triangle modules.',
  hp: 1,
  source: 'Module layout from player descriptions',
  body: {
    kind: 'modular',
    corePiece: 'core',
    pieceTypes: [
      { id: 'core', name: 'Core', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: false },
      { id: 'square', name: 'Square module', sides: 4, centerSlot: 'internal', edgeSlot: 'external', addable: true },
      { id: 'triangle', name: 'Triangle module', sides: 3, centerSlot: 'internal', edgeSlot: 'external', addable: true },
    ],
  },
  plasmids: plasmids.nanobot,
};
