import type { Category, ModifierOp, StatKey } from '../engine/types';

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString('en-US');
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  if (abs === 0) return '0';
  return n.toFixed(2);
}

export const fmtPct = (fraction: number) => `${Math.round(fraction * 100)}%`;

export const STAT_LABELS: Record<StatKey, string> = {
  damage: 'Damage',
  attackSpeed: 'Attacks / s',
  projectiles: 'Projectiles',
  hits: 'Hits per projectile',
  critChance: 'Crit chance',
  critMultiplier: 'Crit multiplier',
  pierce: 'Pierce',
  forks: 'Forks',
  potency: 'Potency',
  overchargeStrength: 'Overcharge strength',
};

const PERCENT_STATS = new Set<StatKey>(['critChance']);

export function fmtStat(stat: StatKey, value: number): string {
  if (PERCENT_STATS.has(stat)) return fmtPct(value);
  if (stat === 'potency' || stat === 'overchargeStrength' || stat === 'critMultiplier') return `×${value.toFixed(2)}`;
  return fmtNum(value);
}

export function fmtContribution(stat: StatKey, op: ModifierOp, value: number): string {
  if (op === 'multiply') return `×${Number(value.toFixed(3))}`;
  if (op === 'percent') return `${value >= 0 ? '+' : ''}${Number((value * 100).toFixed(1))}%`;
  const shown = PERCENT_STATS.has(stat) ? `${Number((value * 100).toFixed(1))}%` : `${Number(value.toFixed(2))}`;
  return `${value >= 0 ? '+' : ''}${shown}`;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  weapon: 'Weapons',
  flagellum: 'Flagella',
  infuser: 'Infusers',
  mitochondrion: 'Mitochondria',
  support: 'Support',
  consumer: 'Consumers',
};

/** Two-letter badge for an organelle drawn on the body. */
export function abbreviate(name: string): string {
  const words = name
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== 'sample');
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}
