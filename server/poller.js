import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class Poller {
  constructor({ gw, insertEvent, onSnapshot }) {
    this.gw = gw;
    this.insertEvent = insertEvent;
    this.onSnapshot = onSnapshot;
    this.timers = [];
    this.running = false;
    this.pricing = this._loadPricing();
  }

  _loadPricing() {
    try {
      const p = join(__dirname, 'pricing.json');
      const raw = readFileSync(p, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;

    // Sessions snapshot every 5s
    this.timers.push(setInterval(() => void this._pollSessions(), 5000));
    // Cron snapshot every 15s
    this.timers.push(setInterval(() => void this._pollCron(), 15000));

    // initial
    void this._pollSessions();
    void this._pollCron();
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async _pollSessions() {
    try {
      const payload = await this.gw.request('sessions.list', { includeGlobal: true, includeUnknown: true, limit: 500 });
      
      // Augment sessions with drift metrics
      if (payload && Array.isArray(payload.sessions)) {
        payload.sessions = payload.sessions.map(s => {
          const pressure = s.contextTokens > 0 ? (s.totalTokens / s.contextTokens) * 100 : 0;
          let cost = 0;
          if (this.pricing) {
            const modelPrice = this.pricing.models[s.model] || this.pricing.default;
            if (modelPrice) {
              const inputTokens = s.totalTokens * 0.8;
              const outputTokens = s.totalTokens * 0.2;
              cost = (inputTokens / 1000 * (modelPrice.input || 0)) + (outputTokens / 1000 * (modelPrice.output || 0));
            }
          }
          return {
            ...s,
            drift: {
              pressure: Number(pressure.toFixed(2)),
              cost: Number(cost.toFixed(4))
            }
          };
        });
      }

      this.onSnapshot?.({ kind: 'sessions', payload });
    } catch (err) {
      // console.error('Poll sessions error:', err);
    }
  }

  async _pollCron() {
    try {
      const payload = await this.gw.request('cron.list', { includeDisabled: true });
      this.onSnapshot?.({ kind: 'cron', payload });
    } catch {
      // ignore
    }
  }
}
