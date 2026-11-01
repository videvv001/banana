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
import { startCodexTurn } from './codex.mjs';
import { codexModels, cliStatus, cliInstall, cliLogin, cliLoginState, cliLoginCode, isCli } from './clis.mjs';
import { createApi } from './api2.mjs';

const PORT = +process.env.AGENT_PORT;
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CTL_TOKEN = fs.readFileSync(path.join(process.env.DATA_DIR, 'ctl-token'), 'utf8').trim();
// ponytail: one-time rename of the pre-rename DB (+ WAL files); delete once every install has restarted.
for (const ext of ['', '-shm', '-wal']) {
  const old = path.join(process.env.DATA_DIR, 'vbanana.db' + ext), neu = path.join(process.env.DATA_DIR, 'banana.db' + ext);
  if (fs.existsSync(old) && !fs.existsSync(neu)) fs.renameSync(old, neu);
}
const store = openStore(path.join(process.env.DATA_DIR, 'banana.db'));

const clients = new Set(); // SSE responses
const turns = new Map(); // sessionId -> running turn
const approvalOwner = new Map(); // requestId -> {sessionId, input}
const turnEndHooks = []; // workflow runner listens here

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
  const git = (...a) => execFileSync('git', ['-c', 'user.name=banana', '-c', 'user.email=banana@localhost', ...a], { cwd, stdio: 'pipe' });
  try {
    git('add', '-A');
    if (git('status', '--porcelain').length) git('commit', '-m', 'vb: checkpoint before turn');
  } catch { /* no git / nothing to commit: not worth failing the turn */ }
}

// Agent + project instructions ride along with a conversation's first prompt only; resumed turns already have them.
function withInstructions(s, text) {
  if (s.started) return text;
  const proj = store.kvGet('projects', {});
  const key = Object.keys(proj).find((k) => path.resolve(k) === path.resolve(s.cwd));
  // Claude gets the app rules via --append-system-prompt-file; Codex has no such flag, so they ride along here.
  // ponytail: Codex isn't fenced by ai-settings.json, so these rules are advice, not enforcement (the pre-turn git checkpoint is the safety net).
  let rules = '';
  if (s.provider === 'codex' && path.resolve(s.cwd) === APP_ROOT) { try { rules = fs.readFileSync(path.join(APP_ROOT, 'supervisor', 'ai-rules.md'), 'utf8'); } catch { /* no rules file */ } }
  const parts = [rules, api2.settings().instructions?.[s.provider], proj[key]?.instructions].filter((x) => x?.trim());
  return parts.length ? 'Instructions for this conversation:\n' + parts.join('\n\n') + '\n\n---\n' + text : text;
}
const bin = (provider) => api2.settings().cliPaths?.[provider]?.trim() || provider;

function sendMessage(id, text, system = false, images = []) {
  const s = store.getSession(id);
  if (!s) return 404;
  if (turns.has(id)) return 409;
  if (!s.title && !system) store.setTitle(id, text.slice(0, 60) || 'Image');
  checkpoint(s.cwd);
  emit(id, 'user', system ? { text, system: true } : images.length ? { text, images } : { text });
  setStatus(id, 'running');
  const owned = new Set();
  const codex = s.provider === 'codex';
  const turn = (codex ? startCodexTurn : startTurn)({
    id, cwd: s.cwd, started: !!s.started, extId: s.ext_id, text: system ? text : withInstructions(s, text), images, model: s.model || undefined, bin: bin(s.provider),
    on: {
      init: (extId) => { if (!s.started) store.setStarted(id, extId); },
      message: (kind, data) => emit(id, kind, data),
      delta: (t) => ephemeral(id, 'delta', { text: t }),
      approval: (req) => {
        if (api2.autoAllow(req.tool_name)) return queueMicrotask(() => turns.get(id)?.respond(req.request_id, true, req.input)); // policy: read-only tools skip the prompt
        owned.add(req.request_id); approvalOwner.set(req.request_id, { sessionId: id, input: req.input }); emit(id, 'approval', req); },
      exit: ({ gotResult, stderr }) => {
        turns.delete(id);
        for (const rid of owned) if (approvalOwner.delete(rid)) emit(id, 'approval_done', { request_id: rid, allow: false, expired: true });
        if (!gotResult) emit(id, 'notice', { text: `Turn ended without a result.\n${stderr}`.trim(), error: true });
        setStatus(id, 'idle');
        for (const h of turnEndHooks) { try { h(id, gotResult); } catch { /* a hook must not break turn cleanup */ } }
      },
    },
  });
  turns.set(id, { ...turn, owned });
  return 202;
}

