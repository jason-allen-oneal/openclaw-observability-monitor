#!/usr/bin/env node
/* eslint-disable no-console */

// Monitor Dashboard pretty-printer for Discord.
// Usage:
//   node monitor-stats.js summary|cost|models

const BASE = process.env.MONITOR_DASHBOARD_URL || 'http://127.0.0.1:5176';

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch (e) {
    throw new Error(`${path} -> invalid JSON: ${String(e.message || e)}`);
  }
}

function money(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function pct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0%';
  return `${n.toFixed(0)}%`;
}

function headroomLine({ remainingTokens, contextTokens }) {
  if (typeof remainingTokens !== 'number' || typeof contextTokens !== 'number' || contextTokens <= 0) return '—';
  const used = Math.max(0, contextTokens - remainingTokens);
  const p = Math.min(100, Math.max(0, used / contextTokens * 100));
  return `${used}/${contextTokens} (${pct(p)} used)`;
}

function codeBlock(s) {
  return '```\n' + s.trimEnd() + '\n```';
}

function safeGet(obj, path, fallback = null) {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = cur[key];
  }
  return (cur === undefined ? fallback : cur);
}

function topSessionsByModel(sessions, limit = 8) {
  const map = new Map();
  for (const s of sessions) {
    const m = s?.model;
    if (!m) continue;
    map.set(m, (map.get(m) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function main() {
  const mode = (process.argv[2] || 'summary').toLowerCase();

  const out = [];

  // Always try status/overview first
  let overview = null;
  try {
    const ov = await getJson('/api/overview');
    if (ov?.ok) overview = ov;
  } catch {}

  let usage = null;
  try {
    const u = await getJson('/api/usage-cost');
    if (u?.ok) usage = u;
  } catch {}

  let catalog = null;
  try {
    const c = await getJson('/api/model-catalog');
    if (c?.ok) catalog = c;
  } catch {}

  if (mode === 'cost' || mode === 'summary') {
    out.push('MONITOR COST');
    if (!usage?.data) {
      out.push('ERROR: usage-cost unavailable');
    } else {
      const totals = usage.data.totals || {};
      out.push(`Total (last ${usage.data.days ?? '?'} days): $${money(totals.totalCost)}`);
      out.push(`- input: $${money(totals.inputCost)} | output: $${money(totals.outputCost)} | cache_read: $${money(totals.cacheReadCost)}`);
      out.push('');
      const daily = Array.isArray(usage.data.daily) ? usage.data.daily.slice(-7) : [];
      for (const d of daily) {
        out.push(`${d.date}: $${money(d.totalCost)} (in:${money(d.inputCost)} out:${money(d.outputCost)} cache:${money(d.cacheReadCost)})`);
      }
      if (usage.error) out.push(`\nNOTE: stale data (last error: ${usage.error})`);
    }
    out.push('');
  }

  if (mode === 'models' || mode === 'summary') {
    out.push('MODELS');
    const primary = catalog?.primary || '—';
    const fallbacks = Array.isArray(catalog?.fallbacks) ? catalog.fallbacks : [];
    out.push(`Primary: ${primary}`);
    out.push(`Fallbacks: ${fallbacks.length ? fallbacks.join(', ') : '—'}`);

    const sessions = safeGet(overview, ['sessions', 'topPressure'], [])
      .concat(safeGet(overview, ['sessions', 'topCost'], []));

    // Pull live sessions snapshot for better model coverage
    let sessionsSnap = null;
    try {
      const ss = await getJson('/api/snapshot/sessions');
      sessionsSnap = ss?.snapshot?.payloadJson ? JSON.parse(ss.snapshot.payloadJson) : null;
    } catch {}

    const allSessions = Array.isArray(sessionsSnap?.sessions) ? sessionsSnap.sessions : [];

    out.push('');
    out.push('Top models by active sessions:');
    const top = topSessionsByModel(allSessions, 8);
    if (!top.length) out.push('- —');
    for (const [m, count] of top) out.push(`- ${m}: ${count}`);

    out.push('');
    out.push('Headroom (sample of most recent sessions):');
    const sample = allSessions.slice(0, 8);
    if (!sample.length) out.push('- —');
    for (const s of sample) {
      const hr = headroomLine({ remainingTokens: s.remainingTokens, contextTokens: s.contextTokens });
      out.push(`- ${s.key || 'session'} | ${s.model || '—'} | ${hr}`);
    }

    out.push('');
  }

  if (mode === 'summary') {
    out.unshift('MONITOR DASHBOARD SUMMARY');
    if (overview?.gateway) {
      out.unshift(`Gateway: ${overview.gateway.connected ? 'CONNECTED' : 'DISCONNECTED'}${overview.gateway.error ? ` (${overview.gateway.error})` : ''}`);
    }
  }

  // Discord-friendly block
  console.log(codeBlock(out.join('\n')));
}

main().catch((e) => {
  console.log(codeBlock(`ERROR: ${String(e.message || e)}`));
  process.exit(1);
});
