// An organelle in your hand in the body editor, like the game's organelle
// editor (scn/ui/editor.gd): pick one up from a slot or from the list, carry
// it to a slot, and drop it. Dropping on an occupied slot swaps them.
//
// A mirrored twin always holds a copy of its source slot's organelle
// (slot.gd, _duplicate_to_mirror), so picking up either copy lifts both, and
// dropping on either twin fills both.

import type { Body, Slot } from '../engine/body';
import type { Build, GameData, OrganelleInstance, SlotKind, SlotState } from '../engine/types';

export interface Held {
  organelle: OrganelleInstance;
  /** Its slot settings (a mitochondrion's uptime, "left out of the total"), carried along. */
  settings: Pick<SlotState, 'uptime' | 'excluded'>;
  /** The slot it was lifted from (a mirrored pair's source), for a swap to send the other organelle to. */
  from?: string;
  /** The build's slots before it was picked up, when that changed them: putting it back restores them. */
  undo?: Build['slots'];
}

/** What the body editor is doing with it: following a held-down pointer, or carried between clicks. */
export interface Carry {
  held: Held;
  mode: 'drag' | 'carry';
}

type Slots = Build['slots'];

/** The slot that stores a slot's organelle: a mirrored twin shows a copy of its source's. */
export const sourceOf = (body: Body, slotId: string) => body.slotById.get(slotId)?.mirrorOf ?? slotId;

/** Whether a slot takes an organelle of this kind: its own kind, or both in an Omni slot (grafted or built in). */
export function accepts(slots: Slots, slot: Slot, kind: SlotKind): boolean {
  const graft = slots[slot.id]?.graft ?? slot.special;
  return graft === 'omni' || slot.kind === kind;
}

const settingsOf = (s?: SlotState): Held['settings'] => ({
  ...(s?.uptime !== undefined ? { uptime: s.uptime } : {}),
  ...(s?.excluded ? { excluded: true } : {}),
});

/** A slot's state with a different organelle (or none), keeping its graft. */
function withOrganelle(slots: Slots, slotId: string, organelle: OrganelleInstance | undefined, settings: Held['settings']): Slots {
  const { graft } = slots[slotId] ?? {};
  const next: SlotState = { ...(graft ? { graft } : {}), ...(organelle ? { organelle, ...settings } : {}) };
  return { ...slots, [slotId]: next };
}

/** Picks up what's in a slot: both copies of a mirrored pair. */
export function lift(build: Build, body: Body, slotId: string): { slots: Slots; held: Held } | null {
  const from = sourceOf(body, slotId);
  const state = build.slots[from];
  if (!state?.organelle) return null;
  return { slots: withOrganelle(build.slots, from, undefined, {}), held: { organelle: state.organelle, settings: settingsOf(state), from, undo: build.slots } };
}

/** A new organelle from the list, in hand: putting it back changes nothing. */
export const fresh = (id: string): Held => ({ organelle: { id, rarity: 'common', traits: [] }, settings: {} });

/** Whether the held organelle can go in a slot. */
export function fits(build: Build, body: Body, data: GameData, held: Held, slotId: string): boolean {
  const slot = body.slotById.get(slotId);
  const kind = data.organelles.find((o) => o.id === held.organelle.id)?.slot;
  return !!slot && !!kind && accepts(build.slots, slot, kind);
}

/**
 * Drops the held organelle in a slot. An empty slot takes it. From an occupied
 * slot, the organelle there moves to where the held one came from if that's
 * free and fits it, or else it's now in your hand, as in the game.
 */
export function drop(build: Build, body: Body, data: GameData, held: Held, slotId: string): { slots: Slots; held: Held | null } | null {
  if (!fits(build, body, data, held, slotId)) return null;
  const target = sourceOf(body, slotId);
  const there = build.slots[target];
  const slots = withOrganelle(build.slots, target, held.organelle, held.settings);
  if (!there?.organelle) return { slots, held: null };
  const displaced: Held = { organelle: there.organelle, settings: settingsOf(there), undo: held.undo ?? build.slots };
  const home = held.from && held.from !== target ? body.slotById.get(held.from) : undefined;
  if (home && !slots[home.id]?.organelle && fits({ ...build, slots }, body, data, displaced, home.id)) {
    return { slots: withOrganelle(slots, home.id, displaced.organelle, displaced.settings), held: null };
  }
  return { slots, held: displaced };
}
