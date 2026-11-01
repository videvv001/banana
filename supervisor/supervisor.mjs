// The lifeline. Node stdlib only, kept tiny on purpose: the AI may not edit this file.
// Owns the service processes. Restart policy lives here: verify first, agent-host only between turns,
// health-check after, and roll back to the last good git state if the new code won't come up.
import { spawn, execFile } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });

const CTL_PORT = +(process.env.CTL_PORT || 3100);
const tokenFile = path.join(DATA, 'ctl-token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(24).toString('hex'));
const TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();

const PORTS = { gateway: 7420, 'agent-host': 3101, vite: 3102 };
const SERVICES = {
  'agent-host': { args: ['services/agent-host/index.mjs'], health: '/health' },
  gateway: { args: ['services/gateway/index.mjs'], health: '/health' },
  vite: { args: ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'], health: '/@vite/client' },
};
const env = {
  ...process.env,
  GATEWAY_PORT: PORTS.gateway, AGENT_PORT: PORTS['agent-host'], VITE_PORT: PORTS.vite,
  CTL_PORT, DATA_DIR: DATA,
};

/** @type {Record<string, {proc?: import('node:child_process').ChildProcess, startedAt?: number, restarts: number, intentional: boolean}>} */
const state = Object.fromEntries(Object.keys(SERVICES).map((n) => [n, { restarts: 0, intentional: false }]));

function start(name) {
  const s = state[name];
  const log = fs.openSync(path.join(DATA, 'logs', `${name}.log`), 'a');
  const proc = spawn(process.execPath, SERVICES[name].args, { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log);
  s.proc = proc; s.startedAt = Date.now(); s.intentional = false;
  proc.on('exit', (code) => {
    if (s.proc !== proc) return; // superseded by a restart
    s.proc = undefined;
    if (s.intentional) return;
    s.restarts++;
    console.log(`[${name}] exited (${code}), restarting`);
    setTimeout(() => !s.proc && start(name), Math.min(1000 * s.restarts, 5000));
  });
}

async function stop(name) {
  const s = state[name];
  const proc = s.proc;
  if (!proc) return;
  s.intentional = true;
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill();
  const t = setTimeout(() => proc.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(t);
  s.proc = undefined;
}

const get = (name, p, headers) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORTS[name], path: p, headers, timeout: 1500 }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', () => resolve({ status: 0, body: '' }));
  req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
});
const probe = async (name) => { const { status } = await get(name, SERVICES[name].health); return status > 0 && status < 500; };

async function waitHealthy(name, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!state[name].proc) return false; // died while starting
    if (await probe(name)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function restart(name) {
  await stop(name);
  start(name);
  const healthy = await waitHealthy(name);
  return { ok: healthy, pid: state[name].proc?.pid ?? null };
}

async function status() {
  const out = {};
  for (const name of Object.keys(SERVICES)) {
    const s = state[name];
    out[name] = { pid: s.proc?.pid ?? null, healthy: s.proc ? await probe(name) : false, restarts: s.restarts, startedAt: s.startedAt ?? null };
  }
  out['agent-host'].restartPending = pending.timer !== null;
  return out;
}

function logs(name, bytes = 8000) {
  const file = path.join(DATA, 'logs', `${name}.log`);
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(bytes, size));
  fs.readSync(fd, buf, 0, buf.length, size - buf.length);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

// ---- verify + git "last good" state --------------------------------------------------------------
const sh = (cmd, args) => new Promise((resolve) =>
  execFile(cmd, args, { cwd: ROOT, timeout: 180000, maxBuffer: 20e6, windowsHide: true }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })));
const git = (...a) => sh('git', ['-c', 'user.name=banana', '-c', 'user.email=banana@localhost', ...a]);
const verify = () => sh(process.execPath, ['supervisor/verify.mjs']);

async function commitAll(msg) {
  await git('add', '-A');
  if ((await git('diff', '--cached', '--quiet')).ok) return; // nothing staged
  await git('commit', '-m', msg);
}
async function markGood() { await commitAll('vb: verified state'); await git('tag', '-f', 'vb-good'); }
async function rollback() {
  await commitAll('vb: failed state');
  const branch = `failed/${new Date().toISOString().replace(/\W/g, '').slice(0, 14)}`;
  await git('branch', branch);
  await git('reset', '--hard', 'vb-good');
  return branch;
}

