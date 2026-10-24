// `npm run check`: everything that must pass before a restart is allowed.
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const run = (cmd) => {
  console.log(`> ${cmd}`);
  try { execSync(cmd, { stdio: 'inherit' }); } catch { console.error(`VERIFY FAILED: ${cmd}`); process.exit(1); }
};

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : [];
});
for (const f of [...walk('supervisor'), ...walk('services')]) run(`node --check ${f}`);
run('npx tsc -p web');
run('npx vite build --config web/vite.config.ts --outDir ../dist --emptyOutDir');
run('node --test');
