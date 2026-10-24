import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Ev, type Session } from './api';

const short = (v: unknown, n = 120) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };

function ToolCard({ block, result }: { block: any; result?: any }) {
  const out = result && (typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2));
  return (
    <details className={`tool${result?.is_error ? ' err' : ''}`}>
      <summary>🔧 {block.name} <span className="dim">{short(block.input)}</span>{!result && ' …'}</summary>
      <pre>{JSON.stringify(block.input, null, 2)}</pre>
      {out && <pre className="out">{out}</pre>}
    </details>
  );
}

function Approval({ ev, done }: { ev: Ev; done?: { allow: boolean; expired?: boolean } }) {
  const [busy, setBusy] = useState(false);
  const answer = (allow: boolean) => { setBusy(true); api(`/api/approvals/${ev.data.request_id}`, { allow }).catch(() => setBusy(false)); };
  return (
    <div className="approval">
      <div>Allow <b>{ev.data.tool_name}</b>?</div>
      <pre>{JSON.stringify(ev.data.input, null, 2)}</pre>
      {done ? <div className="dim">{done.expired ? 'expired' : done.allow ? 'allowed' : 'denied'}</div> : (
        <div className="row"><button disabled={busy} onClick={() => answer(true)}>Allow</button><button disabled={busy} onClick={() => answer(false)}>Deny</button></div>
      )}
    </div>
  );
}

export function Chat({ session, events, partial }: { session: Session; events: Ev[]; partial: string }) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const running = session.status === 'running';

  const { results, approvalDone } = useMemo(() => {
    const results = new Map<string, any>(), approvalDone = new Map<string, any>();
    for (const e of events) {
      if (e.kind === 'tool_result') for (const b of e.data.content ?? []) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
      if (e.kind === 'approval_done') approvalDone.set(e.data.request_id, e.data);
    }
    return { results, approvalDone };
  }, [events]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, partial]);

  const send = () => {
    if (!text.trim() || running) return;
    stick.current = true;
    api(`/api/sessions/${session.id}/messages`, { text }).then(() => setText('')).catch(() => {});
  };

  return (
    <div className="chat">
      <header><b>{session.title || 'New chat'}</b> <span className="dim">{session.cwd}</span></header>
      <div className="log" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        {events.map((e) => {
          if (e.kind === 'user') return <div key={e.seq} className={`msg user${e.data.system ? ' system' : ''}`}>{e.data.system && <b>system · </b>}{e.data.text}</div>;
          if (e.kind === 'assistant') return (
            <div key={e.seq}>
              {(e.data.content ?? []).map((b: any, i: number) =>
                b.type === 'text' ? <div key={i} className="msg bot">{b.text}</div>
                : b.type === 'thinking' ? <details key={i} className="think"><summary>thinking</summary><pre>{b.thinking}</pre></details>
                : b.type === 'tool_use' ? <ToolCard key={i} block={b} result={results.get(b.id)} /> : null)}
            </div>
          );
          if (e.kind === 'approval') return <Approval key={e.seq} ev={e} done={approvalDone.get(e.data.request_id)} />;
          if (e.kind === 'result') return <div key={e.seq} className={`meta${e.data.is_error ? ' bad' : ''}`}>{e.data.is_error ? 'error · ' : ''}{(e.data.duration_ms / 1000).toFixed(1)}s · ${e.data.cost?.toFixed(3)}</div>;
          if (e.kind === 'notice') return <div key={e.seq} className={`notice${e.data.error ? ' bad' : ''}`}>{e.data.text}</div>;
          return null;
        })}
        {partial && <div className="msg bot">{partial}<span className="dim">▍</span></div>}
      </div>
      <div className="composer">
        <textarea value={text} placeholder={running ? 'Claude is working…' : 'Message Claude (Enter to send, Shift+Enter for newline)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        {running ? <button onClick={() => api(`/api/sessions/${session.id}/interrupt`, {})}>Stop</button> : <button onClick={send}>Go</button>}
      </div>
    </div>
  );
}
