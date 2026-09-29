// Consistency checks for game data, run by the test suite so a typo (an
// organelle id with no catalogue entry, an unknown parameter...) fails CI
// instead of silently doing nothing in the calculator.

import { behaviours } from './sim/behaviours';
import type { GameData } from './types';

export function validateData(data: GameData): string[] {
  const problems: string[] = [];
  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(data.organelles.map((o) => o.id), 'organelle');
  dupes(data.organelles.filter((o) => o.gameId).map((o) => o.gameId!), 'game');
  dupes(data.traits.map((t) => t.id), 'trait');
  dupes(data.grafts.map((g) => g.id), 'graft');
  dupes(data.params.map((p) => p.id), 'param');
  dupes(data.mutations.map((m) => m.id), 'mutation');

  const organelles = new Map(data.organelles.map((o) => [o.id, o]));
  const params = new Set(data.params.map((p) => p.id));
  for (const [id, b] of Object.entries(behaviours)) {
    const info = organelles.get(id);
    if (!info) {
      problems.push(`Behaviour for "${id}" has no catalogue entry`);
      continue;
    }
    // Infusers can attack on their own too (Resilinoplast's reflected shots), but never as something you fire.
    const attackers = ['weapon', 'active', 'support', 'pseudopod', 'flagellum', 'minion', ...(b.weapon?.passive ? ['infuser'] : [])];
    if (b.weapon && !attackers.includes(info.category)) problems.push(`"${id}" has a weapon profile but is a ${info.category}`);
    if (b.mito && !['mitochondrion', 'active', 'pseudopod', 'support'].includes(info.category)) problems.push(`"${id}" has a mitochondrion profile but is a ${info.category}`);
    for (const p of [b.weapon?.aimParam, b.volley?.aimParam]) if (p && !params.has(p)) problems.push(`"${id}" uses unknown parameter "${p}"`);
  }
  for (const [id, plan] of Object.entries(data.bodies)) {
    const slots = new Set<string>();
    for (const s of plan.slots) {
      if (slots.has(s.id)) problems.push(`Body "${id}": duplicate slot "${s.id}"`);
      slots.add(s.id);
    }
    for (const s of plan.slots) {
      if (s.mirrorOf && !slots.has(s.mirrorOf)) problems.push(`Body "${id}": slot "${s.id}" mirrors missing slot "${s.mirrorOf}"`);
    }
    for (const [a, b] of plan.links) {
      if (!slots.has(a) || !slots.has(b)) problems.push(`Body "${id}": link ${a}-${b} uses a missing slot`);
    }
  }
  dupes(data.classes.map((c) => c.id), 'class');
  for (const c of data.classes) {
    if (c.body.kind === 'modular') {
      const body = c.body;
      if (!body.pieceTypes.some((p) => p.id === body.corePiece)) problems.push(`Class "${c.id}": core piece "${body.corePiece}" is not a piece type`);
    } else {
      for (const id of [c.body.start, ...(c.body.kind === 'evolving' ? c.body.tiers.flat() : [])]) {
        if (!data.bodies[id]) problems.push(`Class "${c.id}": unknown body plan "${id}"`);
      }
    }
    dupes(c.plasmids.map((p) => p.id), `${c.id} plasmid`);
    for (const p of c.plasmids) {
      if (p.mutation && !data.mutations.some((m) => m.id === p.mutation)) problems.push(`Plasmid "${p.id}": unknown mutation "${p.mutation}"`);
    }
  }
  return problems;
}
