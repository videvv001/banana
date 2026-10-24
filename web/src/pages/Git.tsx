import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { usePrefs, setPrefs } from '../prefs';
import { DiffView, Empty, Icon, Seg, Skeleton, base, confirmDlg, toast, useFetch } from '../ui';

type F = { x: string; y: string; path: string };
type Status = { repo: boolean; error?: string; branch: string; files: F[]; worktrees: { path: string; branch: string }[] };
type Sel = { path: string; staged: boolean; untracked: boolean };
const LABEL: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'New', U: 'Conflict' };

export function GitPage() {
  const { route, go, sessions } = useApp();
  const prefs = usePrefs();
  const projects = [...new Set(sessions.map((s) => s.cwd))];
  const cwd = route.params.get('cwd') ?? projects[0] ?? '';
  const { data: st, loading, reload } = useFetch<Status>(cwd ? `/api/git/status?${qs({ cwd })}` : null, 6000);
  const [sel, setSel] = useState<Sel | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: diff, loading: dl } = useFetch<{ diff: string }>(sel ? `/api/git/diff?${qs({ cwd, file: sel.path, staged: sel.staged, untracked: sel.untracked })}&t=${st?.files.length}` : null);
  useEffect(() => setSel(null), [cwd]);

  const staged = (st?.files ?? []).filter((f) => f.x !== ' ' && f.x !== '?');
  const unstaged = (st?.files ?? []).filter((f) => f.y !== ' ');
  const act = async (a: string, body: object, ok?: string) => {
    setBusy(true);
    try { await api('/api/git/' + a, { cwd, ...body }); if (ok) toast(ok); await reload(); } catch { /* toast */ }
    setBusy(false);
  };
  const revert = async (files: string[]) => {
    if (!(await confirmDlg(`Discard changes to ${files.length === 1 ? files[0] : files.length + ' files'}? New files are deleted. This cannot be undone.`, 'Discard'))) return;
    setSel(null); act('revert', { files }, 'Reverted');
  };

  const row = (f: F, isStaged: boolean) => {
    const code = isStaged ? f.x : f.y, untracked = f.x === '?';
    const active = sel?.path === f.path && sel.staged === isStaged;
    return (
      <div key={f.path + isStaged} className="hov" style={active ? { background: 'var(--accent-soft)' } : undefined}>
        <button className="btn ghost sm grow ell" style={{ justifyContent: 'flex-start', fontFamily: 'var(--mono)', fontSize: '.8rem' }} onClick={() => setSel({ path: f.path, staged: isStaged, untracked })} title={f.path}>{f.path}</button>
        <span className="badge" title={LABEL[code] ?? code}>{(LABEL[code] ?? code).slice(0, 3)}</span>
        {isStaged
          ? <button className="btn sm" disabled={busy} onClick={() => act('unstage', { files: [f.path] })}>Unstage</button>
          : <><button className="btn sm" disabled={busy} onClick={() => act('stage', { files: [f.path] })}>Stage</button><button className="btn sm danger" disabled={busy} onClick={() => revert([f.path])}>Revert</button></>}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Git &amp; Changes</h1><p>Review what the agents changed before you keep it.</p></div>
        <select aria-label="Project" value={cwd} onChange={(e) => go('git?' + qs({ cwd: e.target.value }))}>
          {!projects.includes(cwd) && cwd && <option value={cwd}>{base(cwd)}</option>}{projects.map((p) => <option key={p} value={p}>{base(p)}</option>)}
        </select>
        <button className="btn" onClick={reload}><Icon n="refresh" /> Refresh</button>
      </div>

      {!cwd ? <div className="card"><Empty title="No project" icon="git">Start a chat first.</Empty></div> : loading ? <Skeleton rows={4} /> : !st?.repo ? <div className="card"><Empty title="Not a git repository" icon="git">{st?.error}</Empty></div> : (
        <>
          <div className="row"><span className="badge claude"><Icon n="git" /> {st.branch}</span><span className="muted small">{st.files.length} changed file{st.files.length === 1 ? '' : 's'}</span>
            {st.worktrees.length > 1 && <details className="small"><summary className="muted">{st.worktrees.length} worktrees</summary>{st.worktrees.map((w) => <div key={w.path} className="mono xs">{w.branch} — {w.path}</div>)}</details>}
          </div>
          {!st.files.length ? <div className="card"><Empty title="Working tree clean" icon="check">No changes to review.</Empty></div> : (
            <div className="grid two" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 2fr)' }}>
              <div className="col" style={{ gap: 12 }}>
                <div className="col"><div className="row"><h3 className="grow">Staged ({staged.length})</h3></div>
                  {staged.length ? <div className="list">{staged.map((f) => row(f, true))}</div> : <span className="muted small">Nothing staged.</span>}</div>
                <div className="col"><div className="row"><h3 className="grow">Changes ({unstaged.length})</h3>
                  {unstaged.length > 0 && <><button className="btn sm" disabled={busy} onClick={() => act('stage', { files: unstaged.map((f) => f.path) })}>Stage all</button><button className="btn sm danger" disabled={busy} onClick={() => revert(unstaged.map((f) => f.path))}>Revert all</button></>}</div>
                  {unstaged.length ? <div className="list">{unstaged.map((f) => row(f, false))}</div> : <span className="muted small">No unstaged changes.</span>}</div>
                <form className="col" onSubmit={async (e) => { e.preventDefault(); await act('commit', { message: msg }, 'Committed'); setMsg(''); }}>
                  <h3>Commit</h3>
                  <textarea rows={3} aria-label="Commit message" placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
                  <button className="btn primary" disabled={busy || !msg.trim() || !staged.length}>Commit {staged.length} staged file{staged.length === 1 ? '' : 's'}</button>
                </form>
              </div>
              <div className="col" style={{ minWidth: 0 }}>
                <div className="row"><h3 className="grow ell">{sel ? sel.path : 'Diff'}</h3><Seg label="Diff layout" value={prefs.diffSplit ? 'split' : 'unified'} options={[['unified', 'Unified'], ['split', 'Side by side']]} onChange={(v) => setPrefs({ diffSplit: v === 'split' })} /></div>
                {!sel ? <div className="card muted small">Select a file to see its diff.</div> : dl ? <Skeleton rows={6} /> : <DiffView diff={diff?.diff ?? ''} split={prefs.diffSplit} />}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
