import { useState } from 'react';
import { api, type Ev } from '../api';
import { useApp } from '../ctx';
import { blocks, shell } from '../lib';
import { Agent, Dot, Empty, Icon, Seg, Skeleton, ago, base, cleanTitle, fmtDur, useFetch } from '../ui';

type Task = { session: string; title: string; provider: string; cwd: string; prompt: string; start: number; end?: number; status: 'running' | 'done' | 'failed'; durationMs?: number; cost?: number | null; tokens?: number | null; detail: string; system: boolean };

function Logs({ id, start, end }: { id: string; start: number; end?: number }) {
  const { data, loading } = useFetch<{ events: Ev[] }>(`/api/sessions/${id}/events`);
  if (loading) return <Skeleton rows={2} />;
  const evs = (data?.events ?? []).filter((e) => (e.ts ?? 0) >= start && (!end || (e.ts ?? 0) <= end + 50));
  const tools = evs.flatMap((e) => blocks(e).filter((b) => b.type === 'tool_use'));
  return (
    <div className="col" style={{ padding: '4px 0 8px' }}>
      {!tools.length ? <span className="muted small">No tool calls recorded for this task.</span> : tools.map((b) => <div key={b.id} className="mono xs ell" title={JSON.stringify(b.input)}>{b.name} {shell(b) || JSON.stringify(b.input).slice(0, 160)}</div>)}
    </div>
  );
}

export function Tasks() {
  const { go } = useApp();
  const { data, loading, reload } = useFetch<{ tasks: Task[] }>('/api/tasks', 4000);
  const [f, setF] = useState<'all' | 'running' | 'done' | 'failed'>('all');
  const [open, setOpen] = useState('');
  const tasks = (data?.tasks ?? []).filter((t) => f === 'all' || t.status === f);
  const count = (s: string) => (data?.tasks ?? []).filter((t) => t.status === s).length;

  const retry = async (t: Task) => { await api(`/api/sessions/${t.session}/messages`, { text: t.prompt }); go('chat/' + t.session); };
  const cancel = async (t: Task) => { await api(`/api/sessions/${t.session}/interrupt`, {}); reload(); };

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Tasks</h1><p>Every turn an agent has run, from the event log.</p></div></div>
      <div className="row"><Seg label="Status" value={f} onChange={setF} options={[['all', 'All'], ['running', `Running ${count('running')}`], ['done', `Done ${count('done')}`], ['failed', `Failed ${count('failed')}`]]} /></div>
      <p className="muted xs">Each chat runs one turn at a time and there's no durable queue yet, so there are no queued tasks. Progress is shown as running/finished only; the CLIs don't report percentages.</p>
      {loading ? <Skeleton rows={4} /> : !tasks.length ? <div className="card"><Empty title="No tasks" icon="tasks">Send a message in a chat and it shows up here.</Empty></div> : (
        <div className="list">
          {tasks.map((t) => {
            const k = t.session + t.start;
            return (
              <div key={k} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div className="row">
                  <Dot s={t.status} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ell">{t.system ? '(system) ' : ''}{t.prompt || '(empty)'}</div>
                    <div className="muted xs ell">{cleanTitle(t.title)} · {base(t.cwd)} · {ago(t.start)} · {fmtDur(t.durationMs ?? (t.status === 'running' ? Date.now() - t.start : undefined))}</div>
                  </div>
                  <Agent p={t.provider} />
                  <span className={`badge ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'bad' : ''}`}>{t.status}</span>
                  {t.status === 'running' && <button className="btn sm" onClick={() => cancel(t)}>Cancel</button>}
                  {t.status === 'failed' && !t.system && <button className="btn sm" onClick={() => retry(t)}><Icon n="refresh" /> Retry</button>}
                  <button className="btn sm ghost" onClick={() => setOpen(open === k ? '' : k)} aria-expanded={open === k}>{open === k ? 'Hide' : 'Details'}</button>
                  <a className="btn sm ghost" href={`#/chat/${t.session}`}>Open</a>
                </div>
                {open === k && (
                  <div>
                    {t.detail && <pre className="small bad" style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{t.detail}</pre>}
                    <p className="muted xs">{t.cost != null ? `Cost reported by CLI: $${t.cost.toFixed(4)}` : 'No cost reported'}{t.tokens != null ? ` · ${t.tokens} tokens` : ''}</p>
                    <Logs id={t.session} start={t.start} end={t.end} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
