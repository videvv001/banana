import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs, type Ev, type Session } from '../api';
import { useApp } from '../ctx';
import { blocks, changedFiles, langOf, sessionToMarkdown, shell } from '../lib';
import { Agent, CodeBlock, Drawer, Icon, IconBtn, Markdown, base, cleanTitle, copy, download, fmtDur, useFetch } from '../ui';

const short = (v: unknown, n = 110) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };

function ToolCard({ block, result }: { block: any; result?: any }) {
  const out = result && (typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2));
  return (
    <details className={`tool${result?.is_error ? ' err' : ''}`}>
      <summary><Icon n="terminal" /> {block.name} <span className="muted">{shell(block) || block.input?.file_path || block.input?.pattern || short(block.input)}</span>{!result && ' …'}</summary>
      <pre>{JSON.stringify(block.input, null, 2)}</pre>
      {out && <pre>{out}</pre>}
    </details>
  );
}

function Approval({ ev, done }: { ev: Ev; done?: { allow: boolean; expired?: boolean } }) {
  const [busy, setBusy] = useState(false);
  const { tool_name, input } = ev.data;
  const answer = (allow: boolean) => { setBusy(true); api(`/api/approvals/${ev.data.request_id}`, { allow }).catch(() => setBusy(false)); };
  const summary = input?.command ?? input?.file_path ?? input?.url ?? input?.pattern ?? '';
  return (
    <div className="approval" role="group" aria-label={`Approval request for ${tool_name}`}>
      <div><b>{tool_name}</b> {summary && <code className="small">{short(summary, 200)}</code>}</div>
      <details><summary className="muted small">Details</summary><pre>{JSON.stringify(input, null, 2)}</pre></details>
      {done ? <div className="muted small">{done.expired ? 'Expired' : done.allow ? 'Allowed' : 'Denied'}</div> : (
        <div className="row"><button className="btn primary sm" disabled={busy} onClick={() => answer(true)}>Allow</button><button className="btn sm" disabled={busy} onClick={() => answer(false)}>Deny</button></div>
      )}
    </div>
  );
}

function FilesDrawer({ session, modified, open, onClose, initial }: { session: Session; modified: string[]; open: boolean; onClose: () => void; initial: string | null }) {
  const [sel, setSel] = useState<string | null>(initial);
  const [q, setQ] = useState('');
  useEffect(() => { if (initial) setSel(initial); }, [initial]);
  const { data: found } = useFetch<{ files: string[] }>(open ? `/api/files?${qs({ cwd: session.cwd, q })}` : null);
  const { data: file, loading, error } = useFetch<{ content?: string; binary?: boolean; truncated?: boolean }>(open && sel ? `/api/file?${qs({ cwd: session.cwd, path: sel })}` : null);
  return (
    <Drawer open={open} onClose={onClose} title={sel ?? 'Files'} actions={sel ? <IconBtn icon="x" label="Back to list" onClick={() => setSel(null)} /> : undefined}>
      {sel ? (
        loading ? <p className="muted">Loading…</p> : error ? <p className="bad">{error}</p> : file?.binary ? <p className="muted">Binary file.</p>
          : <>{file?.truncated && <p className="muted small">Showing the first 300 KB.</p>}<CodeBlock code={file?.content ?? ''} lang={langOf(sel)} /></>
      ) : (
        <div className="col">
          {modified.length > 0 && <><h3>Modified in this chat</h3><div className="row">{modified.map((f) => <button key={f} className="chip" onClick={() => setSel(f)}>{f}</button>)}</div></>}
          <h3>Project files</h3>
          <input aria-label="Search files" placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="list">{(found?.files ?? []).map((f) => <button key={f} className="hov btn ghost" style={{ justifyContent: 'flex-start', fontFamily: 'var(--mono)', fontSize: '.8rem' }} onClick={() => setSel(f)}>{f}</button>)}</div>
        </div>
      )}
    </Drawer>
  );
}

