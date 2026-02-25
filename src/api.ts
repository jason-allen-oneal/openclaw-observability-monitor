export type ApiStatus = {
  ok: boolean;
  gatewayConnected: boolean;
  gatewayUrl: string;
  openclawVersion?: string;
  updateAvailable?: boolean;
  now?: number;
};

export type ApiOverview = {
  ok: boolean;
  now: number;
  server: { startedAt: number; upMs: number };
  gateway: {
    connected: boolean;
    connectedSince: number | null;
    totalConnectedMs: number;
    uptimePct: number;
    url: string;
    error: any;
  };
  snapshots: { sessionsTs: number | null; cronTs: number | null };
  sessions: { count: number; topPressure: any[]; topCost: any[] };
  cron: { count: number; next: any | null };
  events: { lastHourTotal: number; byType: Record<string, number> };
};

export type EventRow = {
  id: number;
  ts: number;
  event: string;
  type: string;
  sessionKey?: string;
  runId?: string;
  tool?: string;
  summary?: string;
  payloadJson: string;
};

export type SnapshotRow = {
  id: number;
  ts: number;
  kind: string;
  payloadJson: string;
};

export type ApiUsageCost = {
  ok: boolean;
  cached?: boolean;
  stale?: boolean;
  data?: any;
  error?: string | null;
};

export type ApiModelCatalog = {
  ok: boolean;
  primary?: string | null;
  fallbacks?: string[];
  providers?: Array<{
    id: string;
    api?: string | null;
    baseUrl?: string | null;
    models?: any[];
  }>;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    provider?: string;
  }>;
  error?: string;
};

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
