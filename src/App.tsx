import React, { useEffect, useMemo, useState } from 'react';
import { apiGet, ApiModelCatalog, ApiOverview, ApiStatus, ApiUsageCost, EventRow, SnapshotRow } from './api';
import modelMetadata from './model-metadata.json';

type Tab = 'overview' | 'sessions' | 'subagents' | 'cron' | 'models' | 'feed' | 'search';

function fmt(ts: number) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [feed, setFeed] = useState<EventRow[]>([]);
  const [feedType, setFeedType] = useState<string>('');
  const [feedSessionKey, setFeedSessionKey] = useState<string>('');

  async function refreshStatus() {
    try {
      const s = await apiGet<ApiStatus>('/api/status');
      setStatus(s);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  async function refreshFeed() {
    const qs = new URLSearchParams();
    qs.set('limit', '100');
    if (feedType.trim()) qs.set('type', feedType.trim());
    if (feedSessionKey.trim()) qs.set('sessionKey', feedSessionKey.trim());

    try {
      const rows = await apiGet<{ events: EventRow[] }>(`/api/events?${qs.toString()}`);
      setFeed(rows.events);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void refreshStatus();
    const t = setInterval(() => void refreshStatus(), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab !== 'feed') return;
    void refreshFeed();
    const t = setInterval(() => void refreshFeed(), 2000);
    return () => clearInterval(t);
  }, [tab, feedType, feedSessionKey]);

  const connectedDot = useMemo(() => {
    if (!status) return 'warn';
    return status.gatewayConnected ? 'ok' : 'bad';
  }, [status]);

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="brand">
          <div>
            <div className="brandTitle">OpenClaw Monitor</div>
            <div className="small">Local ops console</div>
          </div>
          <span className="badge">
            <span className={`dot ${connectedDot}`}>●</span>
            {status?.gatewayConnected ? 'Gateway OK' : 'Gateway OFF'}
          </span>
        </div>

        <div className="small">
          <div>Gateway: <span style={{ color: 'var(--muted)' }}>{status?.gatewayUrl ?? '—'}</span></div>
          <div>OpenClaw: <span style={{ color: 'var(--muted)' }}>{status?.openclawVersion ?? '—'}</span></div>
          <div>Update: <span style={{ color: 'var(--muted)' }}>{status?.updateAvailable ? 'available' : '—'}</span></div>
          {err ? <div style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</div> : null}
        </div>

        <div className="nav">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Sessions</button>
          <button className={tab === 'subagents' ? 'active' : ''} onClick={() => setTab('subagents')}>Sub-agents</button>
          <button className={tab === 'cron' ? 'active' : ''} onClick={() => setTab('cron')}>Cron</button>
          <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>Models</button>
          <button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>Activity Feed</button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search</button>
        </div>

        {tab === 'feed' ? (
          <div className="card">
            <div className="cardTitle">Feed filters</div>
            <div className="small" style={{ marginBottom: 8 }}>Persisted to SQLite; refreshes every 2s.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={feedType} onChange={(e) => setFeedType(e.target.value)} placeholder="type (chat/tool/cron/...)" />
              <input value={feedSessionKey} onChange={(e) => setFeedSessionKey(e.target.value)} placeholder="sessionKey contains…" />
              <button onClick={() => void refreshFeed()}>Refresh now</button>
            </div>
          </div>
        ) : null}

        <div className="small">Listening on <b>http://localhost:5176/</b></div>
      </div>

      <div className="main">
        <div className="header">
          <div style={{ fontWeight: 800, letterSpacing: '0.02em' }}>{tab.toUpperCase()}</div>
          <div className="small">{status?.now ? fmt(status.now) : ''}</div>
        </div>

        <div className="content">
          {tab === 'overview' ? <Overview /> : null}
          {tab === 'feed' ? <Feed rows={feed} /> : null}
          {tab === 'sessions' ? <Sessions /> : null}
          {tab === 'subagents' ? <Subagents /> : null}
          {tab === 'cron' ? <Cron /> : null}
          {tab === 'models' ? <Models /> : null}
          {tab === 'search' ? <Search /> : null}
        </div>
      </div>
    </div>
  );
}

