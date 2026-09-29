// Whether the game art moves: on unless you turn it off (the body view's
// Animate box, remembered), and never when the system asks for reduced motion.
// The body view and the pathogen carousel share the setting.

import { useSyncExternalStore } from 'react';

const KEY = 'pathogenic-dps.animate';
const listeners = new Set<() => void>();

function readWanted(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let wanted = typeof window !== 'undefined' ? readWanted() : true;

function setWanted(on: boolean) {
  wanted = on;
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // storage unavailable: the choice lasts until reload
  }
  for (const fn of listeners) fn();
}

const reducedQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  reducedQuery?.addEventListener('change', fn);
  return () => {
    listeners.delete(fn);
    reducedQuery?.removeEventListener('change', fn);
  };
}

const snapshot = () => `${wanted ? 1 : 0}${reducedQuery?.matches ? 1 : 0}`;

export function useAnimation() {
  const state = useSyncExternalStore(subscribe, snapshot, () => '10');
  const reduced = state[1] === '1';
  return { on: state[0] === '1' && !reduced, reduced, set: setWanted };
}
