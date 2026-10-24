import { useEffect, useMemo, useState } from 'react';
import { api, qs, type Session } from '../api';
import { useApp } from '../ctx';
import { textOf } from '../lib';
import { Agent, Dot, Empty, Icon, Markdown, Skeleton, ago, base, confirmDlg, fmtDur, toast, useFetch } from '../ui';

type Status = { repo: boolean; files: { path: string; x: string; y: string }[] };

function Column({ s }: { s: Session }) {
  const { events, loadSession, go, online } = useApp();
  const [full, setFull] = useState(false);
  useEffect(() => { loadSession(s.id).catch(() => {}); }, [s.id, s.status, online, loadSession]);
  const evs = useMemo(() => [...events.values()].filter((e) => e.session_id === s.id).sort((a, b) => a.seq! - b.seq!), [events, s.id]);
  const result = [...evs].reverse().find((e) => e.kind === 'result')?.data;
  const answer = [...evs].reverse().map(textOf).find(Boolean) ?? '';
  const { data: git } = useFetch<Status>(s.status !== 'running' ? `/api/git/status?${qs({ cwd: s.cwd })}` : null);
  const files = git?.files.map((f) => f.path) ?? [];
  return (
    <section className="card col" style={{ minWidth: 0 }}>
      <div className="row"><Dot s={s.status} /><Agent p={s.provider} /><span className="muted small">{s.model || 'default model'}</span></div>
      <div className="row small muted">
        <span>{s.status === 'running' ? 'Running…' : result ? (result.is_error ? 'Failed' : 'Finished') : 'No result'}</span>
        <span>· {fmtDur(result?.duration_ms)}</span>
        <span>· {result?.cost != null ? `$${result.cost.toFixed(3)} (CLI-reported)` : result?.usage ? `${(result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0)} tokens` : 'usage not reported'}</span>
      </div>
      <div style={{ maxHeight: full ? undefined : 260, overflow: 'auto' }} className="msg bot">{answer ? <Markdown text={answer} /> : <span className="muted">{s.status === 'running' ? 'Waiting for a response…' : 'No answer recorded.'}</span>}</div>
      {answer.length > 600 && <button className="btn sm ghost" onClick={() => setFull((v) => !v)}>{full ? 'Collapse' : 'Show full response'}</button>}
      <div className="small"><b>{files.length}</b> file{files.length === 1 ? '' : 's'} changed in its worktree {files.length > 0 && <span className="muted">— {files.slice(0, 5).join(', ')}{files.length > 5 ? '…' : ''}</span>}</div>
      <div className="row"><button className="btn sm" onClick={() => go('git?' + qs({ cwd: s.cwd }))}>Review changes</button><a className="btn sm ghost" href={`#/chat/${s.id}`}>Open chat</a></div>
    </section>
  );
}

// Plain facts only (speed, reported usage, file overlap). No quality judgement: read the diffs for that.
function Summary({ a, b }: { a: Session; b: Session }) {
  const { events } = useApp();
  const res = (s: Session) => [...events.values()].filter((e) => e.session_id === s.id && e.kind === 'result').pop()?.data;
  const fa = useFetch<Status>(`/api/git/status?${qs({ cwd: a.cwd })}`).data?.files.map((f) => f.path) ?? [];
  const fb = useFetch<Status>(`/api/git/status?${qs({ cwd: b.cwd })}`).data?.files.map((f) => f.path) ?? [];
  const ra = res(a), rb = res(b), both = fa.filter((f) => fb.includes(f));
  const name = (s: Session) => (s.provider === 'codex' ? 'Codex' : 'Claude');
  const lines = [
    ra?.duration_ms != null && rb?.duration_ms != null
      ? `${name(ra.duration_ms <= rb.duration_ms ? a : b)} finished first (${fmtDur(Math.min(ra.duration_ms, rb.duration_ms))} vs ${fmtDur(Math.max(ra.duration_ms, rb.duration_ms))}).`
      : 'Durations unavailable for one of the runs.',
    `${both.length} file${both.length === 1 ? '' : 's'} changed by both${both.length ? ': ' + both.slice(0, 4).join(', ') : ''}; ${fa.length - both.length} only by ${name(a)}, ${fb.length - both.length} only by ${name(b)}.`,
    ra?.is_error || rb?.is_error ? `Failed: ${[ra?.is_error && name(a), rb?.is_error && name(b)].filter(Boolean).join(', ')}.` : '',
  ].filter(Boolean);
  return <div className="card col"><h3>Summary</h3>{lines.map((l, i) => <p key={i} className="small">{l}</p>)}<p className="muted xs">Open Review changes on each side to compare the actual diffs.</p></div>;
}

