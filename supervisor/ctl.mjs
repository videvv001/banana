// Command-line client for the supervisor. This is the ONLY way the AI restarts things.
//   node supervisor/ctl.mjs status | verify | restart <service> | rollback | logs <service>
// Inside a chat turn, VB_SESSION identifies the chat so it can be resumed after an agent-host restart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = fs.readFileSync(path.join(ROOT, 'data', 'ctl-token'), 'utf8').trim();
const [cmd, name, flag] = process.argv.slice(2);
const POSTS = ['restart', 'verify', 'rollback'];
if (![...POSTS, 'status', 'logs'].includes(cmd) || (['restart', 'logs'].includes(cmd) && !name)) {
  console.error('usage: ctl.mjs status | verify | restart <service> | rollback | logs <service>');
  process.exit(2);
}
const headers = { 'x-ctl-token': token };
if (process.env.VB_SESSION) headers['x-session'] = process.env.VB_SESSION;
const force = cmd === 'restart' && flag === '--force' ? '?force=1' : ''; // humans only; CLAUDE.md forbids the AI
const res = await fetch(`http://127.0.0.1:${process.env.CTL_PORT || 3100}/${cmd}${cmd === 'restart' || cmd === 'logs' ? '/' + name : ''}${force}`, {
  method: POSTS.includes(cmd) ? 'POST' : 'GET',
  headers,
});
const text = await res.text();
if (cmd === 'logs') { console.log(text); process.exit(0); }
const body = JSON.parse(text);
// verify/health output is the useful part: print it raw instead of JSON-escaped.
const { output, ...rest } = body;
console.log(JSON.stringify(rest, null, 2));
if (output) console.log('\n' + output);
process.exit(res.ok && body.ok !== false ? 0 : 1);
