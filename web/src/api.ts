export type Ev = { seq?: number; session_id: string; kind: string; data: any; ts?: number };
export type Session = {
  id: string; title: string; cwd: string; status: string; updated_at: number; provider: string; model: string;
  started: number; ext_id: string; pinned: number; archived: number; cmp: string;
};
export type ServerSettings = {
  defaultAgent: string; defaultProject: string; instructions: Record<string, string>; autoAllowReadOnly: boolean;
  cliPaths: Record<string, string>; defaultModels: Record<string, string>;
};
export type Cli = { installed: boolean; loggedIn: boolean; version?: string; detail?: string };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  if (!r.ok) {
    // Every HTTP failure surfaces as a toast, so callers can't silently swallow it.
    let msg = await r.text().catch(() => '');
    try { msg = JSON.parse(msg).error ?? msg; } catch { /* plain text */ }
    msg = `${path.split('?')[0]}: ${msg || r.status}`;
    window.dispatchEvent(new CustomEvent('toast', { detail: { msg, kind: 'error' } }));
    throw new Error(msg);
  }
  return r.json();
}

export const qs = (o: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString();
