// The Nanobot pathogen.
//
// Not in the demo build, so these details come from public sources. The body
// is built from square and triangle modules: each has an internal slot in its
// centre and an external slot on every free edge. Plasmids are the full
// release's Nanobot tree (pathogenic.wiki plasmid database); the tree layout
// itself isn't known yet, so they're picked from a list.

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
  upgrades: [],
  plasmids: [
    { id: 'nanobot-damagelowerhpplasmid2', name: 'Sacrificial Enzyme', description: '+15% damage. -1 max HP.', effects: { damage: 0.15 } },
    { id: 'nanobot-damageprogressionplasmid', name: 'Virulent Adaptation', description: 'Gain +5% damage after beating each boss.', effects: { perBoss: 0.05 }, notes: 'Uses your bosses beaten.' },
    { id: 'nanobot-startingmutationplasmid', name: 'Start with Fast Twitch Fibers', description: 'Start with Fast Twitch Fibers: +15% attack speed.', mutation: 'fast-twitch-fibers' },
    { id: 'nanobot-betterenergyplasmid', name: 'Start with Mitochondrial Augmentation', description: 'Start with Mitochondrial Augmentation: +15% Overcharge strength from mitochondria.', mutation: 'mitochondrial-augmentation' },
    { id: 'nanobot-staminaplasmid', name: 'Start with Glycogen Reserve', description: 'Start with Glycogen Reserve: +1 stamina container.', mutation: 'glycogen-reserve' },
    { id: 'nanobot-rangeplasmid', name: 'Start with Kinetic Extension', description: 'Start with Kinetic Extension: +25% range of projectiles, melee attacks and areas of effect.', mutation: 'kinetic-extension' },
    { id: 'nanobot-dodgecdplasmid', name: 'Start with Enhanced Boosters', description: 'Start with Enhanced Boosters: -30% dodge cooldown.', mutation: 'enhanced-boosters' },
    { id: 'nanobot-nanobotdamageslotplasmid', name: 'Volatile Assembly', description: 'A random external slot on each new triangle module becomes a +40% damage slot.', notes: 'Mark those slots as Volatile in the editor.' },
    { id: 'nanobot-nanobotenergyslotplasmid', name: 'Conductive Assembly', description: 'The internal slot of each new square module has a 33% chance to become a +40% Overcharge strength slot.', notes: 'Mark those slots as Conductive in the editor.' },
    { id: 'nanobot-startingplasmid', name: 'Silent Mutation', description: 'No effect (tree root).' },
    { id: 'nanobot-rerollplasmid', name: 'Somatic Hypermutation', description: '+1 mutation reroll.' },
    { id: 'nanobot-speedplasmid2', name: 'Cilium Growth', description: '+15% base speed.' },
    { id: 'nanobot-speedplasmid', name: 'Cilium Growth (small)', description: '+0.2% base speed.' },
    { id: 'nanobot-betterdropsprogressionplasmid', name: 'Adaptive Pressure', description: 'Gain +5% chance for better reward rarity after beating each boss.' },
    { id: 'nanobot-stashslotplasmid', name: 'Endosomal Cache', description: '+1 stash slot to store organelles.' },
    { id: 'nanobot-startingdnaplasmid', name: 'Primordiate DNA', description: 'Start with +5 DNA.' },
    { id: 'nanobot-bossarmorplasmid', name: 'Apoptotic Carapace', description: 'Spawn 1 armor after beating a boss.' },
    { id: 'nanobot-bossmoneyplasmid2', name: 'Heterotrophic Yield', description: 'Spawn 4 cores after beating a boss.' },
    { id: 'nanobot-loadoutlimitweaponplasmid', name: 'Offensive Capacity', description: "Raises this pathogen's starting weapon loadout limit by 1." },
  ],
};