// ---- restart policy ---------------------------------------------------------------------------------
let chain = Promise.resolve();
const serial = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

/** Restart + health check; on failure roll back to vb-good and bring the old code back up. */
async function cycle(name) {
  const r = await restart(name);
  if (r.ok) { await markGood(); return { ok: true, pid: r.pid }; }
  const output = logs(name, 2500);
  const branch = await rollback();
  await restart(name);
  return { ok: false, stage: 'health', rolledBack: true, branch, output };
}

const pending = { sessions: new Set(), timer: /** @type {NodeJS.Timeout | null} */ (null), polling: false };

async function pollIdle() {
  if (pending.polling) return;
  pending.polling = true;
  try {
    const { status: st, body } = await get('agent-host', '/internal/busy', { 'x-ctl-token': TOKEN });
    if (st === 200 && JSON.parse(body).running > 0) return;
    clearInterval(pending.timer); pending.timer = null;
    const sessions = [...pending.sessions]; pending.sessions.clear();
    const r = await serial(() => cycle('agent-host'));
    const text = r.ok
      ? 'agent-host was restarted and passed its health check. Continue your task: confirm the change works, then report to the user briefly.'
      : `agent-host FAILED its health check after restart. The app was rolled back to the last good state; your changes are saved on git branch "${r.branch}" (inspect with \`git diff vb-good ${r.branch}\`). Nothing is lost. Read the error below, fix the problem, verify, and try again. Do not retry the same change.\n\n${r.output}`;
    await notifyAgent(sessions, text);
  } finally { pending.polling = false; }
}

async function notifyAgent(sessions, text) {
  if (!sessions.length) return;
  const body = JSON.stringify({ sessions, text });
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORTS['agent-host'], path: '/internal/restart-result', method: 'POST', headers: { 'x-ctl-token': TOKEN } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end(body);
  });
}

async function requestRestart(name, sessionId, force) {
  if (!force) {
    const v = await verify();
    if (!v.ok) return { ok: false, stage: 'verify', output: v.out.slice(-3000) };
  }
  if (name === 'agent-host') {
    if (sessionId) pending.sessions.add(sessionId);
    pending.timer ??= setInterval(pollIdle, 1000);
    return { ok: true, deferred: true, message: 'verify passed. agent-host will restart as soon as no turn is running. End your turn now; you will be re-invoked with the result.' };
  }
  return serial(() => cycle(name));
}

// ---- control API ---------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (req.headers['x-ctl-token'] !== TOKEN) return send(401, { error: 'bad token' });
  const url = new URL(req.url, 'http://x');
  const [, action, name] = url.pathname.split('/');
  try {
    if (action === 'status') return send(200, await status());
    if (action === 'verify' && req.method === 'POST') { const v = await verify(); return send(200, { ok: v.ok, output: v.out.slice(-3000) }); }
    if (action === 'rollback' && req.method === 'POST') {
      const branch = await rollback();
      for (const n of ['gateway', 'vite']) await serial(() => restart(n));
      pending.sessions.add(req.headers['x-session'] ?? '');
      pending.sessions.delete('');
      pending.timer ??= setInterval(pollIdle, 1000);
      return send(200, { ok: true, branch, message: 'rolled back to vb-good; gateway and vite restarted, agent-host restarts when idle' });
    }
    if (!SERVICES[name]) return send(404, { error: `unknown service ${name}` });
    if (action === 'restart' && req.method === 'POST') return send(200, await requestRestart(name, req.headers['x-session'], url.searchParams.has('force')));
    if (action === 'logs') return send(200, logs(name));
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: String(e.message ?? e) });
  }
});
server.listen(CTL_PORT, '127.0.0.1', () => console.log(`supervisor control on 127.0.0.1:${CTL_PORT}`));

if (!(await git('rev-parse', '--verify', 'vb-good')).ok) { await git('init'); await markGood(); }
for (const name of Object.keys(SERVICES)) start(name);

async function shutdown() {
  server.close();
  await Promise.all(Object.keys(SERVICES).map(stop));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
