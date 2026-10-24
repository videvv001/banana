import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { usePrefs } from './prefs';

// ---- icons (24px stroke set) ----
const P: Record<string, string> = {
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bot: 'M12 3v3M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6',
  tasks: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9',
  flow: 'M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v3a2 2 0 0 0 2 2H14',
  git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14', menu: 'M4 6h16M4 12h16M4 18h16', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5L20 7',
  terminal: 'M4 17l6-6-6-6M12 19h8', columns: 'M4 4h7v16H4zM13 4h7v16h-7z', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  pin: 'M12 17v5M9 3h6l-1 6 3 4H7l3-4z', archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10', file: 'M6 2h8l5 5v15H6zM14 2v6h5', send: 'M12 19V5M5 12l7-7 7 7',
  stop: 'M6 6h12v12H6z', refresh: 'M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', download: 'M12 4v12M6 12l6 6 6-6M4 20h16', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  clip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7', sidebar: 'M3 4h18v16H3zM9 4v16',
  play: 'M7 4l13 8-13 8z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};
export const Icon = ({ n }: { n: string }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={P[n] ?? ''} /></svg>;
export const IconBtn = ({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick?: () => void; on?: boolean; disabled?: boolean }) => (
  <button className={`ibtn${on ? ' on' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}><Icon n={icon} /></button>
);

// ---- toasts + confirm: fired from anywhere, rendered by <Hosts/> in App ----
export const toast = (msg: string, kind: 'ok' | 'error' = 'ok') => window.dispatchEvent(new CustomEvent('toast', { detail: { msg, kind } }));
export const confirmDlg = (msg: string, okLabel = 'Delete') =>
  new Promise<boolean>((resolve) => window.dispatchEvent(new CustomEvent('confirm', { detail: { msg, okLabel, resolve } })));

export function Hosts() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [ask, setAsk] = useState<{ msg: string; okLabel: string; resolve: (v: boolean) => void } | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const { msg, kind } = (e as CustomEvent).detail, id = ++n;
      setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 3500);
    };
    const onAsk = (e: Event) => setAsk((e as CustomEvent).detail);
    window.addEventListener('toast', onToast); window.addEventListener('confirm', onAsk);
    return () => { window.removeEventListener('toast', onToast); window.removeEventListener('confirm', onAsk); };
  }, []);
  useEffect(() => { if (ask) dlg.current?.showModal(); }, [ask]);
  const close = (v: boolean) => { dlg.current?.close(); ask?.resolve(v); setAsk(null); };
  return (
    <>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}><span className="grow">{t.msg}</span><button className="ibtn" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><Icon n="x" /></button></div>)}
      </div>
      <dialog ref={dlg} onCancel={(e) => { e.preventDefault(); close(false); }}>
        <div className="body">
          <p>{ask?.msg}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => close(false)}>Cancel</button>
            <button className="btn primary" autoFocus onClick={() => close(true)}>{ask?.okLabel}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

// ---- small components ----
export const Badge = ({ children, kind = '' }: { children: ReactNode; kind?: string }) => <span className={`badge ${kind}`}>{children}</span>;
export const Agent = ({ p }: { p: string }) => <Badge kind={p}>{p === 'codex' ? 'Codex' : 'Claude'}</Badge>;
export const Dot = ({ s }: { s: string }) => <span className={`dot ${s === 'running' ? 'run' : s === 'done' || s === 'ok' ? 'ok' : s === 'failed' || s === 'bad' ? 'bad' : ''}`} aria-hidden="true" />;
export const Empty = ({ title, children, icon }: { title: string; children?: ReactNode; icon?: string }) => (
  <div className="empty">{icon && <Icon n={icon} />}<h3>{title}</h3>{children && <div>{children}</div>}</div>
);
export const Skeleton = ({ rows = 3 }: { rows?: number }) => <div className="col" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - i * 12}%` }} />)}</div>;
export const Seg = <T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) => (
  <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
);

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="body"><h2>{title}</h2>{open && children}</div>
    </dialog>
  );
}

export function Drawer({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside className="drawer" role="complementary" aria-label={title}>
      <header><b className="grow ell">{title}</b>{actions}<IconBtn icon="x" label="Close" onClick={onClose} /></header>
      <div className="content">{children}</div>
    </aside>
  );
}

// ---- helpers ----
export const fmtDur = (ms?: number | null) => ms == null ? '—' : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
export const ago = (ts: number) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
// Titles are the first message text; strip markdown noise for display.
export const cleanTitle = (t: string) => (t || '').replace(/^[#*>\s|_-]+/, '').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim() || 'New chat';
export const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
export const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Copy failed', 'error'));
export const download = (name: string, text: string, type = 'text/markdown') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// Fetch a GET endpoint; optional polling. `url === null` skips.
export function useFetch<T>(url: string | null, pollMs = 0) {
  // Results are tagged with the url they belong to, so a url change never shows the previous url's data (or an empty flash).
  const [res, setRes] = useState<{ url: string | null; data: T | null; error: string }>({ url: null, data: null, error: '' });
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url);
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? String(r.status));
      const data = await r.json();
      setRes({ url, data, error: '' });
    } catch (e) { setRes((p) => ({ url, data: p.url === url ? p.data : null, error: String((e as Error).message) })); }
  }, [url]);
  useEffect(() => { load(); if (!pollMs) return; const id = setInterval(load, pollMs); return () => clearInterval(id); }, [load, pollMs]);
  const cur = res.url === url;
  return { data: cur ? res.data : null, loading: !!url && !cur, error: cur ? res.error : '', reload: load };
}

