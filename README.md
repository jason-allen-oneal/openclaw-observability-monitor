# OpenClaw Monitor Dashboard

A high-performance observability dashboard for OpenClaw: gateway status, event feed, and agent snapshots.

## Features

- **Device Identity Support**: Ed25519-based cryptographic handshake with the OpenClaw Gateway.
- **Persistent Token Storage**: Securely stores issued device tokens for seamless reconnection.
- **ZeroSignal Aesthetic**: CRT scanline effects, flickering terminal style, and monospace grid layout.
- **Event Feed**: Real-time streaming of gateway events and agent activity.
- **Snapshots**: View agent reasoning and internal state snapshots.

## Install

```bash
cd monitor-dashboard
npm install
```

## Run

### One-command start

Build UI + start the server:

```bash
npm start
```

Open: http://localhost:5176

### Dev (UI)

```bash
npm run dev
```

(Vite UI on http://localhost:5177; server still runs separately if you want live data.)

## Configuration

### Get your Gateway token

On the OpenClaw host:

```bash
openclaw dashboard --no-open
```

Copy the `token` value from the printed URL.

By default, the server reads your local OpenClaw config to find the gateway URL + token:

- `~/.openclaw/openclaw.json` → `gateway.port`, `gateway.auth.token`

To run against a different host (or without local OpenClaw config), set:

```bash
export OPENCLAW_GATEWAY_URL='ws://127.0.0.1:18789'
export OPENCLAW_GATEWAY_TOKEN='<GATEWAY_TOKEN>'

# optional: store locally in .env (gitignored) instead
# OPENCLAW_GATEWAY_URL=...
# OPENCLAW_GATEWAY_TOKEN=...

npm start
```

## Security / OPSEC

- Designed for **localhost** usage.
- Treat the gateway token like a password.
- The server sets basic hardening headers (CSP, XFO DENY, nosniff, no-referrer, permissions-policy, COOP/CORP).
- Prefer `.env` (gitignored) for local config; see `.env.example`.
