import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Chat } from './Chat';
import { Settings } from './Settings';
import { useEvents } from './useEvents';

type Svc = { pid: number | null; healthy: boolean; restarts: number };

function StatusBar({ online }: { online: boolean }) {
  const [svcs, setSvcs] = useState<Record<string, Svc> | null>(null);
  useEffect(() => {
    const tick = () => fetch('/api/status').then((r) => r.json()).then(setSvcs).catch(() => setSvcs(null));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <footer className="status">
      {svcs ? Object.entries(svcs).map(([name, s]) => (
        <span key={name} className={s.healthy ? 'ok' : 'bad'}>● {name}{s.restarts ? ` (${s.restarts} restarts)` : ''}</span>
      )) : <span className="bad">gateway unreachable, reconnecting…</span>}
      <span className={online ? 'ok' : 'bad'}>{online ? 'live' : 'offline'}</span>
    </footer>
  );
}

export function App() {
  const { sessions, events, partial, online, refresh, loadSession } = useEvents();
  const [current, setCurrent] = useState<string | null>(null);
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Record<string, string[]>>({});
  useEffect(() => { fetch('/api/models').then((r) => r.json()).then(setModels).catch(() => {}); }, []);

  useEffect(() => { if (current) loadSession(current).catch(() => {}); }, [current, loadSession]);
  // After a reconnect the log may have gaps for the open session; re-pull it.
  useEffect(() => { if (online && current) loadSession(current).catch(() => {}); }, [online, current, loadSession]);

  const session = sessions.find((s) => s.id === current);
  const evs = useMemo(
    () => [...events.values()].filter((e) => e.session_id === current).sort((a, b) => a.seq! - b.seq!),
    [events, current],
  );

  const create = async () => {
    const cwd = window.prompt('Working folder (blank = this app itself)') ?? undefined;
    if (cwd === undefined) return;
    const { id } = await api<{ id: string }>('/api/sessions', { cwd: cwd.trim() || undefined, provider, model: model.trim() });
    await refresh();
    setCurrent(id);
  };

  return (
    <div className="app">
      <div className="body">
        <aside>
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
            <option value="claude">Claude</option><option value="codex">Codex</option>
          </select>
          <input list="models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model (default)" />
          <datalist id="models">{(models[provider] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
          <button onClick={create}>+ New chat</button>
          <button onClick={() => setCurrent('settings')}>⚙ Settings</button>
          {sessions.map((s) => (
            <div key={s.id} className={`item${s.id === current ? ' sel' : ''}`} onClick={() => setCurrent(s.id)}>
              {s.status === 'running' && <span className="ok">● </span>}{s.title || 'New chat'} <span className="dim">{s.provider}</span>
            </div>
          ))}
        </aside>
        <main>{current === 'settings' ? <Settings /> : session ?<Chat key={session.id} session={session} events={evs} partial={partial[session.id] ?? ''} /> : <div className="dim pad">Pick or create a chat.</div>}</main>
      </div>
      <StatusBar online={online} />
    </div>
  );
}
