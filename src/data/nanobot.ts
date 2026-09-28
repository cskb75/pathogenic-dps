// The Nanobot pathogen.
//
// Its body is built from square and triangle modules (102.4 game pixels a
// side, from scn/player/player_nanobot): each has an internal slot in its
// centre and an external slot on every free edge. It starts as one square;
// the Square and Triangle Module mutations add more (see src/engine/body.ts
// for how the game wires their slots).

import type { ClassDef } from '../engine/types';
import { plasmids } from './plasmids';

export const nanobot: ClassDef = {
  id: 'nanobot',
  name: 'Nanobot',
  tagline: 'Modular machine. 50% of health pickups become armor',
  description:
    'Starts at 1 HP with 8 armor; half of health pickups become armor. Grows by attaching square and triangle modules (each also gives 1 armor).',
  hp: 1,
  source: 'Module rules from the game files',
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