function msToHuman(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtUsd(n: number | null | undefined) {
  const val = Number(n);
  if (!Number.isFinite(val)) return '—';
  return `$${val.toFixed(4)}`;
}

function Overview() {
  const [ov, setOv] = useState<ApiOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await apiGet<ApiOverview>('/api/overview');
      setOv(data);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, []);

  const byType = ov?.events?.byType ?? {};
  const maxCount = Math.max(1, ...Object.values(byType));
  const typeRows = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err ? <div className="card" style={{ borderColor: 'var(--danger)' }}>{err}</div> : null}

      <div className="cards">
        <div className="card">
          <div className="cardTitle">At-a-glance</div>
          <div className="small">Ops summary (refreshes every ~4s).</div>
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <div>Server uptime: <span style={{ color: 'var(--muted)' }}>{ov ? msToHuman(ov.server.upMs) : '—'}</span></div>
            <div>Gateway: <span style={{ color: ov?.gateway.connected ? 'var(--ok)' : 'var(--danger)' }}>{ov?.gateway.connected ? 'CONNECTED' : 'OFFLINE'}</span></div>
            <div>Gateway uptime (since monitor start): <span style={{ color: 'var(--muted)' }}>{ov ? fmtPct(ov.gateway.uptimePct) : '—'}</span></div>
            <div>Active sessions: <span style={{ color: 'var(--muted)' }}>{ov?.sessions.count ?? '—'}</span></div>
            <div>Cron jobs: <span style={{ color: 'var(--muted)' }}>{ov?.cron.count ?? '—'}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">Event volume (last hour)</div>
          <div className="small">Total: {ov?.events.lastHourTotal ?? '—'} events</div>
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            {typeRows.length === 0 ? <div className="small">No events captured yet.</div> : null}
            {typeRows.slice(0, 8).map(([t, c]) => (
              <div key={t} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 54px', gap: 10, alignItems: 'center' }}>
                <div className="small">{t}</div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${(c / maxCount) * 100}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
                <div className="small" style={{ textAlign: 'right' }}>{c}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">Next cron</div>
          <div className="small">Soonest scheduled run.</div>
          <div style={{ marginTop: 10 }}>
            {ov?.cron.next ? (
              <>
                <div style={{ color: 'var(--accent)', fontWeight: 750 }}>{ov.cron.next.name ?? ov.cron.next.id ?? 'job'}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  Next: {ov.cron.next.nextRunAtMs ? fmt(ov.cron.next.nextRunAtMs) : '—'}
                </div>
                <div className="small">Enabled: {String(ov.cron.next.enabled ?? '—')}</div>
              </>
            ) : (
              <div className="small">No cron data yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <div className="cardTitle">Top context pressure</div>
          <div className="small">Highest drift.pressure right now.</div>
          <div style={{ marginTop: 10 }}>
            {ov?.sessions.topPressure?.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Pressure</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.sessions.topPressure.map((s: any) => (
                    <tr key={s.key}>
                      <td style={{ color: 'var(--accent)' }}>{s.key}</td>
                      <td className="small">{s.drift?.pressure ?? 0}%</td>
                      <td className="small">{(s.totalTokens ?? 0).toLocaleString()} / {(s.contextTokens ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="small">No session drift data yet.</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">Top estimated cost</div>
          <div className="small">Local heuristic only; not gateway-billed.</div>
          <div style={{ marginTop: 10 }}>
            {ov?.sessions.topCost?.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Cost</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.sessions.topCost.map((s: any) => (
                    <tr key={s.key}>
                      <td style={{ color: 'var(--accent)' }}>{s.key}</td>
                      <td style={{ color: 'var(--ok)' }}>{fmtUsd(s.drift?.cost)}</td>
                      <td className="small">{s.model ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="small">No cost estimates available.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardTitle">What this is</div>
        <div className="small">
          Local ops console for OpenClaw. Data sources: Gateway WebSocket event feed + periodic snapshots (sessions.list, cron.list).
          Storage: SQLite at <span style={{ color: 'var(--muted)' }}>monitor-dashboard/state/monitor.sqlite</span>.
        </div>
      </div>
    </div>
  );
}

function Feed({ rows }: { rows: EventRow[] }) {
  return (
    <div>
      {rows.length === 0 ? <div className="small">No events yet.</div> : null}
      {rows.map((r) => (
        <div className="feedItem" key={r.id}>
          <div className="feedTop">
            <div>
              <span className="feedType">{r.type}</span>
              <span className="small">{' '}- {r.event}</span>
            </div>
            <div className="small">{fmt(r.ts)}</div>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {r.sessionKey ? <span>session: <span style={{ color: 'var(--muted)' }}>{r.sessionKey}</span> </span> : null}
            {r.tool ? <span>tool: <span style={{ color: 'var(--muted)' }}>{r.tool}</span> </span> : null}
            {r.runId ? <span>run: <span style={{ color: 'var(--muted)' }}>{r.runId}</span></span> : null}
          </div>
          {r.summary ? <div style={{ marginTop: 8 }}>{r.summary}</div> : null}
          <details style={{ marginTop: 8 }}>
            <summary className="small">payload</summary>
            <div className="pre">{r.payloadJson}</div>
          </details>
        </div>
      ))}
    </div>
  );
}

function parseSnapshotPayload(snap: SnapshotRow | null): any {
  if (!snap) return null;
  try { return JSON.parse(snap.payloadJson); } catch { return null; }
}

function Sessions() {
  const [snap, setSnap] = useState<SnapshotRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await apiGet<{ snapshot: SnapshotRow | null }>('/api/snapshot/sessions');
      setSnap(res.snapshot);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  const payload = parseSnapshotPayload(snap);
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div>
            <div className="cardTitle">Active sessions</div>
            <div className="small">Latest snapshot: {snap ? fmt(snap.ts) : '—'}</div>
            <div className="small">Cost is estimated locally; see Models for billed totals.</div>
          </div>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
        {err ? <div style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div> : null}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Model</th>
            <th>Usage</th>
            <th>Pressure</th>
            <th>Cost (est)</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s: any) => (
            <tr key={s.key}>
              <td style={{ color: 'var(--accent)' }}>{s.key}</td>
              <td className="small">{s.model}</td>
              <td className="small">{(s.totalTokens ?? 0).toLocaleString()}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 60, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${s.drift?.pressure ?? 0}%`, height: '100%', background: (s.drift?.pressure ?? 0) > 80 ? 'var(--danger)' : 'var(--accent)' }} />
                  </div>
                  <span className="small">{s.drift?.pressure ?? 0}%</span>
                </div>
              </td>
              <td style={{ color: 'var(--ok)' }}>{fmtUsd(s.drift?.cost)}</td>
              <td className="small">{s.updatedAt ? fmt(s.updatedAt) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details style={{ marginTop: 12 }}>
        <summary className="small">raw snapshot</summary>
        <div className="pre">{snap?.payloadJson ?? ''}</div>
      </details>
    </div>
  );
}

function Subagents() {
  const [rows, setRows] = useState<any[]>([]);
  const [snapTs, setSnapTs] = useState<number | null>(null);

  async function refresh() {
    const res = await apiGet<{ subagents: any[]; snapshot: { ts: number } | null }>('/api/subagents');
    setRows(res.subagents ?? []);
    setSnapTs(res.snapshot?.ts ?? null);
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  function statusFor(s: any) {
    const u = Number(s.updatedAt ?? 0);
    if (!u) return 'unknown';
    const age = now - u;
    if (age < 15_000) return 'running';
    if (age < 5 * 60_000) return 'idle';
    return 'stale';
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardTitle">Sub-agents (sessions_spawn)</div>
        <div className="small">Latest snapshot: {snapTs ? fmt(snapTs) : '—'}</div>
        <div className="small">Cost is estimated locally; see Models for billed totals.</div>
      </div>

      {rows.length === 0 ? <div className="small">No sub-agents found.</div> : null}

      <table className="table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Pressure</th>
            <th>Cost (est)</th>
            <th>Key</th>
            <th>Updated</th>
            <th>Last event</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s: any) => (
            <tr key={s.key}>
              <td>{s.label ?? ''}</td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${s.drift?.pressure ?? 0}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  <span className="small">{s.drift?.pressure ?? 0}%</span>
                </div>
              </td>
              <td style={{ color: 'var(--ok)' }}>{fmtUsd(s.drift?.cost)}</td>
              <td style={{ color: 'var(--accent)', fontSize: 11 }}>{s.key}</td>
              <td className="small">{s.updatedAt ? fmt(s.updatedAt) : ''}</td>
              <td className="small">{s.lastEvent?.summary ?? s.lastEvent?.event ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cron() {
  const [snap, setSnap] = useState<SnapshotRow | null>(null);
  async function refresh() {
    const res = await apiGet<{ snapshot: SnapshotRow | null }>('/api/snapshot/cron');
    setSnap(res.snapshot);
  }
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 15000); return () => clearInterval(t); }, []);

  const payload = parseSnapshotPayload(snap);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : (Array.isArray(payload) ? payload : []);

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="cardTitle">Cron jobs</div>
        <div className="small">Latest snapshot: {snap ? fmt(snap.ts) : '—'}</div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Enabled</th>
            <th>Schedule</th>
            <th>Next</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j: any) => (
            <tr key={j.id ?? j.jobId ?? j.name}>
              <td style={{ color: 'var(--accent)' }}>{j.name ?? j.id ?? 'job'}</td>
              <td>{String(j.enabled ?? '')}</td>
              <td className="small">{j.schedule ? JSON.stringify(j.schedule) : ''}</td>
              <td className="small">{j.nextRunAtMs ? fmt(j.nextRunAtMs) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details style={{ marginTop: 12 }}>
        <summary className="small">raw snapshot</summary>
        <div className="pre">{snap?.payloadJson ?? ''}</div>
      </details>
    </div>
  );
}

function Search() {
  return (
    <div className="card">
      <div className="cardTitle">Search</div>
      <div className="small">
        Coming next: unified search across events/snapshots, then memory/workspace. For now, use Activity Feed filters.
      </div>
    </div>
  );
}

function normalizeUsageCost(raw: any) {
  if (!raw || typeof raw !== 'object') return { totalCost: null, breakdown: [] as any[] };
  const totalCost = raw.totalCost ?? raw.total?.cost ?? raw.cost ?? raw.total ?? null;
  const source = raw.breakdown ?? raw.byModel ?? raw.models ?? raw.items ?? null;
  if (Array.isArray(source)) return { totalCost, breakdown: source };
  if (source && typeof source === 'object') {
    return {
      totalCost,
      breakdown: Object.entries(source).map(([key, value]) => {
        if (value && typeof value === 'object') return { model: key, ...value };
        return { model: key, cost: value };
      })
    };
  }
  return { totalCost, breakdown: [] };
}

function findModelId(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') return null;
  if (typeof obj !== 'object') return null;
  const direct = obj.model ?? obj.modelId ?? obj.model_id ?? null;
  if (typeof direct === 'string') return direct;
  for (const val of Object.values(obj)) {
    const found = findModelId(val);
    if (found) return found;
  }
  return null;
}

function extractCapsFromObject(obj: any) {
  const caps: { rpm?: number; tpm?: number; dailySpendCapUsd?: number } = {};
  if (!obj || typeof obj !== 'object') return caps;

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const k = key.toLowerCase();
      if (k.includes('ratelimit') || k.includes('rate_limit')) {
        if (typeof value === 'string' || typeof value === 'number') {
          const n = Number(value);
          if (Number.isFinite(n)) {
            if (k.includes('token') || k.includes('tpm')) caps.tpm = caps.tpm ?? n;
            else if (k.includes('request') || k.includes('rpm')) caps.rpm = caps.rpm ?? n;
          }
        }
      }
      if (k.includes('daily') || k.includes('spend') || k.includes('budget')) {
        if (typeof value === 'string' || typeof value === 'number') {
          const n = Number(value);
          if (Number.isFinite(n)) caps.dailySpendCapUsd = caps.dailySpendCapUsd ?? n;
        }
      }
      if (typeof value === 'object') walk(value);
    }
  };
  walk(obj);
  return caps;
}

function Models() {
  const [catalog, setCatalog] = useState<ApiModelCatalog | null>(null);
  const [usage, setUsage] = useState<ApiUsageCost | null>(null);
  const [snap, setSnap] = useState<SnapshotRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function refreshCatalog() {
    try {
      const res = await apiGet<ApiModelCatalog>('/api/model-catalog');
      setCatalog(res);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  async function refreshUsage() {
    try {
      const res = await apiGet<ApiUsageCost>('/api/usage-cost');
      setUsage(res);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  async function refreshSessions() {
    try {
      const res = await apiGet<{ snapshot: SnapshotRow | null }>('/api/snapshot/sessions');
      setSnap(res.snapshot);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  async function refreshEvents() {
    try {
      const res = await apiGet<{ events: EventRow[] }>('/api/events?limit=200');
      setEvents(res.events ?? []);
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    void refreshCatalog();
    const t = setInterval(() => void refreshCatalog(), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void refreshUsage();
    const t = setInterval(() => void refreshUsage(), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void refreshSessions();
    const t = setInterval(() => void refreshSessions(), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void refreshEvents();
    const t = setInterval(() => void refreshEvents(), 15_000);
    return () => clearInterval(t);
  }, []);

  const payload = parseSnapshotPayload(snap);
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const modelsFromCatalog = Array.isArray(catalog?.models) ? catalog!.models! : [];
  const modelIdsFromDefaults = [
    ...(catalog?.primary ? [catalog.primary] : []),
    ...(catalog?.fallbacks ?? [])
  ].filter(Boolean);

  const modelMap = new Map<string, any>();
  for (const m of modelsFromCatalog) modelMap.set(m.id, { ...m });
  for (const id of modelIdsFromDefaults) {
    if (!modelMap.has(id)) modelMap.set(id, { id });
  }
  for (const s of sessions) {
    if (s?.model && !modelMap.has(s.model)) modelMap.set(s.model, { id: s.model });
  }

  const capsByModel = new Map<string, { rpm?: number; tpm?: number; dailySpendCapUsd?: number; source?: string }>();
  const sortedEvents = [...events].sort((a, b) => b.ts - a.ts);
  for (const ev of sortedEvents) {
    let payloadObj: any = null;
    try { payloadObj = JSON.parse(ev.payloadJson); } catch { payloadObj = null; }
    if (!payloadObj) continue;
    const modelId = findModelId(payloadObj);
    if (!modelId) continue;
    if (capsByModel.has(modelId)) continue;
    const caps = extractCapsFromObject(payloadObj);
    if (caps.rpm || caps.tpm || caps.dailySpendCapUsd) {
      capsByModel.set(modelId, { ...caps, source: 'auto' });
    }
  }

  const usageNormalized = normalizeUsageCost(usage?.data);
  const usageByModel = new Map<string, any>();
  for (const item of usageNormalized.breakdown) {
    const id = item?.model ?? item?.modelId ?? item?.id ?? item?.name ?? null;
    if (!id) continue;
    const cost = item?.cost ?? item?.totalCost ?? item?.usd ?? item?.amount ?? item?.total ?? null;
    const inputTokens = item?.inputTokens ?? item?.promptTokens ?? item?.inTokens ?? null;
    const outputTokens = item?.outputTokens ?? item?.completionTokens ?? item?.outTokens ?? null;
    const totalTokens = (item?.totalTokens ?? (Number(inputTokens ?? 0) + Number(outputTokens ?? 0))) || null;
    usageByModel.set(id, { cost, inputTokens, outputTokens, totalTokens });
  }

  const rows = [...modelMap.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const warnings: string[] = [];
  if (!usage?.ok) warnings.push('Usage cost unavailable; gateway CLI missing or failed.');
  if (usage?.stale) warnings.push('Usage cost is stale; showing last cached snapshot.');
  if (catalog && !catalog.ok) warnings.push('Model catalog unavailable; check ~/.openclaw/openclaw.json.');
  if (!events.length) warnings.push('Rate limit detection inactive; no recent gateway events.');

  let usedManualCaps = false;
  const now = Date.now();

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err ? <div className="card" style={{ borderColor: 'var(--danger)' }}>{err}</div> : null}
      {warnings.length ? (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="cardTitle">Warning</div>
          <div className="small">{warnings.join(' ')}</div>
        </div>
      ) : null}

      <div className="cards">
        <div className="card">
          <div className="cardTitle">Usage &amp; cost (daily)</div>
          <div className="small">Gateway totals; refreshes every 30s.</div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ok)' }}>{fmtUsd(usageNormalized.totalCost)}</div>
            <div className="small" style={{ marginTop: 6 }}>Total cost today</div>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {usageNormalized.breakdown.length === 0 ? (
              <div className="small">No breakdown available yet.</div>
            ) : usageNormalized.breakdown.slice(0, 8).map((item, idx) => {
              const label = item.model ?? item.modelId ?? item.id ?? item.name ?? `item-${idx}`;
              const cost = item.cost ?? item.totalCost ?? item.usd ?? item.amount ?? item.total ?? null;
              return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div className="small" style={{ color: 'var(--muted)' }}>{label}</div>
                  <div className="small" style={{ color: 'var(--ok)' }}>{fmtUsd(cost)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="cardTitle">Defaults</div>
          <div className="small">From openclaw.json.</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <div>Primary: <span style={{ color: 'var(--accent)' }}>{catalog?.primary ?? '—'}</span></div>
            <div>Fallbacks: <span style={{ color: 'var(--muted)' }}>{(catalog?.fallbacks ?? []).join(', ') || '—'}</span></div>
            <div>Providers: <span style={{ color: 'var(--muted)' }}>{(catalog?.providers ?? []).map(p => p.id).join(', ') || '—'}</span></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardTitle">Models</div>
        <div className="small">Headroom uses max window; caps auto-detected when possible.</div>
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Model</th>
              <th>Status</th>
              <th>Context / Window</th>
              <th>Usage &amp; Cost (daily)</th>
              <th>API Caps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m: any) => {
              const sessionsForModel = sessions.filter((s: any) => s.model === m.id);
              const updatedAt = Math.max(0, ...sessionsForModel.map((s: any) => Number(s.updatedAt ?? 0)));
              const age = updatedAt ? now - updatedAt : Infinity;
              const status = sessionsForModel.length === 0 ? (modelIdsFromDefaults.includes(m.id) ? 'configured' : 'idle')
                : age < 15_000 ? 'hot'
                  : age < 300_000 ? 'warm'
                    : 'cold';
              const statusClass = status === 'hot' ? 'status ok'
                : status === 'warm' ? 'status warn'
                  : status === 'configured' ? 'status accent'
                    : 'status';

              const usedTokens = Math.max(0, ...sessionsForModel.map((s: any) => Number(s.totalTokens ?? 0)));
              const windowTokens = Number(
                m.contextWindow ?? m.maxTokens ?? Math.max(0, ...sessionsForModel.map((s: any) => Number(s.contextTokens ?? 0)))
              ) || 0;
              const ratio = windowTokens > 0 ? Math.min(1, usedTokens / windowTokens) : 0;
              const headroomPct = windowTokens > 0 ? ((1 - ratio) * 100) : 0;

              let caps = capsByModel.get(m.id);
              if (!caps) {
                const manualModel = (modelMetadata as any).models?.[m.id];
                const manual = manualModel ?? (modelMetadata as any).defaults ?? {};
                const hasManual = Number.isFinite(manual?.rpm)
                  || Number.isFinite(manual?.tpm)
                  || Number.isFinite(manual?.dailySpendCapUsd);
                caps = { ...manual, source: hasManual ? 'manual' : undefined };
                if (hasManual) usedManualCaps = true;
              }

              const usageRow = usageByModel.get(m.id) ?? {};
              const cost = usageRow.cost ?? null;
              const totalTokens = usageRow.totalTokens ?? null;

              return (
                <tr key={m.id}>
                  <td>
                    <div style={{ color: 'var(--accent)', fontWeight: 700 }}>{m.id}</div>
                    <div className="small" style={{ marginTop: 4 }}>{m.provider ?? '—'}</div>
                  </td>
                  <td><span className={statusClass}>{status.toUpperCase()}</span></td>
                  <td>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div className="small">{usedTokens.toLocaleString()} / {windowTokens ? windowTokens.toLocaleString() : '—'}</div>
                      <div className="bar">
                        <div className="barFill" style={{ width: `${ratio * 100}%` }} />
                      </div>
                      <div className="small">Headroom: {windowTokens ? `${headroomPct.toFixed(1)}%` : '—'}</div>
                    </div>
                  </td>
                  <td>
                    <div className="small">Cost: <span style={{ color: 'var(--ok)' }}>{fmtUsd(cost)}</span></div>
                    <div className="small">Tokens: <span style={{ color: 'var(--muted)' }}>{Number.isFinite(totalTokens) ? Number(totalTokens).toLocaleString() : '—'}</span></div>
                  </td>
                  <td>
                    <div className="small">RPM: <span style={{ color: 'var(--muted)' }}>{caps?.rpm ?? '—'}</span></div>
                    <div className="small">TPM: <span style={{ color: 'var(--muted)' }}>{caps?.tpm ?? '—'}</span></div>
                    <div className="small">Cap: <span style={{ color: 'var(--muted)' }}>{Number.isFinite(caps?.dailySpendCapUsd) ? fmtUsd(caps?.dailySpendCapUsd) : '—'}</span></div>
                    <div className="small">Source: <span style={{ color: 'var(--muted)' }}>{caps?.source ?? '—'}</span></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {usedManualCaps ? (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="cardTitle">Note</div>
          <div className="small">Some caps are manual. Update `src/model-metadata.json` for better accuracy.</div>
        </div>
      ) : null}
    </div>
  );
}