export function Compare() {
  const { sessions, refresh, settings } = useApp();
  const { data: pj } = useFetch<{ projects: { path: string; name: string; repo: boolean }[] }>('/api/projects');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cm, setCm] = useState('');
  const [xm, setXm] = useState('');
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState('');

  const groups = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions) if (s.cmp && !s.archived) m.set(s.cmp, [...(m.get(s.cmp) ?? []), s]);
    return [...m.entries()].map(([id, ss]) => ({ id, ss: ss.sort((a) => (a.provider === 'claude' ? -1 : 1)), at: Math.max(...ss.map((s) => s.updated_at)) })).sort((a, b) => b.at - a.at);
  }, [sessions]);
  const repos = (pj?.projects ?? []).filter((p) => p.repo);
  useEffect(() => { if (!cwd && repos.length) setCwd(settings?.defaultProject && repos.some((r) => r.path === settings.defaultProject) ? settings.defaultProject : repos[0].path); }, [repos, cwd, settings]);
  const active = groups.find((g) => g.id === group) ?? groups[0];

  const start = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ group: string }>('/api/compare', { cwd, prompt, claudeModel: cm.trim(), codexModel: xm.trim() }); await refresh(); setGroup(r.group); setPrompt(''); }
    catch { /* toast */ }
    setBusy(false);
  };
  const discard = async (id: string) => {
    if (!(await confirmDlg('Remove both worktrees and their branches? Any changes the agents made there are lost. The chats stay in Archived sessions.', 'Remove'))) return;
    await api('/api/compare/discard', { group: id }); await refresh(); setGroup(''); toast('Worktrees removed');
  };

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Compare agents</h1><p>Run one prompt through Claude and Codex, each in its own git worktree.</p></div></div>
      <form className="card col" onSubmit={start}>
        <label className="f">Prompt<textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should both agents do?" /></label>
        <div className="row">
          <label className="f grow">Project (git repo)<select value={cwd} onChange={(e) => setCwd(e.target.value)}>{repos.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}</select></label>
          <label className="f">Claude model<input value={cm} onChange={(e) => setCm(e.target.value)} placeholder="default" style={{ width: 130 }} /></label>
          <label className="f">Codex model<input value={xm} onChange={(e) => setXm(e.target.value)} placeholder="default" style={{ width: 130 }} /></label>
        </div>
        <div className="row"><button className="btn primary" disabled={busy || !prompt.trim() || !cwd}><Icon n="columns" /> Run both</button><span className="muted xs">Changes stay in the worktrees; nothing is applied to your project automatically.</span></div>
        {pj && !repos.length && <span className="bad small">No git projects found. Compare needs a repository with at least one commit.</span>}
      </form>

      {!groups.length ? <div className="card"><Empty title="No comparisons yet" icon="columns">Results appear here side by side.</Empty></div> : (
        <>
          <div className="row">
            <select aria-label="Comparison" value={active?.id} onChange={(e) => setGroup(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{ago(g.at)} — {g.ss[0].title.slice(0, 50) || 'comparison'}</option>)}</select>
            {active && <button className="btn danger sm" onClick={() => discard(active.id)}>Remove worktrees</button>}
          </div>
          {active?.ss.length ? <div className="grid two" style={{ alignItems: 'start' }}>{active.ss.map((s) => <Column key={s.id} s={s} />)}</div> : <Skeleton />}
          {active && active.ss.length === 2 && active.ss.every((s) => s.status !== 'running') && <Summary a={active.ss[0]} b={active.ss[1]} />}
          {active && <p className="muted xs">Worktree folders: {active.ss.map((s) => base(s.cwd)).join(', ')} under the data folder.</p>}
        </>
      )}
    </div>
  );
}
