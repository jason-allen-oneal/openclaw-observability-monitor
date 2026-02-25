---
name: monitor_stats
description: "Discord slash command: pretty Monitor Dashboard summary (models, usage, cost, caps)."
user-invocable: true
# Keep this deterministic: we run a local formatter script and paste the output.
---

# monitor_stats

Use this command to print a compact, Discord-friendly snapshot of the Monitor Dashboard.

## What it does

- Calls the local Monitor Dashboard API (localhost):
  - `/api/usage-cost`
  - `/api/model-catalog`
  - `/api/overview`
- Formats a readable summary (no markdown tables; use code blocks + bullets).

## How to run

Run the formatter script and paste its output directly.

### Default (summary)

```bash
node "{baseDir}/monitor-stats.js" summary
```

### Cost only

```bash
node "{baseDir}/monitor-stats.js" cost
```

### Models only

```bash
node "{baseDir}/monitor-stats.js" models
```

## Output rules

- Prefer short sections.
- Include:
  - Gateway connected + error (if any)
  - Last 7 days cost totals + today
  - Top models by active sessions + headroom (remaining/context)
  - API caps: autodetect when present, otherwise show manual fallback values.
- If any field is estimated/incomplete, label it clearly as "ESTIMATE".
