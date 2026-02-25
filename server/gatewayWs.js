import WebSocket from 'ws';
import crypto from 'node:crypto';
import os from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

function rid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return b64urlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function buildDeviceAuthPayload(params) {
  const version = params.version || 'v2';
  const scopes = params.scopes.join(',');
  const token = params.token || '';
  const nonce = params.nonce || '';
  
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token
  ];
  if (version === 'v2') {
    base.push(nonce);
  }
  const payload = base.join('|');
  // console.log(`[GatewayWs] Built payload: ${payload}`);
  return payload;
}

class DeviceIdentityStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  loadOrCreateIdentity() {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
        if (
          parsed?.version === 1 &&
          typeof parsed.deviceId === 'string' &&
          typeof parsed.publicKeyPem === 'string' &&
          typeof parsed.privateKeyPem === 'string'
        ) {
          const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
          if (derivedId !== parsed.deviceId) {
            const updated = { ...parsed, deviceId: derivedId };
            writeFileSync(this.filePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
            try { chmodSync(this.filePath, 0o600); } catch {}
            return {
              deviceId: derivedId,
              publicKeyPem: parsed.publicKeyPem,
              privateKeyPem: parsed.privateKeyPem
            };
          }
          return {
            deviceId: parsed.deviceId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem
          };
        }
      }
    } catch {}

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const deviceId = fingerprintPublicKey(publicKeyPem);

    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      `${JSON.stringify({ version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() }, null, 2)}\n`,
      { mode: 0o600 }
    );
    try { chmodSync(this.filePath, 0o600); } catch {}
    return { deviceId, publicKeyPem, privateKeyPem };
  }
}

class DeviceTokenStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  _read() {
    try {
      if (!existsSync(this.filePath)) return null;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (parsed?.version !== 1 || typeof parsed.deviceId !== 'string' || typeof parsed.tokens !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  _write(store) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    try { chmodSync(this.filePath, 0o600); } catch {}
  }

  load(deviceId, role) {
    const s = this._read();
    if (!s || s.deviceId !== deviceId) return null;
    const entry = s.tokens?.[role];
    if (!entry || typeof entry.token !== 'string') return null;
    return entry.token;
  }

  save(deviceId, role, token, scopes) {
    if (!token) return;
    const existing = this._read();
    const next = {
      version: 1,
      deviceId,
      tokens: existing && existing.deviceId === deviceId && existing.tokens ? { ...existing.tokens } : {}
    };
    next.tokens[role] = {
      token,
      role,
      scopes: Array.from(new Set(Array.isArray(scopes) ? scopes.map((s) => String(s).trim()).filter(Boolean) : [])).sort(),
      updatedAtMs: Date.now()
    };
    this._write(next);
  }
}

export class GatewayWs {
  constructor({ url, token, onEvent, onStatus, stateDir = join(process.env.HOME || '.', '.openclaw', 'monitor-dashboard') }) {
    this.url = url;
    this.token = token;
    this.onEvent = onEvent;
    this.onStatus = onStatus;

    this.ws = null;
    this.pending = new Map();
    this.connected = false;

    this._reconnectTimer = null;
    this._connectSent = false;
    this._connectNonce = null;

    this._identityStore = new DeviceIdentityStore(join(stateDir, 'identity', 'device.json'));
    this._tokenStore = new DeviceTokenStore(join(stateDir, 'identity', 'device-auth.json'));
    this._identity = this._identityStore.loadOrCreateIdentity();
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
    this._connectNonce = null;
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

    const role = 'operator';
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
    const clientId = 'openclaw-control-ui';
    const clientMode = 'webchat';

    const auth = this.token ? { token: this.token } : undefined;
    const signedAtMs = Date.now();
    const nonce = (typeof this._connectNonce === 'string' && this._connectNonce.length > 0)
      ? this._connectNonce
      : null;

    if (!nonce) {
      // We should only send `connect` after the gateway provides a challenge nonce.
      this.connected = false;
      this.onStatus?.({ connected: false, error: 'missing connect.challenge nonce' });
      try { this.ws?.close(4000, 'missing nonce'); } catch {}
      return;
    }

    const payload = buildDeviceAuthPayload({
      version: 'v2',
      deviceId: this._identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: this.token || '',
      nonce
    });

    const params = {
      minProtocol: 3,
      maxProtocol: 3, 
      client: {
        id: clientId,
        version: 'dev',
        platform: process.platform,
        mode: clientMode
      },
      role,
      scopes,
      device: {
        id: this._identity.deviceId,
        publicKey: b64urlEncode(derivePublicKeyRaw(this._identity.publicKeyPem)),
        signature: signDevicePayload(this._identity.privateKeyPem, payload),
        signedAt: signedAtMs,
        nonce
      },
      caps: [],
      auth,
      userAgent: `rev-monitor-dashboard/${os.hostname()}/${process.version}`,
      locale: 'en-US'
    };

    try {
      const hello = await this.request('connect', params);
      const issuedToken = hello?.auth?.deviceToken;
      if (issuedToken) this._tokenStore.save(this._identity.deviceId, role, issuedToken, hello?.auth?.scopes ?? scopes);
      this.connected = true;
      this._connectNonce = null;
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
        Origin: 'http://localhost:18789'
      }
    });

    this.ws.on('open', async () => {
      this.onStatus?.({ connected: false, phase: 'ws-open' });
      // Per gateway protocol: wait for `connect.challenge` before sending `connect`.
      this._connectSent = false;
      this._connectNonce = null;
    });

    this.ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }

      if (msg?.type === 'event') {
        if (msg.event === 'connect.challenge') {
          this._connectNonce = msg?.payload?.nonce ?? null;
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
      }
    });

    this.ws.on('close', (code, reasonBuf) => {
      const reason = String(reasonBuf ?? '');
      this.ws = null;
      this.connected = false;
      this._connectSent = false;
      this._connectNonce = null;
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
