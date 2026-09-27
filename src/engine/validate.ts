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
  dupes(data.organelles.filter((o) => o.demoId).map((o) => o.demoId!), 'demo');
  dupes(data.traits.map((t) => t.id), 'trait');
  dupes(data.grafts.map((g) => g.id), 'graft');
  dupes(data.params.map((p) => p.id), 'param');

  const organelles = new Map(data.organelles.map((o) => [o.id, o]));
  const params = new Set(data.params.map((p) => p.id));
  for (const [id, b] of Object.entries(behaviours)) {
    const info = organelles.get(id);
    if (!info) {
      problems.push(`Behaviour for "${id}" has no catalogue entry`);
      continue;
    }
    if (b.weapon && info.category !== 'weapon') problems.push(`"${id}" has a weapon profile but is a ${info.category}`);
    if (b.mito && info.category !== 'mitochondrion' && info.category !== 'active') problems.push(`"${id}" has a mitochondrion profile but is a ${info.category}`);
    if (b.weapon?.aimParam && !params.has(b.weapon.aimParam)) problems.push(`"${id}" uses unknown parameter "${b.weapon.aimParam}"`);
  }
  for (const c of data.classes) {
    if (!c.pieceTypes.some((p) => p.id === c.corePiece)) problems.push(`Class "${c.id}": core piece "${c.corePiece}" is not a piece type`);
    for (const u of c.upgrades) {
      for (const t of u.pieceDamage?.pieceTypes ?? []) {
        if (!c.pieceTypes.some((p) => p.id === t)) problems.push(`Upgrade "${u.id}": unknown piece type "${t}"`);
      }
    }
  }
  return problems;
}
