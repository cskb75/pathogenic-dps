// Owning plasmid tree nodes, as in the game: the nodes you own always form one
// connected group with the root (links work both ways). Taking a node also
// takes the shortest path to it; dropping one also drops anything that would
// be cut off from the root.

import type { PlasmidDef } from '../engine/types';

function adjacency(nodes: PlasmidDef[]): Map<string, string[]> {
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) {
    for (const to of n.links) {
      if (!adj.has(to)) continue;
      adj.get(n.id)!.push(to);
      adj.get(to)!.push(n.id);
    }
  }
  return adj;
}

const rootsOf = (nodes: PlasmidDef[]) => nodes.filter((n) => n.root).map((n) => n.id);

/** Owned nodes still connected to the root. */
export function connectedOwned(nodes: PlasmidDef[], owned: Set<string>): Set<string> {
  const adj = adjacency(nodes);
  const seen = new Set<string>(rootsOf(nodes));
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n) || !owned.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  for (const r of rootsOf(nodes)) seen.delete(r);
  return seen;
}

/** Nodes you could take next: next to the root or to a node you own. */
export function availableNodes(nodes: PlasmidDef[], owned: Set<string>): Set<string> {
  const adj = adjacency(nodes);
  const out = new Set<string>();
  for (const id of [...rootsOf(nodes), ...owned]) for (const n of adj.get(id) ?? []) if (!owned.has(n)) out.add(n);
  for (const r of rootsOf(nodes)) out.delete(r);
  return out;
}

/** Owned set after clicking a node. */
export function toggleNode(nodes: PlasmidDef[], owned: Set<string>, id: string): Set<string> {
  const node = nodes.find((n) => n.id === id);
  if (!node || node.root) return owned;
  if (owned.has(id)) {
    const next = new Set(owned);
    next.delete(id);
    return connectedOwned(nodes, next);
  }
  // Shortest path from anything owned (or the root) to the node.
  const adj = adjacency(nodes);
  const start = [...rootsOf(nodes), ...owned];
  const prev = new Map<string, string | null>(start.map((s) => [s, null]));
  const queue = [...start];
  while (queue.length && !prev.has(id)) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(id)) return owned;
  const next = new Set(owned);
  for (let cur: string | null = id; cur && !start.includes(cur); cur = prev.get(cur) ?? null) next.add(cur);
  return next;
}
