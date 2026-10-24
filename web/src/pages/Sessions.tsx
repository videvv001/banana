import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Ev, type Session } from '../api';
import { useApp } from '../ctx';
import { sessionToMarkdown } from '../lib';
import { Agent, Dot, Empty, IconBtn, Modal, Seg, ago, cleanTitle, base, confirmDlg, copy, download, toast } from '../ui';

export function Sessions() {
  const { sessions, refresh, route } = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Set<string> | null>(null);
  const [agent, setAgent] = useState<'all' | 'claude' | 'codex'>('all');
  const [project, setProject] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [rename, setRename] = useState<Session | null>(null);
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (route.params.get('focus')) input.current?.focus(); }, [route]);
  // Full-text search over message content (server side) on top of the title match.
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => fetch('/api/search?q=' + encodeURIComponent(q.trim())).then((r) => r.json()).then((r) => setHits(new Set(r.ids))).catch(() => setHits(null)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const projects = useMemo(() => [...new Set(sessions.filter((s) => !s.cmp).map((s) => s.cwd))], [sessions]);
  const shown = useMemo(() => sessions
    .filter((s) => (view === 'archived' ? !!s.archived : !s.archived))
    .filter((s) => agent === 'all' || s.provider === agent)
    .filter((s) => !project || s.cwd === project)
    .filter((s) => !q.trim() || (s.title || '').toLowerCase().includes(q.toLowerCase()) || hits?.has(s.id))
    .sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at), [sessions, view, agent, project, q, hits]);

  const update = (s: Session, patch: object) => api(`/api/sessions/${s.id}/update`, patch).then(refresh);
  const del = async (s: Session) => {
    if (!(await confirmDlg(`Delete "${cleanTitle(s.title)}" and its history? This cannot be undone.`))) return;
    await api(`/api/sessions/${s.id}/delete`, {}); await refresh(); toast('Session deleted');
  };
  const exportMd = async (s: Session) => {
    const r = await api<{ events: Ev[] }>(`/api/sessions/${s.id}/events`);
    download(`${(s.title || 'chat').replace(/[^\w-]+/g, '_').slice(0, 40)}.md`, sessionToMarkdown(s, r.events));
  };
  const resumeCmd = (s: Session) => s.provider === 'codex' ? ((s as any).ext_id ? `codex resume ${(s as any).ext_id}` : '') : (s.started ? `claude --resume ${s.id}` : '');

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Sessions</h1><p>{sessions.length} conversations</p></div></div>
      <div className="row">
        <input ref={input} className="grow" type="search" aria-label="Search sessions" placeholder="Search titles and messages…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <Seg label="Agent" value={agent} options={[['all', 'All'], ['claude', 'Claude'], ['codex', 'Codex']]} onChange={setAgent} />
        <Seg label="View" value={view} options={[['active', 'Active'], ['archived', 'Archived']]} onChange={setView} />
        <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>{projects.map((p) => <option key={p} value={p}>{base(p)}</option>)}
        </select>
      </div>

      {!shown.length ? <div className="card"><Empty title={q ? 'No matches' : view === 'archived' ? 'Nothing archived' : 'No sessions yet'} icon="list">{q ? 'Try a different search.' : 'Start a new chat from the sidebar.'}</Empty></div> : (
        <div className="list">
          {shown.map((s) => (
            <div key={s.id} className="hov">
              <Dot s={s.status} />
              <a href={`#/chat/${s.id}`} className="grow" style={{ minWidth: 0, padding: 0, border: 0 }}>
                <div className="ell">{s.pinned ? '📌 ' : ''}{cleanTitle(s.title)}{s.cmp && <span className="badge" style={{ marginLeft: 8 }}>compare</span>}</div>
                <div className="muted xs ell">{base(s.cwd)} · {s.model || 'default model'} · {ago(s.updated_at)}</div>
              </a>
              <Agent p={s.provider} />
              <span className="row" style={{ gap: 0 }}>
                <IconBtn icon="pin" label={s.pinned ? 'Unpin' : 'Pin'} on={!!s.pinned} onClick={() => update(s, { pinned: !s.pinned })} />
                <IconBtn icon="edit" label="Rename" onClick={() => { setRename(s); setTitle(s.title); }} />
                <IconBtn icon="download" label="Export Markdown" onClick={() => exportMd(s)} />
                {resumeCmd(s) && <IconBtn icon="terminal" label={`Copy CLI resume command: ${resumeCmd(s)}`} onClick={() => copy(resumeCmd(s))} />}
                <IconBtn icon="archive" label={s.archived ? 'Unarchive' : 'Archive'} onClick={() => update(s, { archived: !s.archived })} />
                <IconBtn icon="trash" label="Delete" disabled={s.status === 'running'} onClick={() => del(s)} />
              </span>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!rename} onClose={() => setRename(null)} title="Rename session">
        <form onSubmit={(e) => { e.preventDefault(); if (rename) update(rename, { title }).then(() => setRename(null)); }}>
          <input autoFocus aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setRename(null)}>Cancel</button><button className="btn primary">Save</button></div>
        </form>
      </Modal>
    </div>
  );
}
