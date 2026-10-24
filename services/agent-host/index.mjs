// Owns CLI sessions and the event log. HTTP API under /api, live updates over SSE.
// Durable events get a `seq` and are replayable; deltas/status are ephemeral (no id).
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { startTurn } from './claude.mjs';

const PORT = +process.env.AGENT_PORT;
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CTL_TOKEN = fs.readFileSync(path.join(process.env.DATA_DIR, 'ctl-token'), 'utf8').trim();
const store = openStore(path.join(process.env.DATA_DIR, 'vbanana.db'));

const clients = new Set(); // SSE responses
const turns = new Map(); // sessionId -> running turn
const approvalOwner = new Map(); // requestId -> {sessionId, input}

const broadcast = (ev, withId) => {
  const msg = `${withId ? `id: ${ev.seq}\n` : ''}data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(msg);
};
const emit = (sessionId, kind, data) => { const ev = store.append(sessionId, kind, data); broadcast(ev, true); return ev; };
const ephemeral = (sessionId, kind, data) => broadcast({ session_id: sessionId, kind, data }, false);
const setStatus = (id, status) => { store.setStatus(id, status); ephemeral(id, 'status', { status }); };

// A restart can only land between turns (supervisor enforces that); anything still 'running' is stale.
for (const s of store.listSessions()) {
  if (s.status === 'running') { store.setStatus(s.id, 'idle'); emit(s.id, 'notice', { text: 'Agent host restarted while a turn was running; that turn was lost.' }); }
}

// Undo point before the AI touches the app's own code. The supervisor's `vb-good` tag is the rollback target.
function checkpoint(cwd) {
  if (cwd !== APP_ROOT) return;
  const git = (...a) => execFileSync('git', ['-c', 'user.name=vbanana', '-c', 'user.email=vbanana@localhost', ...a], { cwd, stdio: 'pipe' });
  try {
    git('add', '-A');
    if (git('status', '--porcelain').length) git('commit', '-m', 'vb: checkpoint before turn');
  } catch { /* no git / nothing to commit: not worth failing the turn */ }
}

function sendMessage(id, text, system = false) {
  const s = store.getSession(id);
  if (!s) return 404;
  if (turns.has(id)) return 409;
  if (!s.title && !system) store.setTitle(id, text.slice(0, 60));
  checkpoint(s.cwd);
  emit(id, 'user', system ? { text, system: true } : { text });
  setStatus(id, 'running');
  const owned = new Set();
  const turn = startTurn({
    id, cwd: s.cwd, started: !!s.started, text,
    on: {
      init: () => store.setStarted(id),
      message: (kind, data) => emit(id, kind, data),
      delta: (t) => ephemeral(id, 'delta', { text: t }),
      approval: (req) => { owned.add(req.request_id); approvalOwner.set(req.request_id, { sessionId: id, input: req.input }); emit(id, 'approval', req); },
      exit: ({ gotResult, stderr }) => {
        turns.delete(id);
        for (const rid of owned) if (approvalOwner.delete(rid)) emit(id, 'approval_done', { request_id: rid, allow: false, expired: true });
        if (!gotResult) emit(id, 'notice', { text: `Turn ended without a result.\n${stderr}`.trim(), error: true });
        setStatus(id, 'idle');
      },
    },
  });
  turns.set(id, { ...turn, owned });
  return 202;
}

const readJson = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const is = (method, re) => req.method === method && (req.m = url.pathname.match(re));
  try {
    if (url.pathname === '/health') return res.end('ok');

    // Supervisor-only (not reachable via the gateway, which only forwards /api/*).
    if (url.pathname.startsWith('/internal/')) {
      if (req.headers['x-ctl-token'] !== CTL_TOKEN) return json(401, { error: 'bad token' });
      if (url.pathname === '/internal/busy') return json(200, { running: turns.size });
      if (url.pathname === '/internal/restart-result' && req.method === 'POST') {
        const { sessions, text } = await readJson(req);
        for (const id of sessions) sendMessage(id, text, true);
        return json(200, { ok: true });
      }
    }

    if (is('GET', /^\/api\/stream$/)) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      for (const ev of store.eventsAfter(+(url.searchParams.get('after') ?? 0))) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (is('GET', /^\/api\/sessions$/)) return json(200, { sessions: store.listSessions(), maxSeq: store.maxSeq() });
    if (is('POST', /^\/api\/sessions$/)) {
      const { cwd } = await readJson(req);
      const id = crypto.randomUUID();
      store.createSession(id, cwd || APP_ROOT);
      return json(200, { id });
    }
    if (is('GET', /^\/api\/sessions\/([\w-]+)\/events$/)) return json(200, { events: store.sessionEvents(req.m[1]) });
    if (is('POST', /^\/api\/sessions\/([\w-]+)\/messages$/)) {
      const { text } = await readJson(req);
      if (typeof text !== 'string' || !text.trim()) return json(400, { error: 'text required' });
      const code = sendMessage(req.m[1], text);
      return json(code, { ok: code === 202 });
    }
    if (is('POST', /^\/api\/sessions\/([\w-]+)\/interrupt$/)) {
      turns.get(req.m[1])?.kill();
      return json(200, { ok: true });
    }
    if (is('POST', /^\/api\/approvals\/([\w-]+)$/)) {
      const { allow } = await readJson(req);
      const owner = approvalOwner.get(req.m[1]);
      if (!owner) return json(404, { error: 'no such pending approval' });
      approvalOwner.delete(req.m[1]);
      turns.get(owner.sessionId)?.respond(req.m[1], !!allow, owner.input);
      emit(owner.sessionId, 'approval_done', { request_id: req.m[1], allow: !!allow });
      return json(200, { ok: true });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    json(500, { error: String(e.message ?? e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`agent-host on 127.0.0.1:${PORT}`));

setInterval(() => { for (const c of clients) c.write(': hb\n\n'); }, 15000);
