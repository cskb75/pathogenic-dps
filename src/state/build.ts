// Build state: creation, edits (as a reducer), and save/load.

import { bodyFor, findClass } from '../engine/calc';
import { removePieceTree } from '../engine/body';
import type { Build, CustomModifier, CustomTarget, GameData, ModifierOp, OrganelleInstance, Rarity, SlotState, StatKey } from '../engine/types';
import { RARITIES, STAT_KEYS } from '../engine/types';

export function emptyBuild(data: GameData, classId = data.classes[0].id): Build {
  const cls = findClass(data, classId);
  return {
    version: 1,
    name: `${cls.name} build`,
    classId: cls.id,
    pieces: [{ id: 'core', type: cls.corePiece }],
    slots: {},
    upgrades: {},
    conditions: {},
    params: {},
    targets: 1,
    custom: [],
  };
}

/** A small starting build so first-time visitors see how things connect. */
export function exampleBuild(data: GameData): Build {
  const build = emptyBuild(data, 'nanobot');
  build.name = 'Example: infused secretors';
  build.pieces = [
    { id: 'core', type: 'core' },
    { id: 'p1', type: 'square', attach: { to: 'core', edge: 0 } },
    { id: 'p2', type: 'triangle', attach: { to: 'core', edge: 1 } },
    { id: 'p3', type: 'triangle', attach: { to: 'core', edge: 3 } },
  ];
  const org = (id: string, rarity: Rarity = 'common'): SlotState => ({ organelle: { id, rarity, traits: [] } });
  build.slots = {
    'core.c': org('sample-mito-stationary', 'rare'),
    'p1.c': org('sample-attack-infuser', 'rare'),
    'p1.e1': org('caustic-secretor', 'epic'),
    'p1.e2': org('caustic-secretor', 'rare'),
    'p1.e3': org('caustic-secretor', 'rare'),
    'core.e2': org('thermal-lance'),
    'p2.c': org('resonant-cavity'),
    'p2.e1': org('katanosome', 'rare'),
    'p2.e2': org('oxidator'),
    'p3.c': org('sample-burn-infuser'),
    'p3.e1': org('katanosome'),
    'p3.e2': org('caustic-secretor'),
  };
  build.upgrades = { 'triangle-damage': 1 };
  return build;
}

export type Action =
  | { type: 'load'; build: Build }
  | { type: 'rename'; name: string }
  | { type: 'addPiece'; pieceType: string; to: string; edge: number }
  | { type: 'removePiece'; pieceId: string }
  | { type: 'setOrganelle'; slotId: string; organelle: OrganelleInstance | undefined }
  | { type: 'setSlot'; slotId: string; patch: Partial<Omit<SlotState, 'organelle'>> }
  | { type: 'setUpgrade'; id: string; stacks: number }
  | { type: 'setCondition'; id: string; on: boolean }
  | { type: 'setParam'; id: string; value: number }
  | { type: 'setTargets'; targets: number }
  | { type: 'setCustom'; custom: CustomModifier[] };

/** Drops slot settings for slots that no longer exist on the body. */
function pruneSlots(build: Build, data: GameData): Build {
  const body = bodyFor(build, data);
  const slots = Object.fromEntries(Object.entries(build.slots).filter(([id]) => body.slotById.has(id)));
  return { ...build, slots };
}

function nextPieceId(build: Build): string {
  const n = build.pieces.reduce((max, p) => Math.max(max, Number(p.id.replace(/^p/, '')) || 0), 0);
  return `p${n + 1}`;
}

export function makeReducer(data: GameData) {
  return function reducer(build: Build, action: Action): Build {
    switch (action.type) {
      case 'load':
        return pruneSlots(action.build, data);
      case 'rename':
        return { ...build, name: action.name };
      case 'addPiece': {
        const pieces = [...build.pieces, { id: nextPieceId(build), type: action.pieceType, attach: { to: action.to, edge: action.edge } }];
        return pruneSlots({ ...build, pieces }, data);
      }
      case 'removePiece':
        if (action.pieceId === build.pieces[0]?.id) return build;
        return pruneSlots({ ...build, pieces: removePieceTree(build.pieces, action.pieceId) }, data);
      case 'setOrganelle': {
        const current = build.slots[action.slotId] ?? {};
        const next: SlotState = { ...current, organelle: action.organelle };
        if (!action.organelle || action.organelle.id !== current.organelle?.id) {
          delete next.uptime;
          delete next.excluded;
        }
        return { ...build, slots: { ...build.slots, [action.slotId]: next } };
      }
      case 'setSlot': {
        const current = build.slots[action.slotId] ?? {};
        return { ...build, slots: { ...build.slots, [action.slotId]: { ...current, ...action.patch } } };
      }
      case 'setUpgrade':
        return { ...build, upgrades: { ...build.upgrades, [action.id]: action.stacks } };
      case 'setCondition':
        return { ...build, conditions: { ...build.conditions, [action.id]: action.on } };
      case 'setParam':
        return { ...build, params: { ...build.params, [action.id]: action.value } };
      case 'setTargets':
        return { ...build, targets: Math.max(1, Math.min(50, Math.round(action.targets) || 1)) };
      case 'setCustom':
        return { ...build, custom: action.custom };
    }
  };
}

