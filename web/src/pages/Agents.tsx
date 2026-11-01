import { useEffect, useState } from 'react';
import { api, type Cli } from '../api';
import { useApp } from '../ctx';
import { Icon, Skeleton, fmtDur, toast, useFetch } from '../ui';

const NAMES = ['claude', 'codex'] as const;
type LoginState = { running: boolean; exit: number | null; output: string };

function AgentCard({ name, cli, models, reload }: { name: (typeof NAMES)[number]; cli?: Cli; models: string[]; reload: () => void }) {
  const { settings, saveSettings } = useApp();
  const [path, setPath] = useState('');
  const [instr, setInstr] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { if (settings) { setPath(settings.cliPaths?.[name] ?? ''); setInstr(settings.instructions?.[name] ?? ''); setModel(settings.defaultModels?.[name] ?? ''); } }, [settings, name]);

  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); try { await fn(); } catch { /* toast */ } setBusy(''); };
  const test = () => run('test', async () => {
    const r = await api<Cli & { ms: number }>(`/api/clis/${name}/test`, {});
    setMsg(r.installed ? `${r.version} · ${r.loggedIn ? 'logged in' : 'not logged in'} · ${fmtDur(r.ms)}` : 'Executable not found or failed to run.');
    reload();
  });
  const install = () => run('install', async () => {
    setMsg(`Installing ${name}… (can take a minute)`);
    const r = await api<{ ok: boolean; output: string }>(`/api/clis/${name}/install`, {});
    setMsg(r.ok ? 'Installed.' : `Install failed:\n${r.output}`); reload();
  });
  const [login, setLogin] = useState<LoginState | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => { api<LoginState>(`/api/clis/${name}/login`).then((s) => s.running && setLogin(s)).catch(() => {}); }, [name]);
  const startLogin = () => run('login', async () => { setMsg(''); setCode(''); setLogin(await api<LoginState>(`/api/clis/${name}/login`, {})); });
  useEffect(() => {
    if (!login?.running) return;
    const t = setTimeout(async () => {
      const s = await api<LoginState>(`/api/clis/${name}/login`).catch(() => null);
      if (!s) return;
      setLogin(s);
      if (!s.running) { setMsg(s.exit === 0 ? 'Logged in.' : 'Login did not complete.'); reload(); }
    }, 2000);
    return () => clearTimeout(t);
  }, [login, name, reload]);
  const sendCode = () => run('code', async () => { await api(`/api/clis/${name}/login/code`, { code }); setCode(''); });
  const save = () => saveSettings({ cliPaths: { ...settings!.cliPaths, [name]: path.trim() }, instructions: { ...settings!.instructions, [name]: instr }, defaultModels: { ...settings!.defaultModels, [name]: model.trim() } }).then(() => { toast('Saved'); reload(); });
  const isDefault = settings?.defaultAgent === name;

  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="row">
        <h2 className="grow">{name === 'claude' ? 'Claude CLI' : 'Codex CLI'}</h2>
        {cli ? <span className={`badge ${cli.installed && cli.loggedIn ? 'ok' : cli.installed ? 'warn' : 'bad'}`}>{!cli.installed ? 'Not installed' : cli.loggedIn ? 'Connected' : 'Not logged in'}</span> : null}
        {isDefault ? <span className="badge">Default</span> : <button className="btn sm" onClick={() => saveSettings({ defaultAgent: name })}>Make default</button>}
      </div>
      {!cli ? <Skeleton rows={2} /> : <p className="muted small">{cli.installed ? `${cli.version ?? ''}${cli.detail ? ' · ' + cli.detail : ''}` : 'Not found on PATH.'}</p>}
      <label className="f">Executable path (blank = <code>{name}</code> from PATH)
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={name} />
      </label>
      <label className="f">Default model
        <input list={`dl-${name}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="CLI default" />
        <datalist id={`dl-${name}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <label className="f">Custom instructions (sent with the first message of each new {name} chat)
        <textarea rows={4} value={instr} onChange={(e) => setInstr(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary" onClick={save} disabled={!settings}>Save</button>
        <button className="btn" disabled={!!busy} onClick={test}><Icon n="refresh" /> Test connection</button>
        <button className="btn" disabled={!!busy} onClick={install}>{cli?.installed ? 'Update' : 'Install'}</button>
        <button className="btn" disabled={!!busy || !cli?.installed} onClick={startLogin}>{cli?.loggedIn ? 'Re-login' : 'Login with subscription'}</button>
      </div>
      {login?.output && (
        <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {login.output.trim().split(/(https?:\/\/\S+)/g).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}
        </pre>
      )}
      {login?.running && /paste code/i.test(login.output) && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) sendCode(); }}>
          <input className="grow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code from the sign-in page" aria-label="Login code" autoComplete="off" />
          <button className="btn primary" disabled={!!busy || !code.trim()}>Submit code</button>
        </form>
      )}
      {msg && <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }} role="status">{msg}</pre>}
    </section>
  );
}

export function Agents() {
  const { settings, saveSettings } = useApp();
  const { data: clis, reload } = useFetch<Record<string, Cli>>('/api/clis');
  const { data: models } = useFetch<Record<string, string[]>>('/api/models');
  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Agents</h1><p>Connect and configure the CLIs that do the work.</p></div></div>
      <div className="grid two" style={{ alignItems: 'start' }}>{NAMES.map((n) => <AgentCard key={n} name={n} cli={clis?.[n]} models={models?.[n] ?? (n === 'claude' ? ['opus', 'sonnet', 'haiku'] : [])} reload={reload} />)}</div>

      <section className="card col">
        <h2>Permission policy</h2>
        <label className="row"><input type="checkbox" checked={!!settings?.autoAllowReadOnly} disabled={!settings} onChange={(e) => saveSettings({ autoAllowReadOnly: e.target.checked })} />
          <span>Auto-allow read-only tools (Read, Glob, Grep, web search) for Claude</span></label>
        <p className="muted small">Everything else, including edits and shell commands, still asks. Codex runs non-interactively inside a workspace-write sandbox and never prompts.</p>
      </section>
      <section className="card col">
        <h2>MCP servers</h2>
        <p className="muted small">Not available yet: managing MCP servers needs a backend integration with each CLI's config. Both CLIs read their own MCP configuration, so servers you've set up there already work in chats.</p>
      </section>
    </div>
  );
}
