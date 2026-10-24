// Setup helpers for the claude / codex CLIs: status, npm install, subscription login (opens the browser on this machine).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLIS = {
  claude: { pkg: '@anthropic-ai/claude-code', status: ['auth', 'status'], login: ['auth', 'login', '--claudeai'] },
  codex: { pkg: '@openai/codex', status: ['login', 'status'], login: ['login'] },
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

// Fire and forget: the CLI opens the browser and exits once the login completes; the UI polls status.
export function cliLogin(name) {
  const p = spawn(name, CLIS[name].login, { shell: sh, windowsHide: true, detached: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.unref();
}
