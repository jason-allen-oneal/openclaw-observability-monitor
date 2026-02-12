export class Poller {
  constructor({ gw, insertEvent, onSnapshot }) {
    this.gw = gw;
    this.insertEvent = insertEvent;
    this.onSnapshot = onSnapshot;
    this.timers = [];
    this.running = false;
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
      this.onSnapshot?.({ kind: 'sessions', payload });
    } catch {
      // ignore; gateway may be disconnected
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
