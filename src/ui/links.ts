// The organelle editor's connection arrows, ported from the game:
// Bodypart.can_connect_to decides which neighbours an organelle works with,
// and editor.gd (update_arrow_lines) shows arrows only for the organelle you
// hover or hold. Each arrow is coloured by the organelle it comes from
// (Bodypart.get_connection_color, an HDR colour that glows).

import type { Body } from '../engine/body';
import { organelleArt } from './organelleArt';

/** What an organelle needs for the arrows: its tags and its arrows' HDR colour. */
export interface LinkInfo {
  tags: string[];
  color: [number, number, number];
  /** The Vesicle (conduit.gd): never a starting point when arrows turn toward weapons. */
  conduit?: boolean;
}

/** An organelle's tags and arrow colour, from the game files. */
export function linkInfo(organelleId: string): LinkInfo | undefined {
  const link = organelleArt(organelleId)?.link;
  return link && { ...link, conduit: organelleId === 'vesicle' };
}

/** Bodypart.can_connect_to: whether `a` does something for `b`. */
export function canConnect(a: LinkInfo, b: LinkInfo): boolean {
  const has = (x: LinkInfo, t: string) => x.tags.includes(t);
  return (
    (has(a, 'EnergyGenerator') && has(b, 'EnergyConsumer')) ||
    (has(a, 'WeaponModifier') && has(b, 'Weapon')) ||
    (has(a, 'AttackModifier') && (has(b, 'Weapon') || has(b, 'CanBeAttackModified'))) ||
    (has(a, 'BulletModifier') && has(b, 'CanBeBulletModified')) ||
    (has(a, 'ShootsBullets') && has(b, 'UsesBulletWeapons')) ||
    (has(a, 'Weapon') && has(b, 'UsesWeapons')) ||
    (has(a, 'MeleeWeapon') && has(b, 'UsesMeleeWeapons'))
  );
}

export interface Arrow {
  /** The connection, as its two slots. */
  a: string;
  b: string;
  /** The slot the arrows point toward. */
  toward: string;
  color: [number, number, number];
  /** Arrows further back along a chain are faint. */
  alpha: number;
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The arrows the editor shows for `focus`: what reaches it along chains
 * (faint past the first step), and what it reaches directly. Its mirrored twin
 * shows the same. Then, like the game, arrows next to a weapon or an external
 * organelle turn to point at it, in the colour of the organelle they come from.
 */
export function hoverArrows(body: Body, focus: string, info: (slotId: string) => LinkInfo | undefined): Arrow[] {
  const shown = new Map<string, Arrow>();
  const neighbours = (id: string) => body.connections.get(id) ?? [];

  function show(start: string) {
    const first = info(start);
    if (!first) return;
    // Incoming: everything that works with this organelle, and with those, and so on.
    const visited = new Set<string>();
    const queue: [string, number][] = [[start, 0]];
    while (queue.length) {
      const [current, depth] = queue.shift()!;
      if (visited.has(current)) continue;
      const here = info(current);
      if (!here) continue;
      visited.add(current);
      for (const s of neighbours(current)) {
        const there = info(s);
        if (!there || !canConnect(there, here)) continue;
        const k = key(s, current);
        if (!shown.has(k)) shown.set(k, { a: s, b: current, toward: current, color: there.color, alpha: depth > 0 ? 0.18 : 1 });
        if (!visited.has(s)) queue.push([s, depth + 1]);
      }
    }
    // Outgoing: what this organelle works with directly.
    for (const s of neighbours(start)) {
      const there = info(s);
      if (!there || !canConnect(first, there)) continue;
      const k = key(start, s);
      if (!shown.has(k)) shown.set(k, { a: start, b: s, toward: s, color: first.color, alpha: 1 });
    }
  }

  show(focus);
  const slot = body.slotById.get(focus);
  const twin = slot?.mirrorOf ?? body.slots.find((s) => s.mirrorOf === focus)?.id;
  if (twin) show(twin);

  // Point arrows next to weapons and external organelles toward them.
  const starts = body.slots.filter((s) => {
    const i = info(s.id);
    return i && !i.conduit && ['Weapon', 'ShootsBullets', 'SpawnsMinions', 'External'].some((t) => i.tags.includes(t));
  });
  const visited = new Set(starts.map((s) => s.id));
  for (const s of starts) {
    const here = info(s.id)!;
    for (const n of neighbours(s.id)) {
      if (visited.has(n)) continue;
      const there = info(n);
      if (!there || !canConnect(there, here)) continue;
      const arrow = shown.get(key(n, s.id));
      if (arrow) shown.set(key(n, s.id), { ...arrow, toward: s.id, color: there.color });
      visited.add(n);
    }
  }
  return [...shown.values()];
}

/** Whether the organelles at the two ends work together: the game draws those connections bright. */
export function worksTogether(a: LinkInfo | undefined, b: LinkInfo | undefined): boolean {
  return !!a && !!b && (canConnect(a, b) || canConnect(b, a));
}

const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
const rgb = (c: number[]) => `rgb(${c.map(clamp).join(' ')})`;

/**
 * An HDR arrow colour on screen: the game draws the arrow texture (about 60%
 * bright) times the colour, clipped to white where it overflows, and its glow
 * spreads the colour's hue around it.
 */
export function arrowPaint(color: [number, number, number]) {
  const peak = Math.max(...color, 1e-6);
  return { core: rgb(color.map((c) => c * 0.6)), glow: rgb(color.map((c) => c / peak)) };
}
