import { useEffect, useState } from 'react';
import type { Cli } from '../api';
import { useApp } from '../ctx';
import { Agent, Dot, Empty, Icon, Skeleton, ago, cleanTitle, useFetch } from '../ui';

type Svc = { pid: number | null; healthy: boolean; restarts: number };
type Task = { session: string; title: string; provider: string; status: string; start: number; durationMs?: number; prompt: string };
type Proj = { path: string; name: string; favorite?: boolean; lastUsed: number; sessions: number; branch: string };

function Services() {
  const [svcs, setSvcs] = useState<Record<string, Svc> | null>(null);
  useEffect(() => {
    const tick = () => fetch('/api/status').then((r) => r.json()).then(setSvcs).catch(() => setSvcs(null));
    tick(); const id = setInterval(tick, 3000); return () => clearInterval(id);
  }, []);
  if (!svcs) return <span className="bad small">Gateway unreachable, reconnecting…</span>;
  return <div className="row">{Object.entries(svcs).map(([n, s]) => <span key={n} className={`badge ${s.healthy ? 'ok' : 'bad'}`}>{n}{s.restarts ? ` · ${s.restarts} restarts` : ''}</span>)}</div>;
}

export function Dashboard() {
  const { sessions, newChat, go } = useApp();
  const { data: clis } = useFetch<Record<string, Cli>>('/api/clis');
  const { data: tasks } = useFetch<{ tasks: Task[] }>('/api/tasks', 5000);
  const { data: projs } = useFetch<{ projects: Proj[] }>('/api/projects');
  const { data: an } = useFetch<{ tasks: number; by: Record<string, { tasks: number; done: number; failed: number; cost: number; costN: number; tokens: number; tokensN: number }> }>('/api/analytics?days=7');
  const recent = sessions.filter((s) => !s.archived && !s.cmp).slice(0, 5);
  const active = (tasks?.tasks ?? []).filter((t) => t.status === 'running');
  const projects = (projs?.projects ?? []).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.lastUsed - a.lastUsed).slice(0, 4);
  const cost = Object.values(an?.by ?? {}).reduce((n, p) => n + p.cost, 0);
  const costN = Object.values(an?.by ?? {}).reduce((n, p) => n + p.costN, 0);

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Welcome back</h1><p>Your agents, sessions and projects at a glance.</p></div></div>

      <div className="row">
        <button className="btn primary" onClick={() => newChat()}><Icon n="plus" /> New chat</button>
        <button className="btn" onClick={() => go('projects')}><Icon n="folder" /> Open project</button>
        <button className="btn" onClick={() => go('compare')}><Icon n="columns" /> Compare agents</button>
      </div>

      <div className="grid two">
        {(['claude', 'codex'] as const).map((n) => {
          const c = clis?.[n];
          return (
            <a key={n} href="#/agents" className="card link">
              <div className="row"><b className="grow">{n === 'claude' ? 'Claude CLI' : 'Codex CLI'}</b>{c ? <span className={`badge ${c.installed && c.loggedIn ? 'ok' : c.installed ? 'warn' : 'bad'}`}>{!c.installed ? 'Not installed' : c.loggedIn ? 'Connected' : 'Not logged in'}</span> : null}</div>
              {c ? <p className="muted small">{c.installed ? `${c.version ?? ''}${c.detail ? ' · ' + c.detail : ''}` : 'Install it from the Agents page.'}</p> : <Skeleton rows={1} />}
            </a>
          );
        })}
      </div>

      <div className="grid two">
        <section className="col">
          <h2>Recent sessions</h2>
          {!recent.length ? <div className="card"><Empty title="No sessions yet" icon="chat">Start a chat to see it here.</Empty></div> : (
            <div className="list">{recent.map((s) => <a key={s.id} href={`#/chat/${s.id}`}><Dot s={s.status} /><span className="grow ell">{cleanTitle(s.title)}</span><Agent p={s.provider} /><span className="muted xs">{ago(s.updated_at)}</span></a>)}</div>
          )}
        </section>
        <section className="col">
          <h2>Active tasks</h2>
          {!tasks ? <Skeleton /> : !active.length ? <div className="card muted small">Nothing running right now.</div> : (
            <div className="list">{active.map((t) => <a key={t.session + t.start} href={`#/chat/${t.session}`}><Dot s="running" /><span className="grow ell">{t.prompt || t.title}</span><Agent p={t.provider} /></a>)}</div>
          )}
        </section>
      </div>

      <div className="grid two">
        <section className="col">
          <h2>Recent projects</h2>
          {!projs ? <Skeleton /> : !projects.length ? <div className="card muted small">No projects yet.</div> : (
            <div className="list">{projects.map((p) => <a key={p.path} href={`#/projects`} onClick={(e) => { e.preventDefault(); newChat({ cwd: p.path }); }}><Icon n="folder" /><span className="grow ell">{p.name}<span className="muted xs"> {p.branch && `· ${p.branch}`}</span></span><span className="muted xs">{p.sessions} chats</span></a>)}</div>
          )}
        </section>
        <section className="col">
          <h2>Last 7 days</h2>
          <div className="card row" style={{ gap: 28 }}>
            {!an ? <Skeleton rows={1} /> : <>
              <div className="stat"><b>{an.tasks}</b><span className="muted small">tasks</span></div>
              <div className="stat"><b>{Object.values(an.by).reduce((n, p) => n + p.failed, 0)}</b><span className="muted small">failed</span></div>
              <div className="stat" title="Reported by the Claude CLI; Codex doesn't report cost."><b>{costN ? `$${cost.toFixed(2)}` : '—'}</b><span className="muted small">reported cost</span></div>
            </>}
          </div>
        </section>
      </div>

      <section className="col"><h2>Services</h2><Services /></section>
    </div>
  );
}
