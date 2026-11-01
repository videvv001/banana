# banana

Self-modifying web UI over the Claude CLI. Four independent processes, supervised:

| Dir | Process | Port | Notes |
|---|---|---|---|
| `supervisor/` | supervisor | 3100 (control) | Frozen lifeline. Owns the other processes, `ctl.mjs` client, `verify.mjs`, AI rules. Edit only on explicit user instruction. |
| `services/gateway/` | gateway | 7420 | Login + reverse proxy: `/api/*` to agent-host, everything else to Vite. Stateless. |
| `services/agent-host/` | agent-host | 3101 | Spawns one Claude CLI process per turn, SQLite event log (`data/banana.db`), SSE at `/api/stream`. |
| `web/` | vite | 3102 | React + TS UI with HMR. |

- Run everything: `npm start` (supervisor). Check everything: `npm run check`.
- Conversations are `session id + events table`; the browser resumes with `?after=<seq>`. Deltas/status are ephemeral.
- Restart policy (supervisor): verify first; agent-host restarts only between turns; unhealthy restart rolls back to git tag `vb-good`.
- Plain `.mjs` for services (checked with `node --check`), TS for `web/` (checked with `tsc`).
- The in-app assistant's rules live in `supervisor/ai-rules.md`; its permissions in `supervisor/ai-settings.json`.
