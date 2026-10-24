import { useSyncExternalStore } from 'react';

// Browser-local appearance preferences. Server-side config (agents, instructions) lives in /api/settings.
export type Prefs = { theme: 'system' | 'light' | 'dark'; accent: string; fontSize: number; compactNav: boolean; wrapCode: boolean; lineNumbers: boolean; diffSplit: boolean };
const DEFAULTS: Prefs = { theme: 'system', accent: 'default', fontSize: 15, compactNav: false, wrapCode: false, lineNumbers: false, diffSplit: false };

const load = (): Prefs => {
  try {
    const raw = JSON.parse(localStorage.getItem('prefs') ?? '{}');
    // earlier builds stored just the theme
    const old = localStorage.getItem('theme');
    return { ...DEFAULTS, ...(old && !raw.theme ? { theme: old } : {}), ...raw };
  } catch { return DEFAULTS; }
};

let state = load();
const subs = new Set<() => void>();

export function applyPrefs(p: Prefs = state) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (p.accent === 'default') delete root.dataset.accent; else root.dataset.accent = p.accent;
  root.style.fontSize = p.fontSize + 'px';
}

export function setPrefs(patch: Partial<Prefs>) {
  state = { ...state, ...patch };
  try { localStorage.setItem('prefs', JSON.stringify(state)); } catch { /* private mode */ }
  applyPrefs();
  subs.forEach((f) => f());
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs());

export const getPrefs = () => state;
export const usePrefs = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getPrefs);
