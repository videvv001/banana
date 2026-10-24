import { useState } from 'react';
import { SHORTCUTS, useApp } from '../ctx';
import { setPrefs, usePrefs } from '../prefs';
import { Icon, Seg, Skeleton, useFetch } from '../ui';

type Diag = { node: string; platform: string; uptimeSeconds: number; sessions: number; events: number; dbBytes: number; dataDir: string; appRoot: string; commit: string };
const ACCENTS: [string, string][] = [['default', '#6658ED'], ['blue', '#2f6fe4'], ['green', '#1f9d63'], ['rose', '#d6336c'], ['orange', '#e0701a']];
const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB';

export function Settings() {
  const { settings, saveSettings, go } = useApp();
  const prefs = usePrefs();
  const [tab, setTab] = useState<'general' | 'appearance' | 'agents' | 'keys' | 'advanced'>('general');
  const { data: diag } = useFetch<Diag>(tab === 'advanced' ? '/api/diagnostics' : null);
  const { data: pj } = useFetch<{ projects: { path: string; name: string }[] }>(tab === 'general' ? '/api/projects' : null);

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Settings</h1></div></div>
      <Seg label="Section" value={tab} onChange={setTab} options={[['general', 'General'], ['appearance', 'Appearance'], ['agents', 'Agents'], ['keys', 'Shortcuts'], ['advanced', 'Advanced']]} />

      {tab === 'general' && (
        <section className="card col" style={{ gap: 14 }}>
          {!settings ? <Skeleton /> : <>
            <label className="f">Default agent
              <select value={settings.defaultAgent} onChange={(e) => saveSettings({ defaultAgent: e.target.value })}><option value="claude">Claude</option><option value="codex">Codex</option></select>
            </label>
            <label className="f">Default project folder (blank = this app)
              <input list="dp" defaultValue={settings.defaultProject} key={settings.defaultProject} onBlur={(e) => e.target.value !== settings.defaultProject && saveSettings({ defaultProject: e.target.value.trim() })} />
              <datalist id="dp">{(pj?.projects ?? []).map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}</datalist>
            </label>
            <p className="muted small">Language: English only for now; the interface text isn't translated yet.</p>
          </>}
        </section>
      )}

      {tab === 'appearance' && (
        <section className="card col" style={{ gap: 16 }}>
          <div className="col"><b>Theme</b><Seg label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} /></div>
          <div className="col"><b>Accent color</b>
            <div className="row">{ACCENTS.map(([k, c]) => <button key={k} className="ibtn" aria-label={`Accent ${k}`} aria-pressed={prefs.accent === k} title={k} onClick={() => setPrefs({ accent: k })} style={{ background: c, border: prefs.accent === k ? '3px solid var(--text)' : '3px solid transparent', borderRadius: '50%' }} />)}</div>
            <span className="muted xs">Dark mode uses a lighter shade of the same hue.</span>
          </div>
          <label className="f">Font size: {prefs.fontSize}px<input type="range" min={13} max={18} value={prefs.fontSize} onChange={(e) => setPrefs({ fontSize: +e.target.value })} /></label>
          <label className="row"><input type="checkbox" checked={prefs.compactNav} onChange={(e) => setPrefs({ compactNav: e.target.checked })} /> Compact sidebar (icons only)</label>
          <div className="col"><b>Code display</b>
            <label className="row"><input type="checkbox" checked={prefs.wrapCode} onChange={(e) => setPrefs({ wrapCode: e.target.checked })} /> Wrap long lines</label>
            <label className="row"><input type="checkbox" checked={prefs.lineNumbers} onChange={(e) => setPrefs({ lineNumbers: e.target.checked })} /> Show line numbers</label>
            <label className="row"><input type="checkbox" checked={prefs.diffSplit} onChange={(e) => setPrefs({ diffSplit: e.target.checked })} /> Side-by-side diffs by default</label>
          </div>
          <p className="muted xs">Saved in this browser only.</p>
        </section>
      )}

      {tab === 'agents' && (
        <section className="card col">
          <p>CLI executable paths, default models, custom instructions and permission policy live on the Agents page.</p>
          <div><button className="btn primary" onClick={() => go('agents')}><Icon n="bot" /> Open Agents</button></div>
          <p className="muted small">Current default: <b>{settings?.defaultAgent ?? '…'}</b> · read-only auto-allow: <b>{settings?.autoAllowReadOnly ? 'on' : 'off'}</b></p>
        </section>
      )}

      {tab === 'keys' && (
        <section className="card col">
          <table><thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
            <tbody>{SHORTCUTS.map(([k, label]) => <tr key={k}><td>{label}</td><td><span className="kbd">Alt</span> + <span className="kbd">{k.toUpperCase()}</span></td></tr>)}</tbody></table>
          <p className="muted xs">Shortcuts are fixed for now; rebinding isn't supported yet.</p>
        </section>
      )}

      {tab === 'advanced' && (
        <section className="card col" style={{ gap: 14 }}>
          {!diag ? <Skeleton rows={4} /> : <>
            <div><b>Data storage</b><p className="muted small">{diag.sessions} sessions, {diag.events} events, database {mb(diag.dbBytes)}<br /><code>{diag.dataDir}</code></p></div>
            <div><b>Diagnostics</b><p className="muted small">Node {diag.node} · {diag.platform} · agent-host up {Math.round(diag.uptimeSeconds / 60)} min<br /><code>{diag.appRoot}</code></p></div>
            <div><b>Application version</b><p className="muted small">{diag.commit || 'unknown'}<br />Updates happen through git; there's no in-app updater.</p></div>
            <div><b>Logging</b><p className="muted small">Service logs are available on the Terminal & Logs page.</p><button className="btn" onClick={() => go('terminal?tab=logs')}><Icon n="terminal" /> Open logs</button></div>
            <div><b>Cache</b><p className="muted small">The server keeps no cache to clear; chat history is the database above.</p></div>
          </>}
        </section>
      )}
    </div>
  );
}
