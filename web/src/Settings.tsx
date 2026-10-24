import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

type Cli = { installed: boolean; loggedIn: boolean; version?: string; detail?: string };
const NAMES = ['claude', 'codex'] as const;

export function Settings() {
  const [clis, setClis] = useState<Record<string, Cli> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => fetch('/api/clis').then((r) => r.json()).then(setClis).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const install = async (n: string) => {
    setBusy(n + 'install'); setMsg(`Installing ${n}… (can take a minute)`);
    try {
      const r = await api<{ ok: boolean; output: string }>(`/api/clis/${n}/install`, {});
      setMsg(r.ok ? `${n} installed.` : `Install failed:\n${r.output}`);
    } catch (e) { setMsg(String(e)); }
    setBusy(null); load();
  };

  const login = async (n: string) => {
    setBusy(n + 'login'); setMsg(`Complete the ${n} login in the browser window that opened on this machine…`);
    try { await api(`/api/clis/${n}/login`, {}); } catch (e) { setMsg(String(e)); setBusy(null); return; }
    // ponytail: poll status for 2 min instead of tracking the login process.
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch('/api/clis').then((r) => r.json()).catch(() => null);
      if (s) setClis(s);
      if (s?.[n]?.loggedIn) { setMsg(`${n} logged in.`); break; }
    }
    setBusy(null);
  };

  return (
    <div className="pad settings">
      <h2>CLI setup</h2>
      {NAMES.map((n) => {
        const c = clis?.[n];
        return (
          <div key={n} className="clirow">
            <b>{n}</b>
            <span className={c?.installed ? 'ok' : 'bad'}>{!c ? '…' : c.installed ? `installed ${c.version ?? ''}` : 'not installed'}</span>
            <span className={c?.loggedIn ? 'ok' : 'dim'}>{c?.installed ? (c.loggedIn ? `✓ ${c.detail ?? 'logged in'}` : 'not logged in') : ''}</span>
            <button disabled={!!busy} onClick={() => install(n)}>{c?.installed ? 'Reinstall / update' : 'Install'}</button>
            <button disabled={!!busy || !c?.installed} onClick={() => login(n)}>{c?.loggedIn ? 'Re-login' : 'Login with subscription'}</button>
          </div>
        );
      })}
      {msg && <pre className="out">{msg}</pre>}
    </div>
  );
}
