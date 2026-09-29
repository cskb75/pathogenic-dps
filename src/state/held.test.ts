import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { bodyFor, slotState } from '../engine/calc';
import type { Build, SlotState } from '../engine/types';
import { drop, fits, fresh, lift } from './held';

const org = (id: string, extra: Partial<SlotState> = {}): SlotState => ({ organelle: { id, rarity: 'rare', traits: [] }, ...extra });

// The Bacterium's starting body: ESlot2 and its mirrored twin ESlot2Mirror,
// the nose ESlot1, and internal ISlot1-3.
function bacterium(slots: Record<string, SlotState>): Build {
  return { version: 2, name: 't', classId: 'bacterium', pieces: [], evolutions: [], slots, mutations: {}, plasmids: {}, params: {}, targets: 1, custom: [] };
}
const body = bodyFor(bacterium({}), gameData);
const holding = (build: Build) => (slots: Build['slots']) => ({ ...build, slots });

describe('carrying organelles', () => {
  it('lifts both copies of a mirrored pair, from either twin', () => {
    const build = bacterium({ ESlot2: org('pulsar-gland'), ESlot2Mirror: { graft: 'volatile' } });
    const up = lift(build, body, 'ESlot2Mirror')!;
    expect(up.held.organelle.id).toBe('pulsar-gland');
    expect(up.held.from).toBe('ESlot2');
    const after = holding(build)(up.slots);
    expect(slotState(after, body, 'ESlot2')?.organelle).toBeUndefined();
    expect(slotState(after, body, 'ESlot2Mirror')?.organelle).toBeUndefined();
    // The twin keeps its own graft.
    expect(after.slots.ESlot2Mirror.graft).toBe('volatile');
    expect(lift(after, body, 'ESlot1')).toBeNull();
  });

  it('drops on either twin, filling both', () => {
    const build = bacterium({});
    const done = drop(build, body, gameData, fresh('pulsar-gland'), 'ESlot2Mirror')!;
    expect(done.held).toBeNull();
    const after = holding(build)(done.slots);
    expect(slotState(after, body, 'ESlot2')?.organelle?.id).toBe('pulsar-gland');
    expect(slotState(after, body, 'ESlot2Mirror')?.organelle?.id).toBe('pulsar-gland');
  });

  it('only fits slots of its kind, or Omni slots', () => {
    const build = bacterium({ ISlot2: { graft: 'omni' } });
    const gland = fresh('pulsar-gland');
    expect(fits(build, body, gameData, gland, 'ISlot1')).toBe(false);
    expect(drop(build, body, gameData, gland, 'ISlot1')).toBeNull();
    expect(fits(build, body, gameData, gland, 'ISlot2')).toBe(true);
    expect(fits(build, body, gameData, gland, 'ESlot1')).toBe(true);
  });

  it('swaps: the organelle already there goes where the held one came from', () => {
    const build = bacterium({ ISlot1: org('oxysome'), ISlot3: org('entrant-mitochondrion', { uptime: 0.5 }) });
    const up = lift(build, body, 'ISlot1')!;
    const done = drop(holding(build)(up.slots), body, gameData, up.held, 'ISlot3')!;
    expect(done.held).toBeNull();
    expect(done.slots.ISlot3.organelle?.id).toBe('oxysome');
    // The mitochondrion keeps its settings.
    expect(done.slots.ISlot1).toEqual(org('entrant-mitochondrion', { uptime: 0.5 }));
  });

  it("puts the other organelle in your hand when it can't go back, as in the game", () => {
    const build = bacterium({ ESlot1: org('pulsar-gland'), ISlot1: org('oxysome') });
    // From the list: nowhere to send the Oxysome, so you now hold it.
    const fromList = drop(build, body, gameData, fresh('pyrosome'), 'ISlot1')!;
    expect(fromList.slots.ISlot1.organelle?.id).toBe('pyrosome');
    expect(fromList.held?.organelle.id).toBe('oxysome');
    // Putting it back restores the build from before the pick-up.
    expect(fromList.held?.undo).toBe(build.slots);
    // An external organelle's old slot can't take an internal one.
    const up = lift(build, body, 'ESlot1')!;
    const omni = { ...holding(build)(up.slots), slots: { ...up.slots, ISlot1: { ...up.slots.ISlot1, graft: 'omni' } } };
    const swapped = drop(omni, body, gameData, up.held, 'ISlot1')!;
    expect(swapped.held?.organelle.id).toBe('oxysome');
    expect(swapped.slots.ESlot1.organelle).toBeUndefined();
  });

  it('drops back where it came from', () => {
    const build = bacterium({ ESlot2: org('pulsar-gland', { excluded: true }) });
    const up = lift(build, body, 'ESlot2')!;
    const done = drop(holding(build)(up.slots), body, gameData, up.held, 'ESlot2Mirror')!;
    expect(done.slots).toEqual(build.slots);
  });
});