// --- Save / load --------------------------------------------------------------

const STORAGE_KEY = 'pathogenic-dps:build';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeBuild(build: Build): string {
  return toBase64Url(JSON.stringify(build));
}

/** Parses a build from untrusted input (a link or storage). Returns null if it doesn't look valid. */
export function decodeBuild(text: string, data: GameData): Build | null {
  try {
    return parseBuild(JSON.parse(fromBase64Url(text)), data);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSlots(raw: unknown): Build['slots'] {
  if (!isRecord(raw)) return {};
  const slots: Build['slots'] = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const state: SlotState = {};
    const o = v.organelle;
    if (isRecord(o) && typeof o.id === 'string') {
      state.organelle = {
        id: o.id,
        rarity: RARITIES.includes(o.rarity as Rarity) ? (o.rarity as Rarity) : 'common',
        traits: Array.isArray(o.traits) ? o.traits.filter((t): t is string => typeof t === 'string') : [],
      };
    }
    if (typeof v.graft === 'string') state.graft = v.graft;
    if (typeof v.uptime === 'number' && Number.isFinite(v.uptime)) state.uptime = Math.min(1, Math.max(0, v.uptime));
    if (v.excluded === true) state.excluded = true;
    slots[id] = state;
  }
  return slots;
}

const CUSTOM_TARGETS: CustomTarget[] = ['attacks', 'projectiles', 'weapons', 'everything'];
const OPS: ModifierOp[] = ['flat', 'percent', 'multiply'];

function isCustomModifier(v: unknown): v is CustomModifier {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    CUSTOM_TARGETS.includes(v.target as CustomTarget) &&
    STAT_KEYS.includes(v.stat as StatKey) &&
    OPS.includes(v.op as ModifierOp) &&
    typeof v.value === 'number' &&
    Number.isFinite(v.value)
  );
}

export function parseBuild(raw: unknown, data: GameData): Build | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.pieces) || raw.pieces.length === 0) return null;
  const base = emptyBuild(data, typeof raw.classId === 'string' ? raw.classId : undefined);
  const seen = new Set<string>();
  const pieces: Build['pieces'] = [];
  raw.pieces.forEach((p, i) => {
    if (!isRecord(p) || typeof p.id !== 'string' || typeof p.type !== 'string' || seen.has(p.id)) return;
    const { id, type, attach } = p;
    if (i === 0) {
      // The core is never attached to anything.
      if (attach !== undefined) return;
      pieces.push({ id, type });
    } else {
      if (!isRecord(attach) || typeof attach.to !== 'string' || typeof attach.edge !== 'number' || !Number.isInteger(attach.edge)) return;
      pieces.push({ id, type, attach: { to: attach.to, edge: attach.edge } });
    }
    seen.add(id);
  });
  if (pieces.length === 0) return null;
  const numberMap = (v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) : {};
  const boolMap = (v: unknown) => (isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) : {});
  return pruneSlots(
    {
      ...base,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : base.name,
      pieces,
      slots: parseSlots(raw.slots),
      upgrades: numberMap(raw.upgrades) as Record<string, number>,
      conditions: boolMap(raw.conditions) as Record<string, boolean>,
      params: numberMap(raw.params) as Record<string, number>,
      targets: typeof raw.targets === 'number' ? raw.targets : 1,
      custom: Array.isArray(raw.custom) ? raw.custom.filter(isCustomModifier) : [],
    },
    data,
  );
}

export function loadInitialBuild(data: GameData): Build {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get('b');
  if (hash) {
    const fromLink = decodeBuild(hash, data);
    if (fromLink) return fromLink;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? parseBuild(JSON.parse(saved), data) : null;
    if (parsed) return parsed;
  } catch {
    // storage unavailable or corrupt: fall through
  }
  return exampleBuild(data);
}

export function saveBuild(build: Build) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch {
    // storage unavailable (private mode): the share link still works
  }
}

export function shareUrl(build: Build): string {
  const url = new URL(window.location.href);
  url.hash = `b=${encodeBuild(build)}`;
  return url.toString();
}