export function Chat({ session }: { session: Session }) {
  const { events, partial, loadSession, refresh, online, go } = useApp();
  const draftKey = `chat-draft:${session.id}`;
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(draftKey) ?? ''; } catch { return ''; }
  });
  const setDraft = (value: string) => {
    setText(value);
    try { if (value) localStorage.setItem(draftKey, value); else localStorage.removeItem(draftKey); } catch { /* storage may be unavailable */ }
  };
  const [images, setImages] = useState<{ media_type: string; data: string }[]>([]);
  const [files, setFiles] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [term, setTerm] = useState(false);
  const [pick, setPick] = useState(false);
  const [pq, setPq] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = session.status === 'running';

  useEffect(() => { loadSession(session.id).catch(() => {}); }, [session.id, online, loadSession]);
  const evs = useMemo(() => [...events.values()].filter((e) => e.session_id === session.id).sort((a, b) => a.seq! - b.seq!), [events, session.id]);
  const fresh = !session.started && !evs.some((e) => e.kind === 'user');

  const { results, approvalDone } = useMemo(() => {
    const results = new Map<string, any>(), approvalDone = new Map<string, any>();
    for (const e of evs) {
      if (e.kind === 'tool_result') for (const b of e.data.content ?? []) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
      if (e.kind === 'approval_done') approvalDone.set(e.data.request_id, e.data);
    }
    return { results, approvalDone };
  }, [evs]);

  const modified = useMemo(() => changedFiles(evs, session.cwd), [evs, session.cwd]);
  const shells = useMemo(() => evs.flatMap((e) => blocks(e).filter((b) => b.type === 'tool_use' && shell(b)).map((b) => ({ id: b.id, cmd: shell(b), out: results.get(b.id) }))), [evs, results]);
  const last = evs[evs.length - 1];
  const failed = !running && last && ((last.kind === 'result' && last.data.is_error) || (last.kind === 'notice' && last.data.error));
  const lastUser = [...evs].reverse().find((e) => e.kind === 'user' && !e.data.system);

  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [evs, partial]);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; } }, [text]);

  const send = (msg = text, imgs = images) => {
    if ((!msg.trim() && !imgs.length) || running) return;
    stick.current = true;
    api(`/api/sessions/${session.id}/messages`, { text: msg, images: imgs }).then(() => {
      setText((current) => current === msg ? '' : current);
      try { if (localStorage.getItem(draftKey) === msg) localStorage.removeItem(draftKey); } catch { /* storage may be unavailable */ }
      setImages([]);
    }).catch(() => {});
  };
  const addImages = (list: File[]) => {
    for (const f of list) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) continue;
      const r = new FileReader();
      r.onload = () => setImages((a) => [...a, { media_type: f.type, data: String(r.result).split(',')[1] }]);
      r.readAsDataURL(f);
    }
  };
  const onPaste = (e: React.ClipboardEvent) => { const fs = Array.from(e.clipboardData.files); if (fs.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); addImages(fs); } };
  const setAgent = (provider: string, model: string) => api(`/api/sessions/${session.id}/update`, { provider, model }).then(() => refresh());
  const { data: models } = useFetch<Record<string, string[]>>(fresh ? '/api/models' : null);
  const { data: pickRes } = useFetch<{ files: string[] }>(pick ? `/api/files?${qs({ cwd: session.cwd, q: pq })}` : null);
  const showFile = (f: string) => { setOpenFile(f); setFiles(true); };

  // Per-turn "modified files" summary is attached to that turn's result event.
  const turnStart = (i: number) => { let j = i; while (j > 0 && evs[j - 1].kind !== 'user') j--; return j; };

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="grow ell"><b>{cleanTitle(session.title)}</b> <span className="muted small">· {base(session.cwd)}</span></span>
        <Agent p={session.provider} />{session.model && <span className="muted small">{session.model}</span>}
        <IconBtn icon="file" label="Files" onClick={() => { setOpenFile(null); setFiles(true); }} />
        <IconBtn icon="terminal" label="Command output" on={term} onClick={() => setTerm((v) => !v)} />
        <IconBtn icon="git" label="Review changes (Alt+R)" onClick={() => go('git?' + qs({ cwd: session.cwd }))} />
        <IconBtn icon="download" label="Export as Markdown" onClick={() => download(`${(session.title || 'chat').replace(/[^\w-]+/g, '_').slice(0, 40)}.md`, sessionToMarkdown(session, evs))} />
      </div>
      <div className="log" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        <div className="thread">
          {fresh && (
            <div className="empty">
              <h2 style={{ color: 'var(--text)' }}>What should we work on?</h2>
              <p>{session.provider === 'codex' ? 'Codex' : 'Claude'} will work in <code>{session.cwd}</code></p>
            </div>
          )}
          {evs.map((e, i) => {
            if (e.kind === 'user') return <div key={e.seq} className={`msg user${e.data.system ? ' system' : ''}`}>{e.data.system && <b>system · </b>}{(e.data.images ?? []).map((im: any, k: number) => <img key={k} alt="attachment" className="thumb" src={`data:${im.media_type};base64,${im.data}`} />)}{e.data.text}</div>;
            if (e.kind === 'assistant') return (
              <div key={e.seq} className="col">
                {blocks(e).map((b, k) =>
                  b.type === 'text' ? (
                    <div key={k} className="botwrap"><div className="msg bot"><Markdown text={b.text} /></div><div className="msgtools"><IconBtn icon="copy" label="Copy message" onClick={() => copy(b.text)} /></div></div>
                  ) : b.type === 'thinking' ? (b.thinking ? <details key={k} className="think"><summary>Thinking</summary><pre>{b.thinking}</pre></details> : null)
                  : b.type === 'tool_use' ? <ToolCard key={k} block={b} result={results.get(b.id)} /> : null)}
              </div>
            );
            if (e.kind === 'approval') return <Approval key={e.seq} ev={e} done={approvalDone.get(e.data.request_id)} />;
            if (e.kind === 'result') {
              const files = changedFiles(evs.slice(turnStart(i), i), session.cwd);
              return (
                <div key={e.seq} className="col">
                  <div className={`meta${e.data.is_error ? ' bad' : ''}`}>{e.data.is_error ? 'Error · ' : ''}{fmtDur(e.data.duration_ms)}{e.data.cost != null && ` · $${e.data.cost.toFixed(3)}`}</div>
                  {files.length > 0 && (
                    <div className="changes" role="group" aria-label="Modified files">
                      <span className="small"><b>{files.length}</b> file{files.length > 1 ? 's' : ''} modified</span>
                      {files.slice(0, 6).map((f) => <button key={f} className="chip" onClick={() => showFile(f)}>{base(f)}</button>)}
                      {files.length > 6 && <span className="muted small">+{files.length - 6}</span>}
                      <span className="grow" />
                      <button className="btn sm" onClick={() => go('git?' + qs({ cwd: session.cwd }))}>Review changes</button>
                    </div>
                  )}
                </div>
              );
            }
            if (e.kind === 'notice') return <div key={e.seq} className={`notice${e.data.error ? ' bad' : ''}`}>{e.data.text}</div>;
            return null;
          })}
          {partial[session.id] && <div className="msg bot"><Markdown text={partial[session.id]} /><span className="muted">▍</span></div>}
          {running && !partial[session.id] && <div className="muted small"><span className="dot run" /> Working…</div>}
          {failed && lastUser && <div><button className="btn sm" onClick={() => send(lastUser.data.text, lastUser.data.images ?? [])}><Icon n="refresh" /> Retry last message</button></div>}
        </div>
      </div>

      {term && (
        <div className="termpanel" role="region" aria-label="Command output">
          <header><Icon n="terminal" /><b className="grow">Commands in this chat</b><button className="btn ghost sm" style={{ color: 'inherit' }} onClick={() => go('terminal?' + qs({ cwd: session.cwd }))}>Open terminal</button><IconBtn icon="x" label="Close panel" onClick={() => setTerm(false)} /></header>
          <div className="content">
            {!shells.length && <span className="muted">No commands yet.</span>}
            {shells.slice(-12).map((s) => <div key={s.id} style={{ marginBottom: 8 }}><pre className="mono small" style={{ margin: 0, color: '#8fd3ff', whiteSpace: 'pre-wrap' }}>$ {s.cmd}</pre><pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{s.out ? (typeof s.out.content === 'string' ? s.out.content : JSON.stringify(s.out.content)) : 'running…'}</pre></div>)}
          </div>
        </div>
      )}

      <div className="composer-wrap">
        <div className="composer">
          {images.length > 0 && (
            <div className="previews">{images.map((im, i) => <span key={i} className="preview"><img alt="to send" className="thumb" src={`data:${im.media_type};base64,${im.data}`} /><button aria-label="Remove image" onClick={() => setImages((a) => a.filter((_, j) => j !== i))}>×</button></span>)}</div>
          )}
          <textarea ref={ta} rows={1} aria-label="Message" value={text} placeholder={running ? `${session.provider === 'codex' ? 'Codex' : 'Claude'} is working…` : 'Message (Enter to send, Shift+Enter for newline, paste images)'}
            onChange={(e) => setDraft(e.target.value)} onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <div className="bar" style={{ position: 'relative' }}>
            <label className="ibtn" title="Attach image" style={{ cursor: 'pointer' }}><Icon n="clip" /><span className="sr">Attach image</span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            </label>
            <IconBtn icon="file" label="Add file reference" onClick={() => setPick((v) => !v)} on={pick} />
            {pick && (
              <div className="popover">
                <input aria-label="Search files" autoFocus placeholder="Find a file to reference…" value={pq} onChange={(e) => setPq(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                {(pickRes?.files ?? []).map((f) => <button key={f} onClick={() => { setDraft(`${text}${text && !/\s$/.test(text) ? ' ' : ''}@${f} `); setPick(false); setPq(''); ta.current?.focus(); }}>{f}</button>)}
              </div>
            )}
            {fresh && models ? (
              <>
                <select aria-label="Agent" value={session.provider} onChange={(e) => setAgent(e.target.value, '')}><option value="claude">Claude</option><option value="codex">Codex</option></select>
                <input aria-label="Model" list="chat-models" className="small" style={{ padding: '3px 8px', width: 140 }} defaultValue={session.model} placeholder="model (default)" onBlur={(e) => e.target.value !== session.model && setAgent(session.provider, e.target.value.trim())} />
                <datalist id="chat-models">{(models[session.provider] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </>
            ) : <span className="muted xs" style={{ padding: '0 6px' }}>{session.provider === 'codex' ? 'Codex' : 'Claude'}{session.model ? ` · ${session.model}` : ''}</span>}
            <span className="grow" />
            {running
              ? <button className="btn" onClick={() => api(`/api/sessions/${session.id}/interrupt`, {})}><Icon n="stop" /> Stop</button>
              : <button className="btn primary" disabled={!text.trim() && !images.length} onClick={() => send()} aria-label="Send"><Icon n="send" /></button>}
          </div>
        </div>
      </div>
      <FilesDrawer session={session} modified={modified} open={files} onClose={() => setFiles(false)} initial={openFile} />
    </div>
  );
}
