import type { Category } from '../engine/types';

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

export const CATEGORY_LABELS: Record<Category, string> = {
  weapon: 'Weapons',
  flagellum: 'Flagella',
  infuser: 'Infusers',
  mitochondrion: 'Mitochondria',
  active: 'Actives',
  pseudopod: 'Pseudopods',
  minion: 'Minions',
  support: 'Other',
};

export const CATEGORY_ORDER: Category[] = ['weapon', 'flagellum', 'pseudopod', 'infuser', 'mitochondrion', 'active', 'minion', 'support'];

/** The game's tooltip type for each category, which sets its colour and frame (tooltip.gd). */
export type OrganelleType = 'weapon' | 'active' | 'modifier' | 'energy' | 'lash';

export const CATEGORY_TYPE: Record<Category, OrganelleType> = {
  weapon: 'weapon',
  flagellum: 'lash',
  pseudopod: 'lash',
  infuser: 'modifier',
  mitochondrion: 'energy',
  active: 'active',
  minion: 'lash',
  support: 'lash',
};

/** Two-letter badge for an organelle drawn on the body. */
export function abbreviate(name: string): string {
  const words = name.replace(/[()-]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}
