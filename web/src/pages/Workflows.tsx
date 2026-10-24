import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../ctx';
import { Agent, Dot, Empty, Icon, IconBtn, Markdown, Modal, Skeleton, ago, base, confirmDlg, toast, useFetch } from '../ui';

type Step = { title: string; provider: string; model: string; prompt: string; approve: boolean };
type WF = { id?: string; name: string; description: string; steps: Step[] };
type RunStep = Step & { status: string; output: string; sessionId?: string };
type Run = { id: string; name: string; cwd: string; input: string; status: string; step: number; startedAt: number; endedAt?: number; steps: RunStep[] };

const step = (o: Partial<Step> = {}): Step => ({ title: '', provider: 'claude', model: '', prompt: '', approve: false, ...o });
const TEMPLATES: WF[] = [
  { name: 'Code review', description: 'Review the current uncommitted changes for bugs and risks.', steps: [step({ title: 'Review', prompt: 'Review the uncommitted changes in this repository (use git diff). List concrete bugs, risky spots and missing tests, most severe first. Do not edit files. Extra focus: {{input}}' })] },
  { name: 'Test generation', description: 'Write tests for a target, after you approve the plan.', steps: [step({ title: 'Plan tests', prompt: 'Look at {{input}} and propose a short list of test cases. Do not write code yet.', approve: false }), step({ title: 'Write tests', prompt: 'Implement these tests, run them, and fix failures:\n{{prev}}', approve: true })] },
  { name: 'Documentation', description: 'Draft docs for a module.', steps: [step({ title: 'Document', prompt: 'Write clear documentation (README section or docstrings, whichever fits) for: {{input}}. Keep it short and accurate to the code.' })] },
  { name: 'Claude → Codex handoff', description: 'Claude implements, you check, then Codex reviews.', steps: [step({ title: 'Implement (Claude)', prompt: '{{input}}' }), step({ title: 'Review (Codex)', provider: 'codex', prompt: 'Review the changes just made for this task and report problems. Task: {{input}}\n\nThe previous agent said:\n{{prev}}', approve: true })] },
];

