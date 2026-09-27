// Game data: rarities, traits, grafts, fight assumptions and classes.
// Organelle behaviour (the numbers) lives in src/engine/sim/behaviours.ts.

import type { GameData } from '../engine/types';
import { nanobot } from './nanobot';
import { organelles } from './organelles';

export const gameData: GameData = {
  dataSource: 'Demo build (Jan 2026) + official patch notes to Aug 2026',
  rarities: [
    { id: 'common', name: 'Common', color: '#9ca3af' },
    { id: 'rare', name: 'Rare', color: '#3b82f6' },
    { id: 'epic', name: 'Epic', color: '#a855f7' },
    { id: 'legendary', name: 'Legendary', color: '#f59e0b' },
    { id: 'mythic', name: 'Mythic', color: '#ef4444' },
  ],
  organelles,
  traits: [
    { id: 'cancerous', name: 'Cancerous', description: '+1 stat boost; spreads through its slot type.', tiers: 1 },
    { id: 'eternal', name: 'Eternal', description: '+2 stat boost; cannot be removed from its slot.', tiers: 2 },
    { id: 'ephemeral', name: 'Ephemeral', description: '+3 stat boost; destroys itself after 10 rooms.', tiers: 3 },
    { id: 'excitable', name: 'Excitable', description: '+3 stat boost; only works while Overcharged.', tiers: 3, requiresCharge: true },
  ],
  grafts: [
    { id: 'volatile', name: 'Volatile', description: '+40% of base damage for attacks from the organelle in this slot.' },
    { id: 'conductive', name: 'Conductive', description: 'Overcharge effects are 40% stronger in this slot.' },
    { id: 'omni', name: 'Omni', description: 'Accepts internal and external organelles.' },
  ],
  params: [
    { id: 'angledHit', name: 'Angled shots on target', description: 'How often split or side shots (Bifurcator, Triosome) still hit your target. Homing (Attractor) makes them always hit.', default: 0.5, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'pelletHit', name: 'Shotgun pellets on target', description: 'Share of Scatter/Cluster Ejector pellets that hit.', default: 0.7, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'sideHit', name: 'Sideways shots on target', description: 'Share of Lateral Vent shots that hit.', default: 0.3, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'mineHit', name: 'Mines triggered', description: 'Share of Cyst Depositor mines an enemy walks into.', default: 0.5, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'orbContact', name: 'Orb contact time (s)', description: 'Seconds a Mucus Emitter orb spends touching the target (it lasts 5s).', default: 1.5, min: 0, max: 5, step: 0.1 },
    { id: 'targetDistance', name: 'Distance to target (px)', description: 'How far projectiles travel before hitting (Chronosome). The screen is about 2000px wide.', default: 800, min: 0, max: 3000, step: 50 },
    { id: 'backstabChance', name: 'Backstab chance', description: 'Share of hits from behind (Dorsal Lysosome).', default: 0.25, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'beatSync', name: 'Beat sync', description: 'How well you attack on the beat (Sinoatrial Node). 0% is random timing.', default: 0, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'resonantStacks', name: 'Resonant stacks', description: 'How close to max stacks Resonant Cavity stays.', default: 1, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'phagosomeKills', name: 'Phagosome kills', description: 'Kills credited to Phagosome so far this run.', default: 0, min: 0, max: 1000, step: 10 },
    { id: 'roomLength', name: 'Room length (s)', description: 'Typical fight length, for Entrant and Pristine Mitochondria.', default: 30, min: 5, max: 180, step: 5 },
    { id: 'killRate', name: 'Kills per second', description: 'For Berserk Mitochondrion.', default: 0.3, min: 0, max: 5, step: 0.05 },
    { id: 'hitsTakenRate', name: 'Hits taken per second', description: 'For Vengeful Mitochondrion.', default: 0.05, min: 0, max: 2, step: 0.01 },
    { id: 'dodgeRate', name: 'Dodges through shots per second', description: 'For Elusive Mitochondrion.', default: 0.15, min: 0, max: 2, step: 0.05 },
    { id: 'pickupRate', name: 'Pickups per second', description: 'For Metabolic Mitochondrion.', default: 0.1, min: 0, max: 2, step: 0.05 },
    { id: 'perfectRooms', name: 'Rooms without losing HP', description: 'For Pristine Mitochondrion.', default: 0.5, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'level', name: 'Level', description: 'Explosions scale up by 75% per level to keep pace with enemy health.', default: 1, min: 1, max: 10, step: 1 },
    { id: 'staminaLimits', name: 'Stamina limits (1 = on)', description: 'Firing drains stamina with no regen; when it runs out you pause ~1.5s to refill.', default: 1, min: 0, max: 1, step: 1 },
    { id: 'maxStamina', name: 'Max stamina', description: 'Base 100; plasmids and mutations can raise it.', default: 100, min: 10, max: 500, step: 10 },
  ],
  classes: [nanobot],
};
