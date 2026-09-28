import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { amoebaStart } from '../data/amoeba';
import { makeReducer, emptyBuild, parseBuild } from '../state/build';
import { AMOEBA, buildAmoebaBody, placeBlob, type Growth } from './amoeba';
import { calculate } from './calc';
import type { Build } from './types';

const grow = (...steps: Omit<Growth, 'id'>[]) => buildAmoebaBody(amoebaStart, steps.map((s, id) => ({ ...s, id })));
const links = (body: ReturnType<typeof grow>, id: string) => [...(body.connections.get(id) ?? [])].sort();

describe('Amoeba body', () => {
  it('starts with a middle internal slot and a mirrored pair of external slots', () => {
    const body = grow();
    expect(body.slots.map((s) => s.id)).toEqual(['ISlot1', 'ESlot1', 'ESlot1Mirror']);
    expect(links(body, 'ISlot1')).toEqual(['ESlot1', 'ESlot1Mirror']);
    expect(body.blobs).toEqual([{ x: 0, y: 0, r: AMOEBA.startRadius }]);
  });

  it('mirrors a blob placed off the middle; the external twin copies the organelle', () => {
    const body = grow({ kind: 'external', x: 1.2, y: 0.4 });
    const a = body.slotById.get('Blob0')!;
    const b = body.slotById.get('Blob0Mirror')!;
    expect(b.mirrorOf).toBe('Blob0');
    expect(b.position.x).toBeCloseTo(-a.position.x);
    expect(b.position.y).toBeCloseTo(a.position.y);
    // External slots sit 37% of the blob radius out from its centre, away from the nearest blob.
    const out = Math.hypot(a.position.x - 1.2, a.position.y - 0.4);
    expect(out).toBeCloseTo(AMOEBA.blobRadius * AMOEBA.externalOut);
    // Externals only connect to internals, and never across the middle.
    expect(links(body, 'Blob0')).toEqual(['ISlot1']);
    expect(links(body, 'Blob0Mirror')).toEqual(['ISlot1']);
  });

  it('snaps a placement near the middle line onto it, without a mirror', () => {
    const body = grow({ kind: 'internal', x: 0.15, y: 1.3 });
    expect(body.slotById.has('Blob0Mirror')).toBe(false);
    expect(body.slotById.get('Blob0')!.position).toEqual({ x: 0, y: 1.3 });
    expect(links(body, 'Blob0')).toEqual(['ISlot1']);
  });

  it('keeps new blobs touching the body', () => {
    // At most 0.54 x (0.8 + 2.2) from the first blob's centre.
    const p = placeBlob([{ x: 0, y: 0, r: AMOEBA.startRadius }], { x: 5, y: 0 });
    expect(p.x).toBeCloseTo(1.62);
    // And not on top of it: at least 0.35 x (0.8 + 2.2).
    const q = placeBlob([{ x: 0, y: 0, r: AMOEBA.startRadius }], { x: 0.5, y: 0 });
    expect(q.x).toBeCloseTo(1.05);
  });

  it('links internals to anything nearby, skipping slots that already have 3 connections unless closest', () => {
    // After a mirrored external pair, ISlot1 has 4 connections.
    const front = grow({ kind: 'external', x: 1.2, y: 0.4 }, { kind: 'internal', x: 0, y: -1.3 });
    expect(links(front, 'ISlot1')).toHaveLength(4);
    // The front internal takes the two starting externals (a mirrored pair counts once) and skips the full ISlot1.
    expect(links(front, 'Blob1')).toEqual(['ESlot1', 'ESlot1Mirror']);
    // Behind, ISlot1 is the closest candidate, so it's taken anyway.
    const back = grow({ kind: 'external', x: 1.2, y: 0.4 }, { kind: 'internal', x: 0, y: 1.3 });
    expect(links(back, 'Blob1')).toEqual(['Blob0', 'Blob0Mirror', 'ISlot1']);
  });

  it('counts a mirrored weapon twice and keeps growth in saved builds', () => {
    const reducer = makeReducer(gameData);
    let build: Build = { ...emptyBuild(gameData, 'amoeba'), params: { staminaLimits: 0 } };
    build = reducer(build, { type: 'addGrowth', kind: 'external', x: 1.2, y: 0.4 });
    build = reducer(build, { type: 'setOrganelle', slotId: 'Blob0', organelle: { id: 'caustic-secretor', rarity: 'common', traits: [] } });
    const r = calculate(build, gameData);
    expect(r.weapons.map((w) => w.slotId).sort()).toEqual(['Blob0', 'Blob0Mirror']);
    expect(r.totalDps).toBeCloseTo(2 * 6.5 * (60 / 7));
    const back = parseBuild(JSON.parse(JSON.stringify(build)), gameData)!;
    expect(back.growth).toEqual(build.growth);
    expect(back.slots.Blob0?.organelle?.id).toBe('caustic-secretor');
    build = reducer(build, { type: 'removeGrowth', id: 0 });
    expect(build.slots.Blob0).toBeUndefined();
  });
});
