// Routes beyond chat turns: git, files, terminal, projects, settings, tasks, analytics, compare, workflows.
// Everything that touches a folder is fenced to known roots (app, session cwds, registered projects).
import { execFile, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SETTING_KEYS = ['defaultAgent', 'defaultProject', 'instructions', 'autoAllowReadOnly', 'cliPaths', 'defaultModels'];
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'TodoWrite']);

export function createApi({ store, appRoot, dataDir, sendMessage, interrupt, isRunning, onTurnEnd }) {
  const settings = () => ({ defaultAgent: 'claude', defaultProject: '', instructions: { claude: '', codex: '' }, autoAllowReadOnly: false, cliPaths: { claude: '', codex: '' }, defaultModels: { claude: '', codex: '' }, ...store.kvGet('settings', {}) });
  const projects = () => store.kvGet('projects', {});
  const roots = () => new Set([appRoot, ...store.listSessions().map((s) => s.cwd), ...Object.keys(projects())].map((p) => path.resolve(p)));
  const okCwd = (c) => typeof c === 'string' && c !== '' && roots().has(path.resolve(c));
  // A relative path that stays inside its root.
  const safeRel = (r) => typeof r === 'string' && r !== '' && !path.isAbsolute(r) && !r.split(/[\\/]/).includes('..');
  const git = (cwd, args) => new Promise((resolve) => execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, maxBuffer: 20e6, timeout: 30000, windowsHide: true },
    (err, stdout, stderr) => resolve({ ok: !err, out: stdout, err: (stderr || err?.message || '').trim() })));

  // ---- turns (tasks + analytics are derived from the event log; there is no separate queue) ----
  function turns() {
    const sess = new Map(store.listSessions().map((s) => [s.id, s]));
    const open = new Map(), done = [];
    for (const e of store.turnEvents()) {
      const s = sess.get(e.session_id);
      if (!s) continue;
      if (e.kind === 'user') {
        const prev = open.get(e.session_id);
        if (prev) done.push({ ...prev, status: 'failed', detail: 'no result recorded', end: e.ts });
        open.set(e.session_id, { session: s.id, title: s.title, provider: s.provider, cwd: s.cwd, prompt: String(e.data.text ?? '').slice(0, 200), start: e.ts, system: !!e.data.system });
      } else if (e.kind === 'result' && open.has(e.session_id)) {
        const t = open.get(e.session_id); open.delete(e.session_id);
        const u = e.data.usage;
        done.push({ ...t, status: e.data.is_error ? 'failed' : 'done', end: e.ts, durationMs: e.data.duration_ms, cost: e.data.cost ?? null,
          tokens: u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) : null, detail: e.data.is_error ? String(e.data.result ?? '').slice(0, 300) : '' });
      } else if (e.kind === 'notice' && e.data.error && open.has(e.session_id)) {
        const t = open.get(e.session_id); open.delete(e.session_id);
        done.push({ ...t, status: 'failed', end: e.ts, detail: String(e.data.text).slice(0, 300) });
      }
    }
    for (const t of open.values()) done.push({ ...t, status: sess.get(t.session)?.status === 'running' ? 'running' : 'failed', detail: sess.get(t.session)?.status === 'running' ? '' : 'no result recorded' });
    return done.sort((a, b) => b.start - a.start);
  }

  // ---- terminal (one-shot commands, not a PTY) ----
  const term = new Map(); // id -> entry
  const killTree = (pid) => { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); else process.kill(pid); };
  function termRun(cwd, command, tab) {
    const id = crypto.randomUUID();
    const e = { id, cwd, command, tab: String(tab || '1').slice(0, 20), ts: Date.now(), running: true, code: null, out: '' };
    term.set(id, e);
    if (term.size > 60) term.delete(term.keys().next().value);
    const p = spawn(command, { cwd, shell: true, windowsHide: true });
    e.pid = p.pid;
    const add = (d) => { e.out = (e.out + d).slice(-200000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { add('\n[timed out after 120s]'); try { killTree(p.pid); } catch { /* gone */ } }, 120000);
    p.on('error', (err) => add(err.message));
    p.on('close', (code) => { clearTimeout(timer); e.running = false; e.code = code; e.ms = Date.now() - e.ts; });
    return e;
  }

  // ---- compare: one git worktree per agent so concurrent runs can't touch each other's files ----
  async function startCompare({ cwd, prompt, claudeModel = '', codexModel = '' }) {
    const head = await git(cwd, ['rev-parse', '--verify', 'HEAD']);
    if (!head.ok) throw new Error('Compare needs a git repository with at least one commit (each agent runs in its own worktree).');
    const group = crypto.randomUUID(), ids = [];
    for (const [provider, model] of [['claude', claudeModel], ['codex', codexModel]]) {
      const dir = path.join(dataDir, 'worktrees', group.slice(0, 8), provider);
      const r = await git(cwd, ['worktree', 'add', '-b', `vbcmp/${group.slice(0, 8)}-${provider}`, dir, 'HEAD']);
      if (!r.ok) throw new Error(`worktree failed: ${r.err}`);
      const id = crypto.randomUUID();
      store.createSession(id, dir, provider, model);
      store.setCmp(id, group);
      ids.push(id);
    }
    ids.forEach((id) => sendMessage(id, prompt));
    return { group, sessions: ids };
  }

  // ---- workflows ----
  const runs = () => store.kvGet('runs', []);
  const saveRuns = (r) => store.kvSet('runs', r.slice(0, 50));
  const lastText = (sid) => {
    const evs = store.sessionEvents(sid);
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i].kind === 'assistant') {
      const t = (evs[i].data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (t) return t;
    }
    return '';
  };
  const lastFailed = (sid) => [...store.sessionEvents(sid)].reverse().find((e) => e.kind === 'result')?.data.is_error ?? true;
  const mutate = (id, fn) => { const all = runs(); const r = all.find((x) => x.id === id); if (r) { fn(r); saveRuns(all); } return r; };

  function advance(runId) {
    mutate(runId, (r) => {
      const st = r.steps[r.step];
      if (!st) { r.status = 'done'; r.endedAt = Date.now(); return; }
      if (st.approve && !st.approved) { r.status = 'waiting'; return; }
      const prev = r.step ? r.steps[r.step - 1].output : '';
      const prompt = st.prompt.replaceAll('{{input}}', r.input).replaceAll('{{prev}}', prev);
      const id = crypto.randomUUID();
      store.createSession(id, r.cwd, st.provider, st.model || '');
      st.sessionId = id; st.status = 'running'; r.status = 'running';
      if (sendMessage(id, prompt) !== 202) { st.status = 'failed'; r.status = 'failed'; r.endedAt = Date.now(); }
    });
  }
  onTurnEnd((sid) => {
    const r = runs().find((x) => x.status === 'running' && x.steps.some((s) => s.sessionId === sid && s.status === 'running'));
    if (!r) return;
    const failed = lastFailed(sid), out = lastText(sid);
    mutate(r.id, (x) => {
      const st = x.steps[x.step];
      st.output = out; st.status = failed ? 'failed' : 'done';
      if (failed) { x.status = 'failed'; x.endedAt = Date.now(); } else x.step++;
    });
    if (!failed) advance(r.id);
  });
  for (const r of runs()) if (r.status === 'running') mutate(r.id, (x) => { x.status = 'failed'; x.endedAt = Date.now(); x.steps[x.step].status = 'failed'; x.steps[x.step].output = 'agent host restarted'; });

  // ---- handler ----
  return {
    settings,
    autoAllow: (tool) => settings().autoAllowReadOnly && READ_TOOLS.has(tool),
    async handle(req, res, url, json, readJson) {
      const is = (method, re) => req.method === method && (req.m = url.pathname.match(re));
      const q = (k) => url.searchParams.get(k) ?? '';
      const fenced = (cwd) => { if (!okCwd(cwd)) { json(403, { error: 'unknown folder' }); return false; } return true; };

      if (is('POST', /^\/api\/sessions\/([\w-]+)\/(update|delete)$/)) {
        const [, id, act] = req.m;
        if (!store.getSession(id)) return json(404, { error: 'no such session' }), true;
        if (act === 'delete') {
          if (isRunning(id)) return json(409, { error: 'session is running' }), true;
          store.deleteSession(id);
          return json(200, { ok: true }), true;
        }
        const b = await readJson(req);
        if (typeof b.title === 'string') store.setTitle(id, b.title.slice(0, 120));
        // agent/model can only change before the first turn (the CLI session is bound to its provider afterwards)
        if (!store.getSession(id).started && ['claude', 'codex'].includes(b.provider) && /^[\w.:\-[\]]*$/.test(b.model ?? '')) store.setAgent(id, b.provider, b.model ?? '');
        if (b.pinned !== undefined) store.setPinned(id, !!b.pinned);
        if (b.archived !== undefined) store.setArchived(id, !!b.archived);
        return json(200, { ok: true }), true;
      }
      if (is('GET', /^\/api\/search$/)) return json(200, { ids: q('q').trim() ? store.search(q('q').trim()) : [] }), true;

      // settings / diagnostics / logs
      if (is('GET', /^\/api\/settings$/)) return json(200, settings()), true;
      if (is('POST', /^\/api\/settings$/)) {
        const b = await readJson(req), cur = store.kvGet('settings', {});
        for (const k of SETTING_KEYS) if (k in b) cur[k] = b[k];
        store.kvSet('settings', cur);
        return json(200, settings()), true;
      }
      if (is('GET', /^\/api\/diagnostics$/)) {
        const sessions = store.listSessions();
        let head = '';
        try { head = (await git(appRoot, ['log', '-1', '--format=%h %s (%cr)'])).out.trim(); } catch { /* no git */ }
        const dbFile = path.join(dataDir, 'vbanana.db');
        return json(200, { node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()), sessions: sessions.length, events: store.maxSeq(),
          dbBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0, dataDir, appRoot, commit: head }), true;
      }
      if (is('GET', /^\/api\/logs$/)) {
        const dir = path.join(dataDir, 'logs'), files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        if (!q('name')) return json(200, { files }), true;
        if (!files.includes(q('name'))) return json(404, { error: 'no such log' }), true;
        const buf = fs.readFileSync(path.join(dir, q('name')));
        return json(200, { text: buf.subarray(-60000).toString('utf8') }), true;
      }

      // projects
      if (is('GET', /^\/api\/projects$/)) {
        const reg = projects(), all = new Map();
        for (const p of Object.keys(reg)) all.set(path.resolve(p), { path: p, registered: true, sessions: 0, lastUsed: 0, ...reg[p] });
        for (const s of store.listSessions()) {
          if (s.cmp) continue; // compare worktrees aren't projects
          const k = path.resolve(s.cwd), e = all.get(k) ?? { path: s.cwd, registered: false, sessions: 0, lastUsed: 0 };
          e.sessions++; e.lastUsed = Math.max(e.lastUsed, s.updated_at); all.set(k, e);
        }
        const list = await Promise.all([...all.values()].map(async (p) => {
          const [br, remote, st] = await Promise.all([git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD']), git(p.path, ['remote', 'get-url', 'origin']), git(p.path, ['status', '--porcelain'])]);
          return { name: path.basename(p.path) || p.path, ...p, isApp: path.resolve(p.path) === appRoot, repo: br.ok, branch: br.ok ? br.out.trim() : '', remote: remote.ok ? remote.out.trim() : '', dirty: st.ok ? st.out.split('\n').filter(Boolean).length : 0, exists: fs.existsSync(p.path) };
        }));
        return json(200, { projects: list }), true;
      }
      if (is('POST', /^\/api\/projects\/(add|update|remove)$/)) {
        const b = await readJson(req), reg = projects();
        if (typeof b.path !== 'string' || !b.path) return json(400, { error: 'path required' }), true;
        const key = Object.keys(reg).find((k) => path.resolve(k) === path.resolve(b.path));
        if (req.m[1] === 'add') {
          if (!fs.existsSync(b.path) || !fs.statSync(b.path).isDirectory()) return json(400, { error: 'not a folder' }), true;
          if (!key) reg[path.resolve(b.path)] = { favorite: false, instructions: '' };
        } else if (req.m[1] === 'remove') delete reg[key];
        else {
          const e = reg[key ?? path.resolve(b.path)] ??= { favorite: false, instructions: '' };
          if ('favorite' in b) e.favorite = !!b.favorite;
          if (typeof b.instructions === 'string') e.instructions = b.instructions.slice(0, 8000);
          if (typeof b.name === 'string') e.name = b.name.slice(0, 80);
        }
        store.kvSet('projects', reg);
        return json(200, { ok: true }), true;
      }

      // git
      if (is('GET', /^\/api\/git\/status$/)) {
        if (!fenced(q('cwd'))) return true;
        const cwd = q('cwd'), br = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        if (!br.ok) return json(200, { repo: false, error: br.err }), true;
        const [st, wt] = await Promise.all([git(cwd, ['status', '--porcelain=v1', '-uall']), git(cwd, ['worktree', 'list', '--porcelain'])]);
        const files = st.out.split('\n').filter(Boolean).map((l) => ({ x: l[0], y: l[1], path: l.slice(3).replace(/^.* -> /, '') }));
        const worktrees = wt.out.split('\n\n').filter(Boolean).map((b) => ({ path: /^worktree (.*)$/m.exec(b)?.[1], branch: /^branch refs\/heads\/(.*)$/m.exec(b)?.[1] ?? '(detached)' }));
        return json(200, { repo: true, branch: br.out.trim(), files, worktrees }), true;
      }
      if (is('GET', /^\/api\/git\/diff$/)) {
        if (!fenced(q('cwd')) ) return true;
        if (!safeRel(q('file'))) return json(400, { error: 'bad file' }), true;
        const args = q('untracked') ? ['diff', '--no-index', '--', os_null(), q('file')] : ['diff', ...(q('staged') ? ['--cached'] : []), '--', q('file')];
        const r = await git(q('cwd'), args);
        return json(200, { diff: r.out.slice(0, 400000) }), true; // --no-index exits 1 when files differ
      }
      if (is('POST', /^\/api\/git\/(stage|unstage|revert|commit)$/)) {
        const b = await readJson(req), act = req.m[1];
        if (!fenced(b.cwd)) return true;
        if (act === 'commit') {
          if (typeof b.message !== 'string' || !b.message.trim()) return json(400, { error: 'message required' }), true;
          const r = await git(b.cwd, ['commit', '-m', b.message]);
          return json(r.ok ? 200 : 400, r.ok ? { ok: true, out: r.out } : { error: r.err || r.out }), true;
        }
        if (!Array.isArray(b.files) || !b.files.length || !b.files.every(safeRel)) return json(400, { error: 'bad files' }), true;
        if (act === 'stage') { const r = await git(b.cwd, ['add', '--', ...b.files]); return json(r.ok ? 200 : 400, r.ok ? { ok: true } : { error: r.err }), true; }
        if (act === 'unstage') { const r = await git(b.cwd, ['restore', '--staged', '--', ...b.files]); return json(r.ok ? 200 : 400, r.ok ? { ok: true } : { error: r.err }), true; }
        // revert: tracked files go back to HEAD; untracked files are deleted
        const st = (await git(b.cwd, ['status', '--porcelain=v1', '-uall'])).out.split('\n').filter(Boolean);
        const untracked = new Set(st.filter((l) => l.startsWith('??')).map((l) => l.slice(3)));
        const tracked = b.files.filter((f) => !untracked.has(f));
        if (tracked.length) { const r = await git(b.cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]); if (!r.ok) return json(400, { error: r.err }), true; }
        for (const f of b.files.filter((f) => untracked.has(f))) fs.rmSync(path.join(b.cwd, f), { force: true });
        return json(200, { ok: true }), true;
      }

      // files (read-only, for the chat drawer and @-context)
      if (is('GET', /^\/api\/files$/)) {
        if (!fenced(q('cwd'))) return true;
        const cwd = q('cwd'), needle = q('q').toLowerCase();
        let list = [];
        const g = await git(cwd, ['ls-files', '-co', '--exclude-standard']);
        if (g.ok) list = g.out.split('\n').filter(Boolean);
        else {
          const walk = (d, depth) => { if (depth > 3 || list.length > 2000) return; for (const f of fs.readdirSync(path.join(cwd, d), { withFileTypes: true })) { if (f.name === 'node_modules' || f.name.startsWith('.')) continue; const rel = path.join(d, f.name); if (f.isDirectory()) walk(rel, depth + 1); else list.push(rel.replaceAll('\\', '/')); } };
          try { walk('', 0); } catch { /* unreadable */ }
        }
        return json(200, { files: list.filter((f) => f.toLowerCase().includes(needle)).slice(0, 50) }), true;
      }
      if (is('GET', /^\/api\/file$/)) {
        if (!fenced(q('cwd'))) return true;
        if (!safeRel(q('path'))) return json(400, { error: 'bad path' }), true;
        const f = path.join(q('cwd'), q('path'));
        if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return json(404, { error: 'not a file' }), true;
        const buf = fs.readFileSync(f).subarray(0, 300000);
        if (buf.includes(0)) return json(200, { path: q('path'), binary: true }), true;
        return json(200, { path: q('path'), content: buf.toString('utf8'), truncated: fs.statSync(f).size > 300000 }), true;
      }

      // terminal
      if (is('GET', /^\/api\/terminal$/)) return json(200, { entries: [...term.values()].map(({ pid, ...e }) => e) }), true;
      if (is('POST', /^\/api\/terminal\/(run|kill)$/)) {
        const b = await readJson(req);
        if (req.m[1] === 'kill') { const e = term.get(b.id); if (e?.running) killTree(e.pid); return json(200, { ok: true }), true; }
        if (!fenced(b.cwd)) return true;
        if (typeof b.command !== 'string' || !b.command.trim()) return json(400, { error: 'command required' }), true;
        return json(200, { id: termRun(b.cwd, b.command, b.tab).id }), true;
      }

      // tasks + analytics
      if (is('GET', /^\/api\/tasks$/)) return json(200, { tasks: turns().slice(0, 300) }), true;
      if (is('GET', /^\/api\/analytics$/)) {
        const since = Date.now() - (+q('days') || 30) * 864e5, ts = turns().filter((t) => t.start >= since && !t.system);
        const by = {}, day = {};
        for (const t of ts) {
          const p = by[t.provider] ??= { tasks: 0, done: 0, failed: 0, running: 0, durationMs: 0, timed: 0, cost: 0, costN: 0, tokens: 0, tokensN: 0 };
          p.tasks++; p[t.status]++;
          if (t.durationMs != null) { p.durationMs += t.durationMs; p.timed++; }
          if (t.cost != null) { p.cost += t.cost; p.costN++; }
          if (t.tokens != null) { p.tokens += t.tokens; p.tokensN++; }
          const d = new Date(t.start).toLocaleDateString('en-CA');
          day[d] = (day[d] ?? 0) + 1;
        }
        const sessions = store.listSessions().filter((s) => s.updated_at >= since).length;
        return json(200, { days: +q('days') || 30, tasks: ts.length, sessions, totalSessions: store.listSessions().length, by, perDay: day }), true;
      }

      // compare
      if (is('POST', /^\/api\/compare$/)) {
        const b = await readJson(req);
        if (!fenced(b.cwd)) return true;
        if (typeof b.prompt !== 'string' || !b.prompt.trim()) return json(400, { error: 'prompt required' }), true;
        try { return json(200, await startCompare(b)), true; } catch (e) { return json(400, { error: e.message }), true; }
      }
      if (is('POST', /^\/api\/compare\/discard$/)) {
        const { group } = await readJson(req);
        const ss = store.listSessions().filter((s) => s.cmp === group);
        if (!ss.length || ss.some((s) => isRunning(s.id))) return json(409, { error: 'nothing to discard, or still running' }), true;
        const top = path.join(dataDir, 'worktrees', group.slice(0, 8));
        for (const s of ss) {
          const main = (await git(s.cwd, ['rev-parse', '--git-common-dir'])).out.trim();
          const repo = path.resolve(s.cwd, main, '..');
          await git(repo, ['worktree', 'remove', '--force', s.cwd]);
          await git(repo, ['branch', '-D', `vbcmp/${group.slice(0, 8)}-${s.provider}`]);
          store.setArchived(s.id, true);
        }
        fs.rmSync(top, { recursive: true, force: true });
        return json(200, { ok: true }), true;
      }

      // workflows
      if (is('GET', /^\/api\/workflows$/)) return json(200, { workflows: store.kvGet('workflows', []), runs: runs() }), true;
      if (is('POST', /^\/api\/workflows\/save$/)) {
        const { workflow: w } = await readJson(req);
        const ok = w && typeof w.name === 'string' && w.name.trim() && Array.isArray(w.steps) && w.steps.length
          && w.steps.every((s) => ['claude', 'codex'].includes(s.provider) && typeof s.prompt === 'string' && s.prompt.trim());
        if (!ok) return json(400, { error: 'name and at least one step with provider + prompt required' }), true;
        const all = store.kvGet('workflows', []), id = w.id || crypto.randomUUID();
        const clean = { id, name: w.name.trim().slice(0, 80), description: String(w.description ?? '').slice(0, 300), steps: w.steps.map((s) => ({ title: String(s.title ?? '').slice(0, 60), provider: s.provider, model: String(s.model ?? '').replace(/[^\w.:\-\[\]]/g, ''), prompt: s.prompt, approve: !!s.approve })) };
        store.kvSet('workflows', [...all.filter((x) => x.id !== id), clean]);
        return json(200, { id }), true;
      }
      if (is('POST', /^\/api\/workflows\/delete$/)) {
        const { id } = await readJson(req);
        store.kvSet('workflows', store.kvGet('workflows', []).filter((x) => x.id !== id));
        return json(200, { ok: true }), true;
      }
      if (is('POST', /^\/api\/runs\/start$/)) {
        const b = await readJson(req), w = store.kvGet('workflows', []).find((x) => x.id === b.workflowId);
        if (!w) return json(404, { error: 'no such workflow' }), true;
        if (!fenced(b.cwd)) return true;
        const run = { id: crypto.randomUUID(), workflowId: w.id, name: w.name, cwd: b.cwd, input: String(b.input ?? ''), status: 'running', step: 0, startedAt: Date.now(), steps: w.steps.map((s) => ({ ...s, status: 'pending', output: '' })) };
        saveRuns([run, ...runs()]);
        advance(run.id);
        return json(200, { id: run.id }), true;
      }
      if (is('POST', /^\/api\/runs\/([\w-]+)\/(continue|cancel)$/)) {
        const [, id, act] = req.m, b = await readJson(req);
        const r = runs().find((x) => x.id === id);
        if (!r) return json(404, { error: 'no such run' }), true;
        if (act === 'cancel') {
          const st = r.steps[r.step];
          mutate(id, (x) => { x.status = 'cancelled'; x.endedAt = Date.now(); });
          if (st?.sessionId && st.status === 'running') interrupt(st.sessionId);
        } else if (r.status === 'waiting') {
          if (b.approve === false) mutate(id, (x) => { x.status = 'cancelled'; x.endedAt = Date.now(); });
          else { mutate(id, (x) => { x.steps[x.step].approved = true; }); advance(id); }
        }
        return json(200, { ok: true }), true;
      }
      return false;
    },
  };
}

const os_null = () => (process.platform === 'win32' ? 'NUL' : '/dev/null');
