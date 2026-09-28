// Plasmids: each pathogen's plasmid tree, extracted from the game by
// tools/extract/plasmids.py into plasmids.json (node positions, links, text,
// icons and what each node does to damage).

import type { PlasmidDef } from '../engine/types';
import trees from './plasmids.json';

export const plasmids = trees as unknown as Record<string, PlasmidDef[]>;