// ---- code highlighting (tiny tokenizer; good enough for display, not parsing) ----
const KW = /^(?:const|let|var|function|return|if|else|for|while|import|from|export|default|class|new|async|await|try|catch|throw|switch|case|break|continue|type|interface|extends|implements|public|private|static|def|elif|None|True|False|self|lambda|with|as|in|is|not|and|or|fn|pub|use|mut|impl|struct|enum|match|go|func|package|true|false|null|undefined|void|int|string|bool|echo|fi|then|do|done)$/;
const TOK = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_]\w*)/g;
function highlight(code: string, lang: string): ReactNode[] {
  if (/^(diff|patch)$/.test(lang)) return code.split('\n').map((l, i) => <Fragment key={i}>{i ? '\n' : ''}<span className={l[0] === '+' ? 'ts' : l[0] === '-' ? 'tk' : ''}>{l}</span></Fragment>);
  const out: ReactNode[] = []; let last = 0, m: RegExpExecArray | null;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? 'tc' : m[2] ? 'ts' : m[3] ? 'tn' : KW.test(m[4]) ? 'tk' : '';
    // '#' only starts a comment in languages that use it (avoid colouring CSS ids / md headings oddly)
    out.push(m[1]?.startsWith('#') && !/^(py|python|sh|bash|shell|yaml|yml|toml|rb|ruby|ps1|powershell|)$/.test(lang) ? m[0] : cls ? <span key={m.index} className={cls}>{m[0]}</span> : m[0]);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, lang = '' }: { code: string; lang?: string }) {
  const prefs = usePrefs();
  const lines = code.replace(/\n$/, '');
  return (
    <div className={`codeblock${prefs.wrapCode ? ' wrap' : ''}`}>
      <header><span>{lang || 'text'}</span><button className="btn ghost sm" onClick={() => copy(lines)} aria-label="Copy code"><Icon n="copy" /> Copy</button></header>
      <pre><code>{prefs.lineNumbers ? lines.split('\n').map((l, i) => <div key={i}><span className="ln">{i + 1}</span>{highlight(l, lang)}</div>) : highlight(lines, lang)}</code></pre>
    </div>
  );
}

// ---- markdown (headings, lists, tables, fences, inline code/bold/italic/links; no raw HTML ever) ----
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = []; const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<code key={m.index}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={m.index}>{m[2].slice(2, -2)}</b>);
    else if (m[3]) out.push(<i key={m.index}>{m[3].slice(1, -1)}</i>);
    else out.push(/^https?:\/\//.test(m[5]) ? <a key={m.index} href={m[5]} target="_blank" rel="noopener noreferrer">{m[4]}</a> : <span key={m.index}>{m[4]}</span>);
    last = m.index + m[0].length;
  }
  out.push(s.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n'), out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^```(\w*)/.exec(l);
    if (fence) { const buf: string[] = []; for (i++; i < lines.length && !lines[i].startsWith('```'); i++) buf.push(lines[i]); out.push(<CodeBlock key={i} code={buf.join('\n')} lang={fence[1]} />); continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(l);
    if (h) { const T = (`h${h[1].length}`) as 'h1'; out.push(<T key={i}>{inline(h[2])}</T>); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l), rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(<table key={i}><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+/.exec(l);
    if (li) {
      const ordered = /\d/.test(li[1]), items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i--;
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    if (!l.trim()) continue;
    const para = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(```|#{1,3}\s|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i + 1])) para.push(lines[++i]);
    out.push(<p key={i}>{para.flatMap((p, j) => [j ? <br key={'b' + j} /> : null, ...inline(p)])}</p>);
  }
  return <>{out}</>;
}

// ---- diff viewer: unified or side-by-side ----
export function DiffView({ diff, split }: { diff: string; split?: boolean }) {
  if (!diff.trim()) return <div className="muted small">No textual changes.</div>;
  const lines = diff.split('\n');
  const cls = (l: string) => l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('@@') ? 'h' : l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : '';
  if (!split) return <div className="diff">{lines.map((l, i) => <div key={i} className={cls(l)}>{l || ' '}</div>)}</div>;
  const L: [string, string][] = [], R: [string, string][] = [];
  let del: string[] = [], add: string[] = [];
  const flush = () => { const n = Math.max(del.length, add.length); for (let i = 0; i < n; i++) { L.push([del[i] ?? '', del[i] != null ? 'd' : '']); R.push([add[i] ?? '', add[i] != null ? 'a' : '']); } del = []; add = []; };
  for (const l of lines) {
    const c = cls(l);
    if (c === 'h') { flush(); L.push([l, 'h']); R.push([l, 'h']); }
    else if (c === 'd') del.push(l); else if (c === 'a') add.push(l);
    else { flush(); L.push([l, '']); R.push([l, '']); }
  }
  flush();
  return <div className="diff split">{[L, R].map((side, k) => <div key={k}>{side.map(([t, c], i) => <div key={i} className={c}>{t || ' '}</div>)}</div>)}</div>;
}

export { api };
