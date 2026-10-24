import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../ctx';
import { Empty, Icon, IconBtn, Modal, Seg, Skeleton, ago, confirmDlg, toast, useFetch } from '../ui';

type Proj = { path: string; name: string; favorite?: boolean; instructions?: string; registered: boolean; sessions: number; lastUsed: number; isApp: boolean; repo: boolean; branch: string; remote: string; dirty: number; exists: boolean };
type FolderList = { path: string; parent: string; drives: string[]; folders: { name: string; path: string }[] };

export function Projects() {
  const { newChat, go } = useApp();
  const { data, loading, reload } = useFetch<{ projects: Proj[] }>('/api/projects');
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [add, setAdd] = useState(false);
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState<FolderList | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Proj | null>(null);
  const [instr, setInstr] = useState('');

  const list = useMemo(() => (data?.projects ?? []).filter((p) => (p.name + p.path).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.lastUsed - a.lastUsed), [data, q]);

  const post = (act: string, body: object) => api('/api/projects/' + act, body).then(reload);
  const fav = (p: Proj) => post('update', { path: p.path, favorite: !p.favorite });
  const browse = async (target = '') => {
    setBrowsing(true);
    try {
      const result = await api<FolderList>('/api/projects/folders?path=' + encodeURIComponent(target));
      setFolders(result); setPath(result.path);
    } catch { /* toast */ } finally { setBrowsing(false); }
  };

  const card = (p: Proj) => (
    <div key={p.path} className="card col" style={{ gap: 6 }}>
      <div className="row"><Icon n="folder" /><b className="grow ell" title={p.path}>{p.name}{p.isApp && <span className="badge" style={{ marginLeft: 6 }}>this app</span>}</b><IconBtn icon="star" label={p.favorite ? 'Remove favorite' : 'Favorite'} on={!!p.favorite} onClick={() => fav(p)} /></div>
      <div className="muted xs ell" title={p.path}>{p.path}</div>
      <div className="row small muted">
        {p.repo ? <span className="badge">{p.branch}{p.dirty ? ` · ${p.dirty} changed` : ''}</span> : <span className="badge">not a git repo</span>}
        <span>{p.sessions} chat{p.sessions === 1 ? '' : 's'}</span>{p.lastUsed > 0 && <span>· {ago(p.lastUsed)}</span>}
      </div>
      {p.remote && <div className="muted xs ell" title={p.remote}>{p.remote}</div>}
      {!p.exists && <div className="bad small">Folder no longer exists.</div>}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn primary sm" disabled={!p.exists} onClick={() => newChat({ cwd: p.path })}>Open</button>
        {p.repo && <button className="btn sm" onClick={() => go('git?cwd=' + encodeURIComponent(p.path))}>Changes</button>}
        <button className="btn sm" onClick={() => { setEdit(p); setInstr(p.instructions ?? ''); }}>Settings</button>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Projects</h1><p>Folders you've worked in, plus any you add.</p></div>
        <button className="btn primary" onClick={() => { setAdd(true); setFolders(null); setFolderName(''); void browse(); }}><Icon n="plus" /> Add project</button>
      </div>
      <div className="row">
        <input className="grow" type="search" aria-label="Search projects" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Seg label="Layout" value={layout} options={[['grid', 'Grid'], ['list', 'List']]} onChange={setLayout} />
      </div>
      {loading ? <Skeleton rows={4} /> : !list.length ? <div className="card"><Empty title="No projects" icon="folder">Add a folder, or start a chat in one.</Empty></div>
        : layout === 'grid' ? <div className="grid">{list.map(card)}</div> : (
          <div className="list">{list.map((p) => (
            <div key={p.path} className="hov">
              <IconBtn icon="star" label={p.favorite ? 'Remove favorite' : 'Favorite'} on={!!p.favorite} onClick={() => fav(p)} />
              <div className="grow" style={{ minWidth: 0 }}><div className="ell">{p.name}</div><div className="muted xs ell">{p.path}</div></div>
              <span className="muted xs hide-sm">{p.repo ? p.branch : 'no git'} · {p.sessions} chats</span>
              <button className="btn sm" onClick={() => newChat({ cwd: p.path })} disabled={!p.exists}>Open</button>
              <button className="btn sm" onClick={() => { setEdit(p); setInstr(p.instructions ?? ''); }}>Settings</button>
            </div>
          ))}</div>
        )}

      <Modal open={add} onClose={() => setAdd(false)} title="Add project">
        <form onSubmit={async (e) => { e.preventDefault(); try { await post('add', { path: path.trim() }); setAdd(false); setPath(''); } catch { /* toast */ } }}>
          <label className="f">Folder path<input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\code\my-project" /></label>
          <div className="row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn" disabled={browsing || creating} onClick={() => void browse(path.trim())}>Browse</button>
            <button type="button" className="btn" disabled={browsing || creating || !folders || folders.parent === folders.path} onClick={() => void browse(folders!.parent)}>Up</button>
            {folders && <select aria-label="Drive" value={folders.drives.find((d) => folders.path.toLowerCase().startsWith(d.toLowerCase())) ?? ''} disabled={browsing || creating} onChange={(e) => void browse(e.target.value)}>
              <option value="" disabled>Select drive</option>{folders.drives.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>}
          </div>
          {folders && <>
            <div className="muted xs" style={{ overflowWrap: 'anywhere', marginBottom: 6 }}>Current folder: {folders.path}</div>
            <div className="col" aria-label="Folders" aria-busy={browsing} style={{ maxHeight: 240, overflowY: 'auto', gap: 4, marginBottom: 12 }}>
              {folders.folders.map((f) => <button key={f.path} type="button" className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left' }} disabled={browsing || creating} onClick={() => void browse(f.path)}><Icon n="folder" /><span className="ell">{f.name}</span></button>)}
              {!folders.folders.length && <span className="muted small">No subfolders</span>}
            </div>
            <div className="row" style={{ marginBottom: 16 }}>
              <input className="grow" aria-label="New folder name" placeholder="New folder name" value={folderName} disabled={creating} onChange={(e) => setFolderName(e.target.value)} />
              <button type="button" className="btn" disabled={browsing || creating || !folderName.trim()} onClick={async () => {
                setCreating(true);
                try { const result = await api<{ path: string }>('/api/projects/mkdir', { path: folders.path, name: folderName.trim() }); setFolderName(''); await browse(result.path); }
                catch { /* toast */ } finally { setCreating(false); }
              }}>{creating ? 'Creating...' : 'New folder'}</button>
            </div>
          </>}
          {browsing && <p className="muted small" role="status">Loading folders...</p>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn primary" disabled={!path.trim() || browsing || creating}>Add</button></div>
        </form>
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`${edit?.name ?? ''} settings`}>
        <form onSubmit={async (e) => { e.preventDefault(); await post('update', { path: edit!.path, instructions: instr }); setEdit(null); toast('Project saved'); }}>
          <label className="f">Agent instructions for this project
            <textarea rows={6} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Sent with the first message of every new chat in this folder. e.g. coding conventions, test command." />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {edit?.registered && <button type="button" className="btn danger" onClick={async () => { if (await confirmDlg(`Remove "${edit.name}" from your project list? The folder and chats are not touched.`, 'Remove')) { await post('remove', { path: edit.path }); setEdit(null); } }}>Remove from list</button>}
            <span className="grow" /><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
