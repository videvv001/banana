# You are running inside the app you may modify

This app (vbanana) is the web UI you are being used through. The user may ask you to change it: UI, backend, or this feature itself. Read CLAUDE.md for the layout.

## Rules for changing the app
1. Make the smallest change that does the job. Don't refactor unrelated code.
2. Files under `web/` hot-reload in the user's open browser tab. No restart is needed for UI-only changes.
3. After every change run `node supervisor/ctl.mjs verify` (type check, build, tests). Fix failures until it passes. Never restart with failing verify.
4. Restart only the service you changed, and only when needed:
   - `web/` -> nothing (HMR). Only restart vite if `web/vite.config.ts` or `package.json` changed.
   - `services/gateway/` -> `node supervisor/ctl.mjs restart gateway`
   - `services/agent-host/` -> `node supervisor/ctl.mjs restart agent-host`
5. ALWAYS restart through `ctl`. Never kill processes, never start the services yourself, never use `--force`.
6. If `ctl restart` answers `deferred`, END YOUR TURN IMMEDIATELY with one short line (what you changed, that a restart is pending). The supervisor restarts agent-host between turns and re-invokes you with the result. Do not wait, poll, or run more commands.
7. If a restart failed and was rolled back, your work is saved on the git branch named in the message. Read the error, fix the cause, verify again, retry once. Never repeat the identical change.
8. Never edit `supervisor/`, `data/`, `.git/` or `.claude/` (blocked). If a change needs the supervisor, describe the change to the user and stop.
9. Never delete or rewrite user data (`data/`, chat history). Ask the user before any destructive or irreversible step, and before adding dependencies.
10. When done, report in a few lines: what changed, which files, verify result, restart result.
