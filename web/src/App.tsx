import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs, type ServerSettings } from './api';
import { AppCtx, SHORTCUTS, go, parseRoute, useApp, type Ctx } from './ctx';
import { usePrefs, setPrefs } from './prefs';
import { Hosts, Icon, IconBtn, Modal, Seg, cleanTitle, toast, useFetch } from './ui';
import { useEvents } from './useEvents';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { Compare } from './pages/Compare';
import { Projects } from './pages/Projects';
import { Sessions } from './pages/Sessions';
import { Agents } from './pages/Agents';
import { Tasks } from './pages/Tasks';
import { Workflows } from './pages/Workflows';
import { GitPage } from './pages/Git';
import { TerminalPage } from './pages/Terminal';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';

const NAV: [string, string, string][] = [
  ['dashboard', 'Dashboard', 'home'], ['projects', 'Projects', 'folder'], ['sessions', 'Sessions', 'list'], ['agents', 'Agents', 'bot'],
  ['tasks', 'Tasks', 'tasks'], ['workflows', 'Workflows', 'flow'], ['git', 'Git & Changes', 'git'], ['analytics', 'Analytics', 'chart'],
];
const MORE: [string, string, string][] = [['compare', 'Compare agents', 'columns'], ['terminal', 'Terminal & Logs', 'terminal']];
const TITLES: Record<string, string> = Object.fromEntries([...NAV, ...MORE, ['settings', 'Settings', ''], ['chat', 'Chat', '']].map(([k, t]) => [k, t]));



const mobile = () => matchMedia('(max-width: 760px)').matches;

