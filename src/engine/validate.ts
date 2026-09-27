// Consistency checks for game data. Run by the test suite so a typo in a data
// file (an unknown status id, a duplicate organelle id...) fails CI instead of
// silently doing nothing in the calculator.

import type { GameData, GrantDef, ModifierDef, OnHitDef } from './types';

export function validateData(data: GameData): string[] {
  const problems: string[] = [];
  const statuses = new Set(data.statuses.map((s) => s.id));
  const conditions = new Set(data.conditions.map((c) => c.id));
  const params = new Set(data.params.map((p) => p.id));
  const organelleIds = new Set(data.organelles.map((o) => o.id));
  const pieceTypes = new Set(data.classes.flatMap((c) => c.pieceTypes.map((p) => p.id)));

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(data.organelles.map((o) => o.id), 'organelle');
  dupes(data.traits.map((t) => t.id), 'trait');
  dupes(data.grafts.map((g) => g.id), 'graft');
  dupes(data.statuses.map((s) => s.id), 'status');

  const checkModifier = (m: ModifierDef, where: string) => {
    if (m.when && !conditions.has(m.when)) problems.push(`${where}: unknown condition "${m.when}"`);
    if (m.per && !params.has(m.per.param)) problems.push(`${where}: unknown parameter "${m.per.param}"`);
  };
  const checkOnHit = (o: OnHitDef, where: string) => {
    if (!statuses.has(o.status)) problems.push(`${where}: unknown status "${o.status}"`);
  };
  const checkGrant = (g: GrantDef, where: string) => {
    if (g.when && !conditions.has(g.when)) problems.push(`${where}: unknown condition "${g.when}"`);
    for (const t of g.to.pieceTypes ?? []) if (!pieceTypes.has(t)) problems.push(`${where}: unknown piece type "${t}"`);
    g.modifiers?.forEach((m) => checkModifier(m, where));
    g.onHit?.forEach((o) => checkOnHit(o, where));
  };

  for (const o of data.organelles) {
    const where = `Organelle "${o.id}"`;
    o.modifiers?.forEach((m) => checkModifier(m, where));
    o.grants?.forEach((g) => checkGrant(g, where));
    o.attack?.onHit?.forEach((h) => checkOnHit(h, where));
    o.overcharge?.modifiers.forEach((m) => checkModifier(m, where));
    if (o.mitochondrion && o.attack) problems.push(`${where}: mitochondria with attacks are not supported`);
  }
  for (const t of data.traits) {
    [...t.attackModifiers, ...t.otherModifiers].forEach((m) => checkModifier(m, `Trait "${t.id}"`));
    for (const id of t.excludes ?? []) if (!organelleIds.has(id)) problems.push(`Trait "${t.id}": unknown organelle "${id}"`);
  }
  for (const g of data.grafts) g.modifiers.forEach((m) => checkModifier(m, `Graft "${g.id}"`));
  for (const c of data.classes) {
    if (!c.pieceTypes.some((p) => p.id === c.corePiece)) problems.push(`Class "${c.id}": core piece "${c.corePiece}" is not a piece type`);
    c.passives.forEach((g) => checkGrant(g, `Class "${c.id}" passive`));
    for (const u of c.upgrades) u.grants.forEach((g) => checkGrant(g, `Upgrade "${u.id}"`));
  }
  return problems;
}
