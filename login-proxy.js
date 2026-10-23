#!/usr/bin/env node
// Web sign-in in front of ttyd. ttyd only offers HTTP basic auth, which password
// managers can't fill; this serves a normal login form, sets a signed session
// cookie, and proxies HTTP + WebSocket to a ttyd bound to loopback.
//
//   TTYD_CREDENTIAL=user:password node login-proxy.js tmux new -A -s main
//
// Env: TTYD_CREDENTIAL (required, user:password), PORT (7681), TTYD_PORT (7682),
//      SESSION_DAYS (30). Changing the credential invalidates existing sessions.
"use strict";
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");

const credential = process.env.TTYD_CREDENTIAL || "";
const sep = credential.indexOf(":");
if (sep < 1 || sep === credential.length - 1) {
  console.error("TTYD_CREDENTIAL must be set as user:password");
  process.exit(1);
}
const USER = credential.slice(0, sep);
const PASS = credential.slice(sep + 1);
const PORT = Number(process.env.PORT || 7681);
const TTYD_PORT = Number(process.env.TTYD_PORT || 7682);
const SESSION_MS = Number(process.env.SESSION_DAYS || 30) * 86400e3;
const COOKIE = "ttyd_session";
const KEY = crypto.createHash("sha256").update("ttyd-session:" + credential).digest();

const sign = (s) => crypto.createHmac("sha256", KEY).update(s).digest("base64url");
const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function newSession() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}
function cookieOf(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : "";
}
function authed(req) {
  const [exp, mac] = cookieOf(req).split(".");
  return !!(exp && mac && Number(exp) > Date.now() && safeEqual(mac, sign(exp)));
}
function setCookie(req, value, maxAge) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

// Per-IP lockout: 5 failures -> 1 minute, doubling each further failure, capped at 15 min.
const fails = new Map();
function lockedFor(ip) {
  const f = fails.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(60e3 * 2 ** (f.n - 5), 900e3);
  fails.set(ip, f);
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function loginPage(error, next) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #111; color: #eee; }
  form { width: min(320px, 90vw); display: grid; gap: 12px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  input, button { font: inherit; padding: 10px 12px; border-radius: 6px; border: 1px solid #555; background: #1c1c1c; color: inherit; }
  button { background: #d97757; border-color: #d97757; color: #111; font-weight: 600; cursor: pointer; }
  .err { color: #ff8a8a; margin: 0; }
</style></head><body>
<form method="post" action="/login">
  <h1>Claude terminal</h1>
  ${error ? `<p class="err">${esc(error)}</p>` : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <input name="username" autocomplete="username" placeholder="Username" autocapitalize="none" autofocus required>
  <input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

function readForm(req, cb) {
  let body = "";
  req.on("data", (d) => {
    body += d;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => cb(new URLSearchParams(body)));
}
const safeNext = (n) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

function html(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress;
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/login") {
    if (req.method === "POST") {
      return readForm(req, (form) => {
        const next = safeNext(form.get("next"));
        const wait = lockedFor(ip);
        if (wait) return html(res, 429, loginPage(`Too many attempts. Try again in ${wait}s.`, next));
        const ok = safeEqual(form.get("username") || "", USER) & safeEqual(form.get("password") || "", PASS);
        if (!ok) {
          recordFail(ip);
          return setTimeout(() => html(res, 401, loginPage("Wrong username or password.", next)), 500);
        }
        fails.delete(ip);
        res.writeHead(303, { Location: next, "Set-Cookie": setCookie(req, newSession(), SESSION_MS / 1000) });
        res.end();
      });
    }
    return html(res, 200, loginPage("", safeNext(url.searchParams.get("next"))));
  }

  if (url.pathname === "/logout") {
    res.writeHead(303, { Location: "/login", "Set-Cookie": setCookie(req, "", 0) });
    return res.end();
  }

  if (!authed(req)) {
    res.writeHead(303, { Location: "/login?next=" + encodeURIComponent(req.url) });
    return res.end();
  }

  const up = http.request(
    { host: "127.0.0.1", port: TTYD_PORT, method: req.method, path: req.url, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    }
  );
  up.on("error", () => html(res, 502, "ttyd is not reachable"));
  req.pipe(up);
});

// WebSocket: authenticate, then splice the raw sockets together.
server.on("upgrade", (req, socket, head) => {
  if (!authed(req)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  const up = net.connect(TTYD_PORT, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  const close = () => {
    up.destroy();
    socket.destroy();
  };
  up.on("error", close);
  socket.on("error", close);
  socket.on("close", close);
  up.on("close", close);
});

const cmd = process.argv.slice(2);
if (!cmd.length) cmd.push("tmux", "new", "-A", "-s", "main");
const ttyd = spawn("ttyd", ["-W", "-i", "127.0.0.1", "-p", String(TTYD_PORT), ...cmd], { stdio: "inherit" });
ttyd.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => ttyd.kill(sig));

server.listen(PORT, () => console.log(`login proxy on :${PORT} -> ttyd on 127.0.0.1:${TTYD_PORT}`));
