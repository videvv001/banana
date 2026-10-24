import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../ctx';
import { Icon, IconBtn, Seg, base, copy, fmtDur, useFetch } from '../ui';

type Entry = { id: string; cwd: string; tab: string; command: string; ts: number; running: boolean; code: number | null; out: string; ms?: number };

function Terminal() {
  const { route, sessions } = useApp();
  const folders = [...new Set(sessions.map((s) => s.cwd))];
  const [cwd, setCwd] = useState(route.params.get('cwd') ?? folders[0] ?? '');
  const [tabs, setTabs] = useState(['1']);
  const [tab, setTab] = useState('1');
  const [cmd, setCmd] = useState('');
  const { data, reload } = useFetch<{ entries: Entry[] }>('/api/terminal', 1500);
  const end = useRef<HTMLDivElement>(null);
  const hist = (data?.entries ?? []).filter((e) => e.tab === tab && e.cwd === cwd);
  useEffect(() => { if (!cwd && folders[0]) setCwd(folders[0]); }, [cwd, folders]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [hist.length, hist[hist.length - 1]?.out.length]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || !cwd) return;
    await api('/api/terminal/run', { cwd, command: cmd, tab }).catch(() => {});
    setCmd(''); reload();
  };
  const addTab = () => { const n = String(Math.max(...tabs.map(Number)) + 1); setTabs([...tabs, n]); setTab(n); };

  return (
    <div className="col">
      <div className="row">
        <select aria-label="Working folder" value={cwd} onChange={(e) => setCwd(e.target.value)}>{folders.map((f) => <option key={f} value={f}>{base(f)}</option>)}</select>
        <div className="seg" role="tablist">{tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>Terminal {t}</button>)}</div>
        <IconBtn icon="plus" label="New terminal tab" onClick={addTab} />
      </div>
      <div className="term" style={{ minHeight: 280, maxHeight: '55vh', overflow: 'auto' }} role="log" aria-label="Terminal output">
        {!hist.length && <span style={{ opacity: .6 }}>Run a command in {cwd ? base(cwd) : 'a project'}…</span>}
        {hist.map((h, i) => {
          const body = (
            <>
              <pre className="cmd">$ {h.command}</pre>
              <pre>{h.out || (h.running ? '' : '(no output)')}</pre>
              <div style={{ opacity: .7 }} className="xs">{h.running ? 'running…' : `exit ${h.code} · ${fmtDur(h.ms)}`}</div>
            </>
          );
          return (
            <div key={h.id} style={{ marginBottom: 12 }}>
              {i < hist.length - 3 && !h.running ? <details><summary className="cmd" style={{ cursor: 'pointer' }}>$ {h.command} <span style={{ opacity: .6 }}>· exit {h.code}</span></summary>{body}</details> : body}
              <div className="row">
                {h.running && <button className="btn sm" onClick={() => api('/api/terminal/kill', { id: h.id }).then(reload)}><Icon n="stop" /> Kill</button>}
                {!h.running && <button className="btn sm ghost" style={{ color: 'inherit' }} onClick={() => copy(h.out)}>Copy output</button>}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="row" onSubmit={run}>
        <input className="grow mono" aria-label="Command" placeholder="command…" value={cmd} onChange={(e) => setCmd(e.target.value)} autoFocus disabled={!cwd} />
        <button className="btn primary" disabled={!cmd.trim() || !cwd}>Run</button>
      </form>
      <p className="muted xs">Runs one command at a time in the chosen folder (60 history entries kept in memory). This isn't a full PTY: interactive programs and prompts won't work, and each command starts a fresh shell.</p>
    </div>
  );
}

function Logs() {
  const { data: list } = useFetch<{ files: string[] }>('/api/logs');
  const [name, setName] = useState('');
  const [errs, setErrs] = useState(false);
  useEffect(() => { if (!name && list?.files[0]) setName(list.files[0]); }, [list, name]);
  const { data, error } = useFetch<{ text: string }>(name ? `/api/logs?${qs({ name })}` : null, 3000);
  // eslint-disable-next-line no-control-regex
  const text = (data?.text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const shown = errs ? text.split('\n').filter((l) => /error|fail|exception|fatal|warn/i.test(l)).join('\n') : text;
  return (
    <div className="col">
      <div className="row">
        <select aria-label="Log file" value={name} onChange={(e) => setName(e.target.value)}>{(list?.files ?? []).map((f) => <option key={f}>{f}</option>)}</select>
        <label className="row small"><input type="checkbox" checked={errs} onChange={(e) => setErrs(e.target.checked)} /> Errors &amp; warnings only</label>
        <span className="grow" /><button className="btn" onClick={() => copy(shown)}><Icon n="copy" /> Copy</button>
      </div>
      {error && <p className="bad small">{error}</p>}
      <div className="term" style={{ maxHeight: '60vh', overflow: 'auto' }}><pre>{shown || (name ? '(empty)' : 'No log files.')}</pre></div>
      <p className="muted xs">Showing the last 60 KB, refreshed every 3 seconds.</p>
    </div>
  );
}

export function TerminalPage() {
  const { route, go } = useApp();
  const tab = route.params.get('tab') === 'logs' ? 'logs' : 'terminal';
  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Terminal &amp; Logs</h1></div>
        <Seg label="View" value={tab} onChange={(v) => go('terminal' + (v === 'logs' ? '?tab=logs' : route.params.get('cwd') ? '?' + qs({ cwd: route.params.get('cwd') ?? '' }) : ''))} options={[['terminal', 'Terminal'], ['logs', 'Service logs']]} />
      </div>
      {tab === 'terminal' ? <Terminal /> : <Logs />}
    </div>
  );
}
