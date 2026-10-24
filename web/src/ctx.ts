import { createContext, useContext } from 'react';
import type { Ev, ServerSettings, Session } from './api';

export type Route = { page: string; arg: string; params: URLSearchParams };
export type Ctx = {
  sessions: Session[]; events: Map<number, Ev>; partial: Record<string, string>; online: boolean;
  refresh: () => Promise<number>; loadSession: (id: string) => Promise<void>;
  route: Route; go: (to: string) => void;
  newChat: (o?: { cwd?: string; provider?: string }) => void;
  settings: ServerSettings | null; saveSettings: (p: Partial<ServerSettings>) => Promise<void>;
};
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export const parseRoute = (): Route => {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [page = '', ...rest] = path.split('/');
  return { page: page || 'dashboard', arg: rest.join('/'), params: new URLSearchParams(query) };
};
export const go = (to: string) => { location.hash = '/' + to; };

export const SHORTCUTS: [string, string, string][] = [
  ['n', 'New chat', 'newchat'], ['k', 'Search sessions', 'search'], ['p', 'Open project', 'projects'],
  ['a', 'Switch default agent', 'agent'], ['t', 'Open terminal', 'terminal'], ['r', 'Review changes', 'review'],
];