function Builder({ wf, onClose, onSave }: { wf: WF | null; onClose: () => void; onSave: () => void }) {
  const [w, setW] = useState<WF>(wf ?? { name: '', description: '', steps: [step()] });
  const set = (i: number, p: Partial<Step>) => setW({ ...w, steps: w.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: number) => { const s = [...w.steps]; const [x] = s.splice(i, 1); s.splice(i + d, 0, x); setW({ ...w, steps: s }); };
  const save = async (e: React.FormEvent) => { e.preventDefault(); try { await api('/api/workflows/save', { workflow: w }); toast('Workflow saved'); onSave(); } catch { /* toast */ } };
  return (
    <form className="col" onSubmit={save} style={{ gap: 12 }}>
      <label className="f">Name<input autoFocus value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></label>
      <label className="f">Description<input value={w.description} onChange={(e) => setW({ ...w, description: e.target.value })} /></label>
      {w.steps.map((s, i) => (
        <div key={i} className="wf-step">
          <div className="row"><b className="grow">Step {i + 1}</b>
            <IconBtn icon="x" label="Remove step" disabled={w.steps.length === 1} onClick={() => setW({ ...w, steps: w.steps.filter((_, j) => j !== i) })} />
            <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button type="button" className="btn sm ghost" disabled={i === w.steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button></div>
          <div className="row">
            <input aria-label="Step title" placeholder="Title" value={s.title} onChange={(e) => set(i, { title: e.target.value })} className="grow" />
            <select aria-label="Agent" value={s.provider} onChange={(e) => set(i, { provider: e.target.value })}><option value="claude">Claude</option><option value="codex">Codex</option></select>
            <input aria-label="Model" placeholder="model" value={s.model} onChange={(e) => set(i, { model: e.target.value })} style={{ width: 110 }} />
          </div>
          <textarea aria-label="Prompt" rows={3} value={s.prompt} onChange={(e) => set(i, { prompt: e.target.value })} placeholder="Prompt. Use {{input}} for the run input and {{prev}} for the previous step's answer." />
          <label className="row small"><input type="checkbox" checked={s.approve} onChange={(e) => set(i, { approve: e.target.checked })} /> Wait for my approval before this step</label>
        </div>
      ))}
      <div className="row"><button type="button" className="btn" onClick={() => setW({ ...w, steps: [...w.steps, step()] })}><Icon n="plus" /> Add step</button><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
    </form>
  );
}

function RunCard({ r, reload }: { r: Run; reload: () => void }) {
  const [open, setOpen] = useState(r.status === 'waiting');
  const post = (act: string, body: object = {}) => api(`/api/runs/${r.id}/${act}`, body).then(reload);
  return (
    <div style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row">
        <Dot s={r.status === 'waiting' ? 'running' : r.status} /><b className="grow ell">{r.name}</b>
        <span className="muted xs">{base(r.cwd)} · {ago(r.startedAt)}</span>
        <span className={`badge ${r.status === 'done' ? 'ok' : r.status === 'failed' ? 'bad' : r.status === 'waiting' ? 'warn' : ''}`}>{r.status === 'waiting' ? 'needs approval' : r.status}</span>
        {(r.status === 'running' || r.status === 'waiting') && <button className="btn sm" onClick={() => post('cancel')}>Cancel</button>}
        <button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button>
      </div>
      {open && (
        <div className="col">
          {r.input && <p className="small muted">Input: {r.input}</p>}
          {r.steps.map((s, i) => (
            <div key={i} className="wf-step">
              <div className="row"><Dot s={s.status} /><b>{i + 1}. {s.title || 'Step'}</b><Agent p={s.provider} /><span className="grow" />{s.sessionId && <a className="btn sm ghost" href={`#/chat/${s.sessionId}`}>Open chat</a>}</div>
              {r.status === 'waiting' && r.step === i && (
                <div className="approval"><p className="small">This step is waiting for your approval before it runs.</p>
                  <pre>{s.prompt}</pre>
                  <div className="row"><button className="btn primary sm" onClick={() => post('continue', { approve: true })}>Approve &amp; run</button><button className="btn sm" onClick={() => post('continue', { approve: false })}>Stop here</button></div></div>
              )}
              {s.output && <div className="msg bot small" style={{ maxHeight: 240, overflow: 'auto' }}><Markdown text={s.output} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Workflows() {
  const { sessions, settings } = useApp();
  const { data, loading, reload } = useFetch<{ workflows: Required<WF>[]; runs: Run[] }>('/api/workflows', 3000);
  const [edit, setEdit] = useState<WF | null | undefined>(undefined); // undefined = closed, null = new
  const [runWf, setRunWf] = useState<Required<WF> | null>(null);
  const [cwd, setCwd] = useState('');
  const [input, setInput] = useState('');
  const folders = [...new Set(sessions.filter((s) => !s.cmp).map((s) => s.cwd))];

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/runs/start', { workflowId: runWf!.id, cwd, input }); setRunWf(null); setInput(''); reload(); toast('Workflow started'); } catch { /* toast */ }
  };
  const del = async (w: Required<WF>) => { if (await confirmDlg(`Delete workflow "${w.name}"? Past runs stay in the history.`)) { await api('/api/workflows/delete', { id: w.id }); reload(); } };

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Workflows</h1><p>Chains of prompts that run step by step, optionally pausing for your approval.</p></div>
        <button className="btn primary" onClick={() => setEdit(null)}><Icon n="plus" /> New workflow</button></div>

      <section className="col"><h2>Templates</h2>
        <div className="grid">{TEMPLATES.map((t) => <div key={t.name} className="card col"><b>{t.name}</b><p className="muted small grow">{t.description}</p><div className="muted xs">{t.steps.length} step{t.steps.length > 1 ? 's' : ''}</div><div><button className="btn sm" onClick={() => setEdit(t)}>Use template</button></div></div>)}</div></section>

      <section className="col"><h2>Your workflows</h2>
        {loading ? <Skeleton /> : !data?.workflows.length ? <div className="card"><Empty title="No workflows yet" icon="flow">Save a template or build your own.</Empty></div> : (
          <div className="list">{data.workflows.map((w) => (
            <div key={w.id} className="hov"><div className="grow" style={{ minWidth: 0 }}><div className="ell"><b>{w.name}</b></div><div className="muted xs ell">{w.steps.length} steps{w.description ? ' · ' + w.description : ''}</div></div>
              <button className="btn primary sm" onClick={() => { setRunWf(w); setCwd(settings?.defaultProject || folders[0] || ''); }}><Icon n="play" /> Run</button>
              <IconBtn icon="edit" label="Edit" onClick={() => setEdit(w)} /><IconBtn icon="trash" label="Delete" onClick={() => del(w)} /></div>
          ))}</div>
        )}
      </section>

      <section className="col"><h2>Run history</h2>
        {!data?.runs.length ? <div className="card muted small">No runs yet.</div> : <div className="list">{data.runs.map((r) => <RunCard key={r.id + r.status + r.step} r={r} reload={reload} />)}</div>}
        <p className="muted xs">Each step runs as its own chat. Workflows need the agent-host to stay up; a restart marks a running workflow as failed.</p>
      </section>

      <Modal open={edit !== undefined} onClose={() => setEdit(undefined)} title={edit?.id ? 'Edit workflow' : 'New workflow'}>
        {edit !== undefined && <Builder key={edit?.id ?? edit?.name ?? 'new'} wf={edit && !edit.id ? { ...edit } : edit} onClose={() => setEdit(undefined)} onSave={() => { setEdit(undefined); reload(); }} />}
      </Modal>
      <Modal open={!!runWf} onClose={() => setRunWf(null)} title={`Run "${runWf?.name ?? ''}"`}>
        <form className="col" onSubmit={start}>
          <label className="f">Project folder<input list="wf-folders" value={cwd} onChange={(e) => setCwd(e.target.value)} /><datalist id="wf-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist></label>
          <label className="f">Input (replaces <code>{'{{input}}'}</code>)<textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setRunWf(null)}>Cancel</button><button className="btn primary" disabled={!cwd}>Start</button></div>
        </form>
      </Modal>
    </div>
  );
}
