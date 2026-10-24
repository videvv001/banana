// Claude CLI adapter: one process per turn, structured stream-json in and out.
// Permission prompts come back as `can_use_tool` control requests that we answer from the UI.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {{id: string, cwd: string, started: boolean, text: string, on: {
 *   init(): void, message(kind: string, data: any): void, delta(text: string): void,
 *   approval(req: {request_id: string, tool_name: string, input: any}): void,
 *   exit(info: {gotResult: boolean, stderr: string}): void }}} o
 */
export function startTurn({ id, cwd, started, text, images = [], on }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--permission-prompt-tool', 'stdio', ...(started ? ['--resume', id] : ['--session-id', id])];
  // Windows needs a shell to resolve claude.cmd; elsewhere spawn directly.
  // Sessions editing the app itself get its rules and permission fences (kept in supervisor/, which the AI can't edit).
  if (cwd === APP_ROOT) {
    const sup = path.join(APP_ROOT, 'supervisor');
    args.push('--settings', path.join(sup, 'ai-settings.json'), '--append-system-prompt-file', path.join(sup, 'ai-rules.md'),
      '--system-prompt-snapshot', 'off'); // snapshot would freeze old rules into resumed chats
  }
  const quote = (a) => (process.platform === 'win32' && /\s/.test(a) ? `"${a}"` : a);
  const proc = spawn('claude', args.map(quote), { cwd, shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, VB_SESSION: id } });
  let gotResult = false, stderr = '', buf = '';

  const handle = (m) => {
    if (m.type === 'system' && m.subtype === 'init') on.init();
    else if (m.type === 'stream_event') {
      const d = m.event?.delta;
      if (m.event?.type === 'content_block_delta' && d?.type === 'text_delta' && !m.parent_tool_use_id) on.delta(d.text);
    } else if (m.type === 'assistant') on.message('assistant', { ...m.message, parent: m.parent_tool_use_id });
    else if (m.type === 'user') on.message('tool_result', { ...m.message, parent: m.parent_tool_use_id });
    else if (m.type === 'result') {
      gotResult = true;
      on.message('result', { is_error: m.is_error, subtype: m.subtype, result: m.result, duration_ms: m.duration_ms, cost: m.total_cost_usd });
      proc.stdin.end(); // turn is over; let the process exit
    } else if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      on.approval({ request_id: m.request_id, tool_name: m.request.tool_name, input: m.request.input });
    }
  };

  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { handle(JSON.parse(line)); } catch (e) { stderr += `bad line: ${e.message}\n`; }
    }
  });
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  proc.on('exit', () => on.exit({ gotResult, stderr }));
  proc.stdin.on('error', () => {}); // EPIPE if the CLI already died
  const content = images.length
    ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })), ...(text ? [{ type: 'text', text }] : [])]
    : text;
  proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');

  return {
    respond(requestId, allow, input) {
      const response = allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Denied by user' };
      proc.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) + '\n');
    },
    kill() {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
      else proc.kill();
    },
  };
}
