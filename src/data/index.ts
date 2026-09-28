// Game data: rarities, traits, grafts, fight assumptions and classes.
// Organelle behaviour (the numbers) lives in src/engine/sim/behaviours.ts.

import type { BodyPlan, ClassDef, GameData } from '../engine/types';
import { amoeba, amoebaStart } from './amoeba';
import bodyData from './bodies.json';
import { bacterium, diatom, fungalSpore, helminth, lilCollector } from './classes';
import { mutations } from './mutations';
import { nanobot } from './nanobot';
import { organelles } from './organelles';

const bodies: Record<string, BodyPlan> = { ...(bodyData.bodies as unknown as Record<string, BodyPlan>), [amoebaStart.id]: amoebaStart };

/** Evolving classes take their starting body and evolution tiers from the extracted body plans. */
function withEvolutions(cls: ClassDef): ClassDef {
  const extracted = bodyData.classes.find((c) => c.id === cls.id);
  if (cls.body.kind !== 'evolving' || !extracted) return cls;
  return { ...cls, body: { kind: 'evolving', start: extracted.start, tiers: extracted.tiers } };
}

export const gameData: GameData = {
  dataSource: 'Full release game files (September 2026 build)',
  // The game's rarity colours (bodypart.gd, get_rarity_color).
  rarities: [
    { id: 'common', name: 'Common', color: '#ffffff' },
    { id: 'rare', name: 'Rare', color: '#1e90ff' },
    { id: 'epic', name: 'Epic', color: '#a020f0' },
    { id: 'legendary', name: 'Legendary', color: '#ffa500' },
    { id: 'mythic', name: 'Mythic', color: '#db143d' },
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
    { id: 'orbContact', name: 'Orb contact time (s)', description: 'Seconds a Mucus Emitter orb spends touching the target (it lasts 4s).', default: 1.5, min: 0, max: 4, step: 0.1 },
    { id: 'stauroLasers', name: 'Staurolobber lasers on target', description: 'How many of the four Staurolobber lasers pass through your target.', default: 1, min: 0, max: 4, step: 0.5 },
    { id: 'fireballContact', name: 'Fireball contact', description: 'Share of its life a Pyrocyst fireball spends on your target, and the chance its explosion catches it.', default: 0.3, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'targetDistance', name: 'Distance to target (px)', description: 'How far projectiles travel before hitting (Chronosome). The screen is about 2000px wide.', default: 800, min: 0, max: 3000, step: 50 },
    { id: 'backstabChance', name: 'Backstab chance', description: 'Share of hits from behind (Dorsal Lysosome).', default: 0.25, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'beatSync', name: 'Beat sync', description: 'How well you attack on the beat (Sinoatrial Node). 0% is random timing.', default: 0, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'resonantStacks', name: 'Resonant stacks', description: 'How close to max stacks Resonant Cavity stays.', default: 1, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'phagosomeKills', name: 'Phagosome kills', description: 'Kills credited to Phagosome so far this run.', default: 0, min: 0, max: 1000, step: 10 },
    { id: 'recycled', name: 'Organelles recycled', description: 'Organelles recycled while holding Autolytic Oxysome.', default: 0, min: 0, max: 200, step: 1 },
    { id: 'eaten', name: 'Organelles eaten', description: 'Organelles fed to Phagolysosome.', default: 0, min: 0, max: 50, step: 1 },
    { id: 'roomLength', name: 'Room length (s)', description: 'Typical fight length, for Entrant and Pristine Mitochondria.', default: 30, min: 5, max: 180, step: 5 },
    { id: 'killRate', name: 'Kills per second', description: 'For Berserk Mitochondrion.', default: 0.3, min: 0, max: 5, step: 0.05 },
    { id: 'hitsTakenRate', name: 'Hits taken per second', description: 'For Vengeful Mitochondrion.', default: 0.05, min: 0, max: 2, step: 0.01 },
    { id: 'dodgeRate', name: 'Dodges through shots per second', description: 'For Elusive Mitochondrion.', default: 0.15, min: 0, max: 2, step: 0.05 },
    { id: 'dodgeRateAll', name: 'Dodges per second', description: 'How often you dodge at all (Galvanic Flagellum).', default: 0.3, min: 0, max: 3, step: 0.05 },
    { id: 'blockRate', name: 'Shots blocked per second', description: 'Enemy projectiles a Glycocalyx arc blocks.', default: 0.3, min: 0, max: 3, step: 0.05 },
    { id: 'slashRate', name: 'Shots slashed per second', description: 'Enemy projectiles your melee attacks cut (Ablative Mitochondrion).', default: 0.2, min: 0, max: 3, step: 0.05 },
    { id: 'pickupRate', name: 'Pickups per second', description: 'For Metabolic Mitochondrion.', default: 0.1, min: 0, max: 2, step: 0.05 },
    { id: 'minionEngagement', name: 'Minion engagement', description: 'Share of the fight each minion spends attacking: in reach of an enemy and facing it.', default: 0.6, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'minionLifetime', name: 'Minion lifetime (s)', description: 'How long a minion from an active (Sentry, Swarm Nidus) survives; they are gone when the room ends either way.', default: 20, min: 1, max: 180, step: 1 },
    { id: 'nearbyTime', name: 'Enemies next to you', description: 'Share of the fight an enemy is right next to you (Galvanic Sac, Kinetosome).', default: 0.3, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'perfectRooms', name: 'Rooms without losing HP', description: 'For Pristine Mitochondrion.', default: 0.5, min: 0, max: 1, step: 0.05, percent: true },
    { id: 'cores', name: 'Cores held', description: 'Cores you are carrying right now (Argentic Coating).', default: 0, min: 0, max: 9999, step: 1 },
    { id: 'hp', name: 'Current HP', description: "Your HP during the fight (Adrenaline works at 2 or less). Defaults to the pathogen's starting HP.", default: 1, min: 0, max: 20, step: 1 },
    { id: 'bossesBeaten', name: 'Bosses beaten', description: 'Bosses beaten this run (Virulent Adaptation).', default: 0, min: 0, max: 20, step: 1 },
    { id: 'level', name: 'Level', description: 'Explosions scale up by 75% per level to keep pace with enemy health.', default: 1, min: 1, max: 10, step: 1 },
    { id: 'staminaLimits', name: 'Stamina limits (1 = on)', description: 'Firing drains stamina with no regen; when it runs out you pause ~1.5s to refill.', default: 1, min: 0, max: 1, step: 1 },
    { id: 'maxStamina', name: 'Max stamina', description: 'Base 100. Glycogen Reserve adds 100 per stack on top of this.', default: 100, min: 10, max: 500, step: 10 },
  ],
  mutations,
  bodies,
  classes: [bacterium, helminth, fungalSpore, diatom, lilCollector, nanobot, amoeba].map(withEvolutions),
};
