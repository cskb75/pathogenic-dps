// The Amoeba pathogen.
//
// It starts as one big blob with an internal slot in the middle and a
// mirrored pair of external slots in front (player_amoeba.tscn), and grows a
// blob with a new slot for each Ectoplasmic Bulge (external) or Endomembrane
// Folding (internal) it picks. See src/engine/amoeba.ts for the placement
// rules.

import type { BodyPlan, ClassDef } from '../engine/types';
import { plasmids } from './plasmids';

export const amoebaStart: BodyPlan = {
  id: 'amoeba-start',
  name: 'Starting body',
  tier: 0,
  slots: [
    { id: 'ISlot1', kind: 'internal', x: 0, y: 0, r: 0 },
    { id: 'ESlot1', kind: 'external', x: -0.36, y: -0.65, r: -1.976 },
    { id: 'ESlot1Mirror', kind: 'external', x: 0.36, y: -0.65, r: -1.166, mirrorOf: 'ESlot1' },
  ],
  links: [
    ['ESlot1', 'ISlot1'],
    ['ESlot1Mirror', 'ISlot1'],
  ],
  outline: [],
};

export const amoeba: ClassDef = {
  id: 'amoeba',
  name: 'Amoeba',
  tagline: 'Shapeshifting blob. Needs 20% less DNA to level up',
  description:
    'Grows a new blob with an external slot (Ectoplasmic Bulge) or internal slot (Endomembrane Folding) wherever you place it. Blobs off the middle are mirrored. New slots connect to up to 3 nearby slots.',
  hp: 6,
  source: 'Body rules from the game files',
  body: { kind: 'freeform', start: amoebaStart.id },
  plasmids: plasmids.amoeba,
};