const api2 = createApi({
  store, appRoot: APP_ROOT, dataDir: process.env.DATA_DIR, sendMessage,
  interrupt: (id) => turns.get(id)?.kill(), isRunning: (id) => turns.has(id), onTurnEnd: (fn) => turnEndHooks.push(fn),
});

const readJson = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 30e6) { reject(new Error('too large')); req.destroy(); } });
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
      if (url.pathname === '/internal/busy') return json(200, { running: turns.size, uptimeSeconds: Math.round(process.uptime()) });
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
    if (is('GET', /^\/api\/models$/)) return json(200, { claude: ['opus', 'sonnet', 'haiku'], codex: codexModels() });
    if (is('GET', /^\/api\/clis$/)) return json(200, Object.fromEntries(await Promise.all(['claude', 'codex'].map(async (n) => [n, await cliStatus(n, bin(n))]))));
    if (is('POST', /^\/api\/clis\/(\w+)\/test$/)) {
      if (!isCli(req.m[1])) return json(404, { error: 'unknown cli' });
      const t0 = Date.now();
      return json(200, { ...(await cliStatus(req.m[1], bin(req.m[1]))), ms: Date.now() - t0 });
    }
    if (is('POST', /^\/api\/clis\/(\w+)\/(install|login)$/)) {
      const [, name, action] = req.m;
      if (!isCli(name)) return json(404, { error: 'unknown cli' });
      if (action === 'install') return json(200, await cliInstall(name));
      return json(200, cliLogin(name, bin(name)));
    }
    if (is('GET', /^\/api\/clis\/(\w+)\/login$/)) return isCli(req.m[1]) ? json(200, cliLoginState(req.m[1])) : json(404, { error: 'unknown cli' });
    if (is('POST', /^\/api\/clis\/(\w+)\/login\/code$/)) {
      const { code } = await readJson(req);
      if (!isCli(req.m[1]) || typeof code !== 'string' || !/^[^\r\n]{1,512}$/.test(code.trim())) return json(400, { error: 'bad code' });
      return cliLoginCode(req.m[1], code.trim()) ? json(200, { ok: true }) : json(409, { error: 'no login in progress' });
    }
    if (is('GET', /^\/api\/sessions$/)) return json(200, { sessions: store.listSessions(), maxSeq: store.maxSeq() });
    if (is('POST', /^\/api\/sessions$/)) {
      const { cwd, provider = 'claude', model = '' } = await readJson(req);
      if (!['claude', 'codex'].includes(provider) || typeof model !== 'string' || !/^[\w.:\-\[\]]*$/.test(model)) return json(400, { error: 'bad provider/model' });
      const id = crypto.randomUUID();
      store.createSession(id, cwd || APP_ROOT, provider, model);
      return json(200, { id });
    }
    if (is('GET', /^\/api\/sessions\/([\w-]+)\/events$/)) return json(200, { events: store.sessionEvents(req.m[1]) });
    if (is('POST', /^\/api\/sessions\/([\w-]+)\/messages$/)) {
      const { text, images = [] } = await readJson(req);
      const okImg = Array.isArray(images) && images.every((i) => /^image\/(png|jpeg|gif|webp)$/.test(i?.media_type) && typeof i.data === 'string');
      if (typeof text !== 'string' || !okImg || (!text.trim() && !images.length)) return json(400, { error: 'text or image required' });
      const code = sendMessage(req.m[1], text, false, images);
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
    if (await api2.handle(req, res, url, json, readJson)) return;
    json(404, { error: 'not found' });
  } catch (e) {
    json(500, { error: String(e.message ?? e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`agent-host on 127.0.0.1:${PORT}`));

setInterval(() => { for (const c of clients) c.write(': hb\n\n'); }, 15000);
