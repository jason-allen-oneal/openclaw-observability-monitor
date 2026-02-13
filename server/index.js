import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { GatewayWs } from './gatewayWs.js';
import { Poller } from './poller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const projectRoot = join(__dirname, '..');

function loadOpenclawConfig() {
  // Allow overrides so this repo is usable outside of an OpenClaw host.
  const envUrl = process.env.OPENCLAW_GATEWAY_URL || process.env.GATEWAY_URL || null;
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || null;

  // If explicitly set, don't attempt to read ~/.openclaw/openclaw.json.
  if (envUrl) {
    return {
      token: envToken,
      url: envUrl,
      cfg: null
    };
  }

  const p = join(process.env.HOME, '.openclaw', 'openclaw.json');
  const raw = readFileSync(p, 'utf8');
  const cfg = JSON.parse(raw);
  const token = envToken ?? (cfg?.gateway?.auth?.token ?? null);
  const port = cfg?.gateway?.port ?? 18789;
  const bind = cfg?.gateway?.bind ?? 'loopback';
  const host = bind === 'loopback' ? '127.0.0.1' : '127.0.0.1';
  const url = `ws://${host}:${port}`;
  return { token, url, cfg };
}

const { token, url: gatewayUrl, cfg } = loadOpenclawConfig();
const { insertEvent, listEvents, insertSnapshot, latestSnapshot, latestEventForSession } = openDb(projectRoot);

const state = {
  startedAt: Date.now(),
  gatewayConnected: false,
  gatewayConnectedSince: null,
  gatewayTotalConnectedMs: 0,
  gatewayError: null,
  gatewayUrl,
  openclawVersion: cfg?.meta?.lastTouchedVersion ?? null,
  updateAvailable: null
};

function classify(ev) {
  const eventName = String(ev?.event ?? '');
  const payload = ev?.payload ?? null;

  // Basic types: chat/tool/cron/presence/agent/device/other
  let type = 'other';
  if (eventName === 'chat') type = 'chat';
  else if (eventName === 'cron') type = 'cron';
  else if (eventName === 'presence') type = 'presence';
  else if (eventName === 'agent') type = 'agent';
  else if (eventName?.startsWith('device.')) type = 'device';

  // Tool calls surface under agent payloads.
  let tool = null;
  let runId = payload?.runId ?? payload?.toolRunId ?? null;
  let sessionKey = payload?.sessionKey ?? null;
  let summary = null;

  if (type === 'agent' && payload) {
    tool = payload?.tool ?? payload?.name ?? null;
    if (payload?.kind === 'tool' && payload?.tool) tool = payload.tool;
    if (payload?.message) summary = payload.message;
  }

  if (type === 'chat' && payload) {
    summary = payload?.state ? `chat.${payload.state}` : 'chat';
    runId = payload?.runId ?? null;
    sessionKey = payload?.sessionKey ?? null;
  }

  return { type, tool, runId, sessionKey, summary };
}

const gw = new GatewayWs({
  url: gatewayUrl,
  token,
  onStatus: (s) => {
    const now = Date.now();
    const nextConnected = !!s.connected;

    // Track connected durations.
    if (nextConnected && !state.gatewayConnected) {
      state.gatewayConnectedSince = now;
    }
    if (!nextConnected && state.gatewayConnected && state.gatewayConnectedSince) {
      state.gatewayTotalConnectedMs += (now - state.gatewayConnectedSince);
      state.gatewayConnectedSince = null;
    }

    state.gatewayConnected = nextConnected;
    state.gatewayError = s.error ?? null;
  },
  onEvent: (ev) => {
    const ts = Date.now();
    const meta = classify(ev);
    try {
      insertEvent({
        ts,
        event: String(ev.event ?? 'event'),
        type: meta.type,
        sessionKey: meta.sessionKey,
        runId: meta.runId,
        tool: meta.tool,
        summary: meta.summary,
        payloadJson: JSON.stringify(ev, null, 2)
      });
    } catch {
      // swallow
    }
  }
});

gw.start();

const poller = new Poller({
  gw,
  insertEvent,
  onSnapshot: ({ kind, payload }) => {
    try {
      insertSnapshot({ ts: Date.now(), kind, payloadJson: JSON.stringify(payload, null, 2) });
    } catch {
      // ignore
    }
  }
});

poller.start();

