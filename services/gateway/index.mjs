// Public face. Password login -> signed cookie; everything else is proxied: /api/* to agent-host,
// the rest (incl. Vite HMR websocket) to Vite. Stateless, so restarting it is free; browsers reconnect.
// Bind stays 127.0.0.1: put Caddy/Tailscale in front for remote access, never expose this port raw.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = +process.env.GATEWAY_PORT;
const UP = { vite: +process.env.VITE_PORT, agent: +process.env.AGENT_PORT };
const DATA = process.env.DATA_DIR;
const CTL = `http://127.0.0.1:${process.env.CTL_PORT}`;
const MAX_AGE = 30 * 24 * 3600;

const secretFile = (name, make) => {
  const f = path.join(DATA, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, make());
  return fs.readFileSync(f, 'utf8').trim();
};
const SECRET = secretFile('cookie-secret', () => crypto.randomBytes(32).toString('hex'));
const PASSWORD = process.env.BANANA_PASSWORD || secretFile('password', () => crypto.randomBytes(9).toString('base64url'));
const ctlToken = () => fs.readFileSync(path.join(DATA, 'ctl-token'), 'utf8').trim();

const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const makeCookie = () => { const exp = Date.now() + MAX_AGE * 1000; return `${exp}.${hmac(String(exp))}`; };
function authed(req) {
  const v = /(?:^|;\s*)vb=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (!v) return false;
  const [exp, sig] = v.split('.');
  return !!sig && +exp > Date.now() && same(sig, hmac(exp));
}

// ponytail: in-memory per-IP limiter (5 bad passwords/min); fine for one user, use a store if multi-user.
const fails = new Map();
const limited = (ip) => { const f = fails.get(ip); return !!f && f.reset > Date.now() && f.n >= 5; };
const fail = (ip) => { const f = fails.get(ip); fails.set(ip, f && f.reset > Date.now() ? { ...f, n: f.n + 1 } : { n: 1, reset: Date.now() + 60000 }); };

const LOGIN_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>banana</title>
<style>body{font:16px system-ui;background:#14161a;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0}
form{display:grid;gap:10px;width:260px}input,button{font:inherit;padding:8px;border-radius:6px;border:1px solid #333;background:#1d2026;color:inherit}#e{color:#ff6b6b;min-height:1em}</style>
<form id=f><input id=p type=password placeholder=password autofocus autocomplete=current-password><button>Sign in</button><div id=e></div></form>
<script>f.onsubmit=async ev=>{ev.preventDefault();const r=await fetch('/api/login',{method:'POST',body:JSON.stringify({password:p.value})});
if(r.ok)location.href='/';else e.textContent=r.status==429?'too many attempts':'wrong password'}</script>`;

function proxy(port, req, res) {
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('upstream down'); });
  res.on('close', () => up.destroy()); // client gone (e.g. SSE tab closed) -> drop upstream
  req.pipe(up);
}

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { if (b.length < 4096) b += d; }); req.on('end', () => r(b)); });

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/health') return res.end('ok');

  if (pathname === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress ?? '';
    if (limited(ip)) return res.writeHead(429).end();
    let pw = '';
    try { pw = JSON.parse(await readBody(req)).password ?? ''; } catch { /* bad body = wrong password */ }
    if (typeof pw !== 'string' || !same(hmac(pw), hmac(PASSWORD))) { fail(ip); return res.writeHead(401).end(); }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return res.writeHead(200, { 'set-cookie': `vb=${makeCookie()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}${secure}` }).end();
  }
  if (pathname === '/login') return res.writeHead(200, { 'content-type': 'text/html' }).end(LOGIN_PAGE);

  if (!authed(req)) {
    if (pathname.startsWith('/api/')) return res.writeHead(401).end();
    return res.writeHead(302, { location: '/login' }).end();
  }

  if (pathname === '/api/status') {
    try {
      const r = await fetch(`${CTL}/status`, { headers: { 'x-ctl-token': ctlToken() } });
      return res.writeHead(200, { 'content-type': 'application/json' }).end(await r.text());
    } catch {
      return res.writeHead(502).end('supervisor unreachable');
    }
  }
  proxy(pathname.startsWith('/api/') ? UP.agent : UP.vite, req, res);
});

// Raw TCP tunnel for websocket upgrades (Vite HMR), same auth.
server.on('upgrade', (req, sock, head) => {
  if (!authed(req)) return sock.destroy();
  const up = net.connect(UP.vite, '127.0.0.1', () => {
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      headers.push(`${k}: ${k.toLowerCase() === 'host' ? `127.0.0.1:${UP.vite}` : req.rawHeaders[i + 1]}`);
    }
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
    up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`gateway on 127.0.0.1:${PORT}`));
