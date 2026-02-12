import WebSocket from 'ws';

function rid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export class GatewayWs {
  constructor({ url, token, onEvent, onStatus }) {
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;
    this.onStatus = onStatus;

    this.ws = null;
    this.pending = new Map();
    this.connected = false;

    this._reconnectTimer = null;
    this._connectSent = false;
  }

  start() {
    if (this.ws) return;
    this._connect();
  }

  stop() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this._connectSent = false;
    this.pending.clear();
  }

  request(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'));
    }
    const id = rid();
    const msg = { type: 'req', id, method, params };
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(msg));
    return p;
  }

  async _sendConnect() {
    if (this._connectSent) return;
    this._connectSent = true;

    const auth = this.token ? { token: this.token } : undefined;
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: 'dev',
        platform: process.platform,
        mode: 'webchat'
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
      device: undefined,
      caps: [],
      auth,
      userAgent: `openclaw-monitor-dashboard/${process.version}`,
      locale: 'en-US'
    };

    try {
      await this.request('connect', params);
      this.connected = true;
      this.onStatus?.({ connected: true });
    } catch (e) {
      this.connected = false;
      this.onStatus?.({ connected: false, error: String(e?.message ?? e) });
      try { this.ws?.close(4000, 'connect failed'); } catch {}
    }
  }

  _connect() {
    this.ws = new WebSocket(this.url, {
      headers: {
        // Gateway enforces Control UI origins.
        Origin: 'http://localhost:5176'
      }
    });

    this.ws.on('open', async () => {
      this.onStatus?.({ connected: false, phase: 'ws-open' });
      this._connectSent = false;
      await this._sendConnect();
    });

    this.ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }

      if (msg?.type === 'event') {
        if (msg.event === 'connect.challenge') {
          // We do not sign device identity here; try reconnect w/token only.
          this._connectSent = false;
          void this._sendConnect();
          return;
        }
        this.onEvent?.(msg);
        return;
      }

      if (msg?.type === 'res') {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.payload);
        else p.reject(new Error(msg.error?.message ?? 'request failed'));
        return;
      }
    });

    this.ws.on('close', (code, reasonBuf) => {
      const reason = String(reasonBuf ?? '');
      this.ws = null;
      this.connected = false;
      this._connectSent = false;
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error(`gateway closed (${code}): ${reason}`));
        this.pending.delete(id);
      }
      this.onStatus?.({ connected: false, code, reason });
      this._scheduleReconnect();
    });

    this.ws.on('error', () => {});
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, 1000);
  }
}
