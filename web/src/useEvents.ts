import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Ev, type Session } from './api';

// Live state from one SSE stream. We track the last durable seq and reconnect ourselves
// (EventSource gives up on non-200s, e.g. while the gateway/agent-host restarts).
export function useEvents() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Map<number, Ev>>(new Map());
  const [partial, setPartial] = useState<Record<string, string>>({});
  const [online, setOnline] = useState(false);
  const lastSeq = useRef(-1);

  const refresh = useCallback(async () => {
    const r = await api<{ sessions: Session[]; maxSeq: number }>('/api/sessions');
    setSessions(r.sessions);
    return r.maxSeq;
  }, []);

  const addEvents = useCallback((evs: Ev[]) => {
    setEvents((prev) => { const m = new Map(prev); for (const e of evs) m.set(e.seq!, e); return m; });
  }, []);

  useEffect(() => {
    let es: EventSource | undefined, timer: number | undefined, dead = false;
    const retry = () => { if (!dead) timer = window.setTimeout(connect, 1500); };
    async function connect() {
      try {
        const max = await refresh();
        if (lastSeq.current < 0) lastSeq.current = max;
      } catch { return retry(); }
      es = new EventSource(`/api/stream?after=${lastSeq.current}`);
      es.onopen = () => setOnline(true);
      es.onerror = () => { es?.close(); setOnline(false); retry(); };
      es.onmessage = (m) => {
        const ev: Ev = JSON.parse(m.data);
        if (ev.seq) { lastSeq.current = ev.seq; addEvents([ev]); }
        if (ev.kind === 'delta') setPartial((p) => ({ ...p, [ev.session_id]: (p[ev.session_id] ?? '') + ev.data.text }));
        if (ev.kind === 'assistant' || ev.kind === 'result') setPartial((p) => ({ ...p, [ev.session_id]: '' }));
        if (ev.kind === 'status') setSessions((ss) => ss.map((s) => (s.id === ev.session_id ? { ...s, status: ev.data.status } : s)));
        if (ev.kind === 'user') refresh().catch(() => {}); // new session title / ordering
      };
    }
    connect();
    return () => { dead = true; es?.close(); clearTimeout(timer); };
  }, [refresh, addEvents]);

  const loadSession = useCallback(async (id: string) => {
    const r = await api<{ events: Ev[] }>(`/api/sessions/${id}/events`);
    addEvents(r.events.map((e) => ({ ...e, session_id: id })));
  }, [addEvents]);

  return { sessions, events, partial, online, refresh, loadSession };
}