export function App() {
  const ev = useEvents();
  const prefs = usePrefs();
  const [route, setRoute] = useState(parseRoute);
  const [drawer, setDrawer] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [preset, setPreset] = useState<{ cwd?: string; provider?: string }>({});
  const { data: settings, reload: reloadSettings } = useFetch<ServerSettings>('/api/settings');

  useEffect(() => {
    const onHash = () => { setRoute(parseRoute()); setDrawer(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const saveSettings = useCallback(async (p: Partial<ServerSettings>) => { await api('/api/settings', p); reloadSettings(); }, [reloadSettings]);
  const newChat = useCallback((o: { cwd?: string; provider?: string } = {}) => { setPreset(o); setNewOpen(true); }, []);

  const current = route.page === 'chat' ? ev.sessions.find((s) => s.id === route.arg) : undefined;

  // Alt+key shortcuts (listed in Settings → Keyboard shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const act = SHORTCUTS.find(([k]) => k === e.key.toLowerCase())?.[2];
      if (!act) return;
      e.preventDefault();
      if (act === 'newchat') newChat();
      else if (act === 'search') go('sessions?focus=1');
      else if (act === 'projects') go('projects');
      else if (act === 'terminal') go('terminal' + (current ? '?' + qs({ cwd: current.cwd }) : ''));
      else if (act === 'review') go('git' + (current ? '?' + qs({ cwd: current.cwd }) : ''));
      else if (act === 'agent') {
        const next = (settings?.defaultAgent ?? 'claude') === 'claude' ? 'codex' : 'claude';
        saveSettings({ defaultAgent: next }).then(() => toast(`Default agent: ${next}`));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, newChat, saveSettings, settings?.defaultAgent]);

  const recent = useMemo(() => ev.sessions.filter((s) => !s.archived && !s.cmp).sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at).slice(0, 8), [ev.sessions]);
  const ctx: Ctx = { ...ev, route, go, newChat, settings, saveSettings };

  const toggleNav = () => (mobile() ? setDrawer((d) => !d) : setPrefs({ compactNav: !prefs.compactNav }));
  const title = route.page === 'chat' ? cleanTitle(current?.title ?? '') : TITLES[route.page] ?? 'Not found';

  let page;
  switch (route.page) {
    case 'dashboard': page = <Dashboard />; break;
    case 'chat': page = current ? <Chat key={current.id} session={current} /> : <div className="page"><p className="muted">Chat not found. <a href="#/sessions"><u>Browse sessions</u></a></p></div>; break;
    case 'compare': page = <Compare />; break;
    case 'projects': page = <Projects />; break;
    case 'sessions': page = <Sessions />; break;
    case 'agents': page = <Agents />; break;
    case 'tasks': page = <Tasks />; break;
    case 'workflows': page = <Workflows />; break;
    case 'git': page = <GitPage />; break;
    case 'terminal': page = <TerminalPage />; break;
    case 'analytics': page = <Analytics />; break;
    case 'settings': page = <Settings />; break;
    default: page = <div className="page"><p className="muted">Page not found. <a href="#/dashboard"><u>Go to dashboard</u></a></p></div>;
  }

  const link = ([k, label, icon]: [string, string, string]) => (
    <a key={k} href={`#/${k}`} className={route.page === k ? 'sel' : ''} title={label} aria-current={route.page === k ? 'page' : undefined}><Icon n={icon} /><span className="lbl">{label}</span></a>
  );

  return (
    <AppCtx.Provider value={ctx}>
      <div className={`app${prefs.compactNav ? ' collapsed' : ''}${drawer ? ' drawer' : ''}`}>
        <nav className="nav" aria-label="Main">
          <div className="brand"><i /><span>banana</span></div>
          <button className="navbtn newchat" onClick={() => newChat()} title="New chat (Alt+N)"><Icon n="plus" /><span className="lbl">New chat</span></button>
          {NAV.map(link)}
          <h4>More</h4>
          {MORE.map(link)}
          <h4>Recent</h4>
          {recent.map((s) => (
            <a key={s.id} href={`#/chat/${s.id}`} className={`recent${route.page === 'chat' && route.arg === s.id ? ' sel' : ''}`} title={cleanTitle(s.title)}>
              {s.status === 'running' ? <span className="dot run" /> : s.pinned ? <Icon n="pin" /> : null}<span className="ell">{cleanTitle(s.title)}</span>
            </a>
          ))}
          {!recent.length && <span className="muted small recent">No chats yet</span>}
          <div className="spacer" />
          {link(['settings', 'Settings', 'gear'])}
        </nav>
        <div className="scrim" onClick={() => setDrawer(false)} />
        <div className="main">
          <div className="topbar">
            <IconBtn icon="sidebar" label="Toggle sidebar" onClick={toggleNav} />
            {route.page !== 'chat' && <span className="title ell">{title}</span>}
            <span className="grow" />
            <span className={`small ${ev.online ? 'ok' : 'bad'}`} role="status"><span className={`dot ${ev.online ? 'ok' : 'bad'}`} /> {ev.online ? 'live' : 'offline'}</span>
          </div>
          <main className="view">{page}</main>
        </div>
        <NewChat open={newOpen} onClose={() => setNewOpen(false)} preset={preset} />
        <Hosts />
      </div>
    </AppCtx.Provider>
  );
}

type PJ = { projects: { path: string; name: string; isApp: boolean }[] };
type ChatSetup = { provider: string; model: string; cwd: string };
function loadChatSetup(): ChatSetup | null {
  try {
    const setup = JSON.parse(localStorage.getItem('last-chat-setup') ?? 'null');
    return setup && ['claude', 'codex'].includes(setup.provider) && typeof setup.model === 'string' && typeof setup.cwd === 'string' ? setup : null;
  } catch { return null; }
}
function NewChat({ open, onClose, preset }: { open: boolean; onClose: () => void; preset: { cwd?: string; provider?: string } }) {
  const { settings, refresh } = useApp();
  const { data: models } = useFetch<Record<string, string[]>>(open ? '/api/models' : null);
  const { data: pj } = useFetch<PJ>(open ? '/api/projects' : null);
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSetup, setLastSetup] = useState(loadChatSetup);

  useEffect(() => {
    if (!open) return;
    const p = preset.provider ?? lastSetup?.provider ?? settings?.defaultAgent ?? 'claude';
    setProvider(p);
    setModel(lastSetup?.provider === p ? lastSetup.model : settings?.defaultModels?.[p] ?? '');
    setCwd(preset.cwd ?? lastSetup?.cwd ?? settings?.defaultProject ?? '');
  }, [open, preset, settings, lastSetup]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const { id } = await api<{ id: string }>('/api/sessions', { cwd: cwd.trim() || undefined, provider, model: model.trim() });
      const setup = { provider, model: model.trim(), cwd: cwd.trim() };
      setLastSetup(setup);
      try { localStorage.setItem('last-chat-setup', JSON.stringify(setup)); } catch { /* storage may be unavailable */ }
      await refresh(); onClose(); go('chat/' + id);
    } catch { /* toast shown by api() */ }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} title="New chat">
      <form onSubmit={create}>
        <Seg label="Agent" value={provider as 'claude' | 'codex'} options={[['claude', 'Claude'], ['codex', 'Codex']]} onChange={(p) => { setProvider(p); setModel(lastSetup?.provider === p ? lastSetup.model : settings?.defaultModels?.[p] ?? ''); }} />
        <label className="f">Model
          <input list="models-dl" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
          <datalist id="models-dl">{(models?.[provider] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="f">Project folder
          <input list="projects-dl" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="blank = this app itself" />
          <datalist id="projects-dl">{(pj?.projects ?? []).map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}</datalist>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Create</button>
        </div>
      </form>
    </Modal>
  );
}
