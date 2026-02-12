# Quickstart — OpenClaw Monitor Dashboard

## 1) Install

```bash
git clone <YOUR_REPO_URL>
cd monitor-dashboard
npm install
```

## 2) Configure

Set env vars (recommended). Tip: you can copy `.env.example` to `.env` (it’s gitignored):

```bash
export OPENCLAW_GATEWAY_URL='ws://127.0.0.1:18789'
export OPENCLAW_GATEWAY_TOKEN='<TOKEN>'
```

If you don’t set these, the server will try to read:

- `~/.openclaw/openclaw.json`

## 3) Run

```bash
npm start
```

Open: http://localhost:5176
