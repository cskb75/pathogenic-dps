import { describe, expect, it } from 'vitest';
import { amoebaStart } from '../data/amoeba';
import { buildAmoebaBody } from '../engine/amoeba';
import { canConnect, hoverArrows, linkInfo, worksTogether } from './links';

// The Amoeba from the user's editor video: the starting blob with Pulsar Glands
// in its mirrored front slots and an Oxysome in the middle, plus a grown
// internal blob below. ESlot1 and its twin connect to ISlot1 and Blob2, and
// ISlot1 to Blob2.
const body = buildAmoebaBody(amoebaStart, [{ id: 2, kind: 'internal', x: 0, y: 1.07 }]);
const at = (slots: Record<string, string>) => (id: string) => {
  const slot = body.slotById.get(id);
  const organelle = slots[slot?.mirrorOf ?? id];
  return organelle ? linkInfo(organelle) : undefined;
};
const OXYSOME = [3.5, 1, 1];

describe('connection arrows', () => {
  it('follows Bodypart.can_connect_to', () => {
    const [oxysome, gland, mito, nidus] = ['oxysome', 'pulsar-gland', 'entrant-mitochondrion', 'apex-nidus'].map((id) => linkInfo(id)!);
    expect(canConnect(oxysome, gland)).toBe(true);
    expect(canConnect(gland, oxysome)).toBe(false);
    expect(canConnect(oxysome, nidus)).toBe(true);
    expect(canConnect(mito, oxysome)).toBe(true);
    expect(worksTogether(gland, oxysome)).toBe(true);
    expect(worksTogether(gland, nidus)).toBe(false);
  });

  it('shows what a hovered organelle reaches, in its colour', () => {
    expect(body.connections.get('Blob2')).toContain('ISlot1');
    const arrows = hoverArrows(body, 'ISlot1', at({ ISlot1: 'oxysome', ESlot1: 'pulsar-gland', Blob2: 'apex-nidus' }));
    expect(arrows.map((a) => a.toward).sort()).toEqual(['Blob2', 'ESlot1', 'ESlot1Mirror']);
    for (const a of arrows) {
      expect(a.color).toEqual(OXYSOME);
      expect(a.alpha).toBe(1);
    }
  });

  it('shows what reaches a hovered weapon, on its mirrored twin too, fainter further back', () => {
    const arrows = hoverArrows(body, 'ESlot1', at({ ISlot1: 'oxysome', ESlot1: 'pulsar-gland', Blob2: 'entrant-mitochondrion' }));
    const toward = (id: string) => arrows.filter((a) => a.toward === id);
    const MITO = [3.5, 1.5, 0.8];
    // The Oxysome and the mitochondrion both reach the gland directly.
    expect(toward('ESlot1')).toEqual([
      { a: 'ISlot1', b: 'ESlot1', toward: 'ESlot1', color: OXYSOME, alpha: 1 },
      { a: 'Blob2', b: 'ESlot1', toward: 'ESlot1', color: MITO, alpha: 1 },
    ]);
    expect(toward('ESlot1Mirror')).toHaveLength(2);
    // The mitochondrion also charges the Oxysome, one step further back.
    expect(toward('ISlot1')).toEqual([{ a: 'Blob2', b: 'ISlot1', toward: 'ISlot1', color: MITO, alpha: 0.18 }]);
  });

  it('shows nothing for an empty slot', () => {
    expect(hoverArrows(body, 'Blob2', at({ ESlot1: 'pulsar-gland' }))).toEqual([]);
  });
});
