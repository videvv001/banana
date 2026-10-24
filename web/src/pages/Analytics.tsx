import { useState } from 'react';
import { Agent, Badge, Empty, Seg, Skeleton, fmtDur, useFetch } from '../ui';

type By = { tasks: number; done: number; failed: number; running: number; durationMs: number; timed: number; cost: number; costN: number; tokens: number; tokensN: number };
type A = { days: number; tasks: number; sessions: number; totalSessions: number; by: Record<string, By>; perDay: Record<string, number> };

export function Analytics() {
  const [days, setDays] = useState('30');
  const { data: a, loading } = useFetch<A>(`/api/analytics?days=${days}`);
  const rows = Object.entries(a?.by ?? {});
  const sum = (k: keyof By) => rows.reduce((n, [, p]) => n + p[k], 0);

  // One bar per day in the range, oldest first.
  const bars = a ? Array.from({ length: +days }, (_, i) => { const d = new Date(Date.now() - (+days - 1 - i) * 864e5).toLocaleDateString('en-CA'); return [d, a.perDay[d] ?? 0] as const; }) : [];
  const max = Math.max(1, ...bars.map(([, n]) => n));

  return (
    <div className="page">
      <div className="page-head"><div className="grow"><h1>Analytics</h1><p>Computed from your own event log.</p></div>
        <Seg label="Range" value={days} onChange={setDays} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days']]} /></div>

      {loading || !a ? <Skeleton rows={5} /> : !a.tasks ? <div className="card"><Empty title="No activity in this range" icon="chart">Run a task and come back.</Empty></div> : (
        <>
          <div className="card row" style={{ gap: 32 }}>
            <div className="stat"><b>{a.sessions}</b><span className="muted small">sessions active</span></div>
            <div className="stat"><b>{a.tasks}</b><span className="muted small">tasks</span></div>
            <div className="stat"><b>{Math.round((sum('done') / Math.max(1, sum('done') + sum('failed'))) * 100)}%</b><span className="muted small">success rate (finished tasks)</span></div>
            <div className="stat"><b>{fmtDur(sum('timed') ? Math.round(sum('durationMs') / sum('timed')) : null)}</b><span className="muted small">avg duration</span></div>
          </div>

          <section className="card col">
            <h2>Activity</h2>
            <div className="bars" role="img" aria-label={`Tasks per day over ${days} days, peak ${max}`}>{bars.map(([d, n]) => <i key={d} title={`${d}: ${n} task${n === 1 ? '' : 's'}`} style={{ height: `${(n / max) * 100}%`, opacity: n ? .85 : .18 }} />)}</div>
            <div className="row muted xs"><span>{bars[0]?.[0]}</span><span className="grow" /><span>peak {max}/day</span><span className="grow" /><span>{bars[bars.length - 1]?.[0]}</span></div>
          </section>

          <section className="card col">
            <h2>By agent</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Agent</th><th>Tasks</th><th>Done</th><th>Failed</th><th>Avg duration</th><th>Cost</th><th>Tokens</th></tr></thead>
                <tbody>{rows.map(([p, v]) => (
                  <tr key={p}>
                    <td><Agent p={p} /></td><td>{v.tasks}</td><td className="ok">{v.done}</td><td className={v.failed ? 'bad' : ''}>{v.failed}</td>
                    <td>{fmtDur(v.timed ? Math.round(v.durationMs / v.timed) : null)}</td>
                    <td>{v.costN ? <>${v.cost.toFixed(3)} <Badge>reported by CLI · {v.costN}/{v.tasks} tasks</Badge></> : <Badge>unavailable</Badge>}</td>
                    <td>{v.tokensN ? <>{v.tokens.toLocaleString()} <Badge>reported by CLI · {v.tokensN}/{v.tasks}</Badge></> : <Badge>unavailable</Badge>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="muted xs">Cost and token figures are only what each CLI reports per turn; nothing is estimated. "Unavailable" means the CLI didn't include it. Subscription plans may not bill per token at all, so treat cost as indicative, not an invoice. Tasks from before usage tracking was added have no token data.</p>
          </section>
        </>
      )}
    </div>
  );
}
