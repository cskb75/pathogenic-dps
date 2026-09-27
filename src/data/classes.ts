// The pathogens (playable classes).
//
// Bacterium, Fungal Spore and Helminth are in the free demo: their body plans
// (slots, connections, built-in special slots, evolutions) are extracted from
// its scenes by tools/extract/bodies.py into bodies.json. The full release has
// more evolutions (a third tier) than the demo. The Nanobot isn't in the demo:
// its modules come from player descriptions. The Diatom's starting body is
// transcribed from a wiki screenshot (see diatom.ts). Amoeba and Lil Collector
// need the full game's files.

import type { ClassDef } from '../engine/types';
import { plasmids } from './plasmids';

export const bacterium: ClassDef = {
  id: 'bacterium',
  name: 'Bacterium',
  tagline: 'Standard disease cell with bilateral symmetry',
  description:
    'The pathogen every player starts with. Its body is symmetric: an organelle in a side slot is copied to the matching slot on the other side.',
  hp: 6,
  portrait: 'art/bodies/bacterium-start.webp',
  source: 'Body plans from the demo build',
  body: { kind: 'evolving', start: 'bacterium-start', tiers: [] },
  plasmids: plasmids.bacterium,
};

export const fungalSpore: ClassDef = {
  id: 'fungal-spore',
  name: 'Fungal Spore',
  tagline: 'Has special organelle slots. Cannot rotate',
  description:
    'Unlocked by beating the Stomach boss. Most of its slots are built-in Omni slots, which take internal and external organelles; evolutions add Volatile and Conductive slots.',
  hp: 5,
  portrait: 'art/bodies/fungal-spore-start.webp',
  source: 'Body plans from the demo build',
  body: { kind: 'evolving', start: 'fungal-spore-start', tiers: [] },
  plasmids: plasmids['fungal-spore'],
};

export const diatom: ClassDef = {
  id: 'diatom',
  name: 'Diatom',
  tagline: 'Parasite for 2 player co-op. Each player controls one half',
  description:
    'Available from the start. Two lobes, each with its own stamina bar and four external slots around an internal slot, joined through a middle internal slot. Cannot rotate.',
  hp: 9,
  portrait: 'art/bodies/diatom-start.webp',
  source: 'Starting body transcribed from the wiki; evolutions need the full game',
  body: { kind: 'evolving', start: 'diatom-start', tiers: [] },
  plasmids: plasmids.diatom,
};

export const helminth: ClassDef = {
  id: 'helminth',
  name: 'Helminth',
  tagline: 'Its chitinous tail blocks attacks. Cannot strafe',
  description: 'Unlocked by beating the Intestine boss. A long worm whose side slots are mirrored, like the Bacterium.',
  hp: 8,
  portrait: 'art/bodies/helminth-start.webp',
  source: 'Body plans from the demo build',
  body: { kind: 'evolving', start: 'helminth-start', tiers: [] },
  plasmids: plasmids.helminth,
};
