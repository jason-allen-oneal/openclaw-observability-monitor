export type ApiStatus = {
  ok: boolean;
  gatewayConnected: boolean;
  gatewayUrl: string;
  openclawVersion?: string;
  updateAvailable?: boolean;
  now?: number;
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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
