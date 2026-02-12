# Contributing (Monitor Dashboard)

This repo is an intentionally small observability UI + tiny Node server.

## Dev setup

```bash
npm install
npm run dev
```

- Vite UI: http://localhost:5177
- Server: `npm start` (serves dist on http://localhost:5176)

## Configure gateway

Prefer env vars in dev:

```bash
export OPENCLAW_GATEWAY_URL='ws://127.0.0.1:18789'
export OPENCLAW_GATEWAY_TOKEN='<token>'
```

## Building

```bash
npm run build
```

## Security

- Treat the gateway token like a password.
- Keep the server bound to localhost.
- Do not add arbitrary command execution.

## PRs

- One focused change per PR.
- Include a note about how to verify.
