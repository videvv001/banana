export type Ev = { seq?: number; session_id: string; kind: string; data: any; ts?: number };
export type Session = { id: string; title: string; cwd: string; status: string; updated_at: number };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
