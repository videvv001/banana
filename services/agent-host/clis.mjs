// Setup helpers for the claude / codex CLIs: status, npm install, subscription login (opens the browser on this machine).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Logins must work headless (no browser on the host): claude prints a URL and reads the pasted code from stdin,
// codex --device-auth prints a URL + one-time code and polls until the user finishes in their own browser.
const CLIS = {
  claude: { pkg: '@anthropic-ai/claude-code', status: ['auth', 'status'], login: ['auth', 'login', '--claudeai'] },
  codex: { pkg: '@openai/codex', status: ['login', 'status'], login: ['login', '--device-auth'] },
};
export const isCli = (name) => Object.hasOwn(CLIS, name);

// Windows needs a shell to resolve .cmd shims.
const sh = process.platform === 'win32';
const q = (a) => (sh && /\s/.test(a) ? `"${a}"` : a);
function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    const p = spawn(q(cmd), args, { shell: sh, windowsHide: true, timeout });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
    p.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

export async function cliStatus(name, bin = name) {
  const c = CLIS[name];
  const v = await run(bin, ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false };
  const s = await run(bin, c.status);
  let detail = s.out.split('\n')[0];
  try { const j = JSON.parse(s.out); detail = [j.email, j.subscriptionType].filter(Boolean).join(' · '); } catch { /* codex prints plain text */ }
  return { installed: true, version: v.out.split('\n')[0], loggedIn: s.code === 0, detail };
}

// Codex caches its model catalog locally; hidden entries aren't meant for pickers.
export function codexModels() {
  try {
    const f = path.join(os.homedir(), '.codex', 'models_cache.json');
    return JSON.parse(fs.readFileSync(f, 'utf8')).models.filter((m) => m.visibility === 'list').map((m) => m.slug);
  } catch { return []; }
}

export async function cliInstall(name) {
  const r = await run('npm', ['install', '-g', CLIS[name].pkg], 600000);
  return { ok: r.code === 0, output: r.out.slice(-2000) };
}

// One login process per CLI; the UI polls cliLoginState and shows its output (links, codes, prompts).
const logins = {};
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const kill = (p) => { if (p.exitCode !== null) return; if (sh) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']); else p.kill(); };

export function cliLogin(name, bin = name) {
  if (logins[name]) kill(logins[name].proc);
  const proc = spawn(q(bin), CLIS[name].login, { shell: sh, windowsHide: true });
  const l = logins[name] = { proc, out: '', running: true, exit: null };
  const add = (d) => { l.out = (l.out + d.toString().replace(ANSI, '')).slice(-8000); };
  proc.stdout.on('data', add); proc.stderr.on('data', add);
  proc.on('error', (e) => add(`\n${e.message}`));
  const timer = setTimeout(() => kill(proc), 15 * 60000); // device codes expire after 15 min anyway
  proc.on('close', (code) => { clearTimeout(timer); l.running = false; l.exit = code; });
  return cliLoginState(name);
}

export function cliLoginState(name) {
  const l = logins[name];
  return l ? { running: l.running, exit: l.exit, output: l.out } : { running: false, exit: null, output: '' };
}

export function cliLoginCode(name, code) {
  const l = logins[name];
  if (!l?.running) return false;
  l.proc.stdin.write(`${code}\n`);
  return true;
}
