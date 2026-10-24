import type { Ev, Session } from './api';

export const blocks = (e: Ev): any[] => (e.kind === 'assistant' ? e.data.content ?? [] : []);
export const textOf = (e: Ev) => blocks(e).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

// Files an assistant turn touched, from Claude's Edit/Write tools and Codex's file_change items.
export function changedFiles(evs: Ev[], cwd: string): string[] {
  const out = new Set<string>();
  const rel = (p: string) => { const n = p.replaceAll('\\', '/'), c = cwd.replaceAll('\\', '/').replace(/\/$/, ''); return n.toLowerCase().startsWith(c.toLowerCase() + '/') ? n.slice(c.length + 1) : n; };
  for (const e of evs) for (const b of blocks(e)) {
    if (b.type !== 'tool_use') continue;
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && typeof b.input?.file_path === 'string') out.add(rel(b.input.file_path));
    if (b.name === 'file_change' && Array.isArray(b.input)) for (const c of b.input) if (c?.path) out.add(rel(c.path));
  }
  return [...out];
}

export function sessionToMarkdown(s: Session, evs: Ev[]): string {
  const out = [`# ${s.title || 'Chat'}`, '', `- Agent: ${s.provider}${s.model ? ` (${s.model})` : ''}`, `- Folder: ${s.cwd}`, `- Exported: ${new Date().toLocaleString()}`, ''];
  for (const e of evs) {
    if (e.kind === 'user') out.push(`## You${e.data.system ? ' (system)' : ''}`, '', e.data.text ?? '', '');
    else if (e.kind === 'assistant') {
      const t = textOf(e);
      if (t) out.push(`## ${s.provider === 'codex' ? 'Codex' : 'Claude'}`, '', t, '');
      for (const b of blocks(e)) if (b.type === 'tool_use') out.push(`> tool: \`${b.name}\` ${JSON.stringify(b.input).slice(0, 200)}`, '');
    }
  }
  return out.join('\n');
}

export const langOf = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ({ mjs: 'js', cjs: 'js', tsx: 'ts', jsx: 'js', py: 'py', sh: 'sh', ps1: 'ps1', yml: 'yaml', md: 'md' } as Record<string, string>)[ext] ?? ext;
};

export const shell = (b: any) => (b.name === 'Bash' || b.name === 'shell') ? String(b.input?.command ?? '') : '';
