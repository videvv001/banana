// Setup helpers for the claude / codex CLIs: status, npm install, subscription login (opens the browser on this machine).
import { spawn } from 'node:child_process';

const CLIS = {
  claude: { pkg: '@anthropic-ai/claude-code', status: ['auth', 'status'], login: ['auth', 'login', '--claudeai'] },
  codex: { pkg: '@openai/codex', status: ['login', 'status'], login: ['login'] },
};
export const isCli = (name) => Object.hasOwn(CLIS, name);

// Windows needs a shell to resolve .cmd shims.
const sh = process.platform === 'win32';
function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: sh, windowsHide: true, timeout });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: -1, out: e.message }));
    p.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

export async function cliStatus(name) {
  const c = CLIS[name];
  const v = await run(name, ['--version']);
  if (v.code !== 0) return { installed: false, loggedIn: false };
  const s = await run(name, c.status);
  return { installed: true, version: v.out.split('\n')[0], loggedIn: s.code === 0, detail: s.out.split('\n')[0] };
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
