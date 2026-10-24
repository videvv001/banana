// Codex CLI adapter: same shape as claude.mjs's startTurn, one `codex exec --json` process per turn.
// Codex items are mapped onto the Claude-style events the UI already renders. Exec mode has no approval prompts.
import { spawn, spawnSync } from 'node:child_process';

/**
 * @param {{id: string, cwd: string, started: boolean, extId?: string, text: string, model?: string, readOnly?: boolean, on: any}} o
 */
export function startCodexTurn({ cwd, started, extId, text, model, readOnly, bin = 'codex', on }) {
  const flags = ['--json', '--skip-git-repo-check', '-c', `sandbox_mode="${readOnly ? 'read-only' : 'workspace-write'}"`, ...(model ? ['-m', model] : [])];
  const args = started && extId ? ['exec', 'resume', ...flags, extId, '-'] : ['exec', ...flags, '-'];
  const proc = spawn(process.platform === 'win32' && /\s/.test(bin) ? `"${bin}"` : bin, args, { cwd, shell: process.platform === 'win32', windowsHide: true });
  let gotResult = false, stderr = '', buf = '';
  const t0 = Date.now();

  const handle = (m) => {
    const it = m.item;
    if (m.type === 'thread.started') on.init(m.thread_id);
    else if (m.type === 'item.completed' && it.type === 'agent_message') on.message('assistant', { content: [{ type: 'text', text: it.text }] });
    else if (m.type === 'item.started' && it.type === 'command_execution') on.message('assistant', { content: [{ type: 'tool_use', id: it.id, name: 'shell', input: { command: it.command } }] });
    else if (m.type === 'item.completed' && it.type === 'command_execution') on.message('tool_result', { content: [{ type: 'tool_result', tool_use_id: it.id, content: it.aggregated_output, is_error: it.exit_code !== 0 }] });
    else if (m.type === 'item.completed' && it.type === 'file_change') on.message('assistant', { content: [{ type: 'tool_use', id: it.id, name: 'file_change', input: it.changes }] });
    else if (m.type === 'turn.completed' || m.type === 'turn.failed') {
      gotResult = true;
      on.message('result', { is_error: m.type === 'turn.failed', duration_ms: Date.now() - t0, usage: m.usage });
    } else if (m.type === 'error' && !gotResult) stderr += `${m.message}\n`;
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
  proc.stdin.on('error', () => {});
  proc.stdin.end(text);

  return {
    respond() {},
    kill() {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
      else proc.kill();
    },
  };
}