function hardenHeaders(res) {
  // Basic OWASP-ish headers for a localhost dashboard.
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:;"
  );
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  hardenHeaders(res);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(projectRoot, 'dist', p);

  try {
    const data = readFileSync(filePath);
    const ext = filePath.split('.').pop();
    const ct = ext === 'html' ? 'text/html; charset=utf-8'
      : ext === 'js' ? 'application/javascript; charset=utf-8'
      : ext === 'css' ? 'text/css; charset=utf-8'
      : ext === 'svg' ? 'image/svg+xml'
      : ext === 'png' ? 'image/png'
      : 'application/octet-stream';
    hardenHeaders(res);
    res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');

  if (urlObj.pathname === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      gatewayConnected: state.gatewayConnected,
      gatewayUrl: state.gatewayUrl,
      gatewayError: state.gatewayError,
      openclawVersion: state.openclawVersion,
      updateAvailable: state.updateAvailable,
      now: Date.now()
    });
  }

  if (urlObj.pathname === '/api/events') {
    const type = urlObj.searchParams.get('type') ?? null;
    const sessionKey = urlObj.searchParams.get('sessionKey') ?? null;
    const limit = urlObj.searchParams.get('limit') ?? '100';
    const events = listEvents({ type, sessionKeyLike: sessionKey, limit });
    return sendJson(res, 200, { ok: true, events });
  }

  if (urlObj.pathname === '/api/snapshot/sessions') {
    const snap = latestSnapshot('sessions');
    return sendJson(res, 200, { ok: true, snapshot: snap });
  }

  if (urlObj.pathname === '/api/snapshot/cron') {
    const snap = latestSnapshot('cron');
    return sendJson(res, 200, { ok: true, snapshot: snap });
  }

  if (urlObj.pathname === '/api/overview') {
    const now = Date.now();
    const upMs = now - state.startedAt;

    const sessionsSnap = latestSnapshot('sessions');
    const cronSnap = latestSnapshot('cron');

    let sessions = [];
    try {
      const payload = sessionsSnap ? JSON.parse(sessionsSnap.payloadJson) : null;
      sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    } catch {
      sessions = [];
    }

    let cronJobs = [];
    try {
      const payload = cronSnap ? JSON.parse(cronSnap.payloadJson) : null;
      cronJobs = Array.isArray(payload?.jobs) ? payload.jobs : (Array.isArray(payload) ? payload : []);
    } catch {
      cronJobs = [];
    }

    const topPressure = [...sessions]
      .filter((s) => typeof s?.drift?.pressure === 'number')
      .sort((a, b) => (b.drift.pressure - a.drift.pressure))
      .slice(0, 5);

    const topCost = [...sessions]
      .filter((s) => typeof s?.drift?.cost === 'number')
      .sort((a, b) => (b.drift.cost - a.drift.cost))
      .slice(0, 5);

    const nextCron = [...cronJobs]
      .filter((j) => j && typeof j.nextRunAtMs === 'number')
      .sort((a, b) => a.nextRunAtMs - b.nextRunAtMs)[0] ?? null;

    const recent = listEvents({ type: null, sessionKeyLike: null, limit: 500 });
    const lastHour = now - 60 * 60 * 1000;
    const recentHour = recent.filter((e) => Number(e.ts) >= lastHour);
    const byType = {};
    for (const e of recentHour) byType[e.type] = (byType[e.type] ?? 0) + 1;

    const gwConnectedMs = state.gatewayConnected
      ? state.gatewayTotalConnectedMs + (now - (state.gatewayConnectedSince ?? now))
      : state.gatewayTotalConnectedMs;

    const gwUptimePct = upMs > 0 ? (gwConnectedMs / upMs) * 100 : 0;

    return sendJson(res, 200, {
      ok: true,
      now,
      server: {
        startedAt: state.startedAt,
        upMs
      },
      gateway: {
        connected: state.gatewayConnected,
        connectedSince: state.gatewayConnectedSince,
        totalConnectedMs: gwConnectedMs,
        uptimePct: Number(gwUptimePct.toFixed(2)),
        url: state.gatewayUrl,
        error: state.gatewayError
      },
      snapshots: {
        sessionsTs: sessionsSnap?.ts ?? null,
        cronTs: cronSnap?.ts ?? null
      },
      sessions: {
        count: sessions.length,
        topPressure,
        topCost
      },
      cron: {
        count: cronJobs.length,
        next: nextCron
      },
      events: {
        lastHourTotal: recentHour.length,
        byType
      }
    });
  }

  if (urlObj.pathname === '/api/subagents') {
    const snap = latestSnapshot('sessions');
    if (!snap) return sendJson(res, 200, { ok: true, subagents: [], snapshot: null });
    let payload;
    try { payload = JSON.parse(snap.payloadJson); } catch { payload = null; }
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    const subs = sessions
      .filter((s) => typeof s?.key === 'string' && s.key.includes(':subagent:'))
      .map((s) => {
        const last = latestEventForSession(s.key);
        return {
          ...s,
          lastEvent: last
        };
      });
    return sendJson(res, 200, { ok: true, snapshot: { id: snap.id, ts: snap.ts }, subagents: subs });
  }

  // Everything else = UI bundle
  return serveStatic(req, res);
});

const PORT = Number(process.env.PORT ?? 5176);
server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`monitor dashboard listening on http://localhost:${PORT}`);
});
