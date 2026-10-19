export const ranges = {
  "15m": { label: "Last 15 minutes", ms: 15 * 60_000 },
  "1h": { label: "Last hour", ms: 60 * 60_000 },
  "6h": { label: "Last 6 hours", ms: 6 * 60 * 60_000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60_000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  all: { label: "All history", ms: Infinity },
} as const;
export type Range = keyof typeof ranges;
export interface AbsoluteRange {
  from: number;
  to: number;
}
export type TimeRange = Range | AbsoluteRange;
export function isRange(value: string): value is Range {
  return value in ranges && Object.hasOwn(ranges, value);
}

export interface HostInfo {
  hostname: string;
  platform: "linux" | "darwin";
  os: string;
  release: string;
  kernel: string;
  arch: string;
  cpu: string;
  cores: number;
  physicalCores: number;
  model: string;
}

export interface DiskMetric {
  filesystem: string;
  mount: string;
  type: string;
  total: number;
  used: number;
  available: number;
  percent: number;
}

export interface NetworkMetric {
  iface: string;
  received: number;
  sent: number;
  rx: number | null;
  tx: number | null;
}

export interface Sample {
  timestamp: number;
  uptime: number;
  cpu: number | null;
  cores: (number | null)[];
  memory: {
    total: number;
    used: number;
    percent: number;
    swapUsed: number;
    swapTotal: number;
  } | null;
  disk: number | null;
  rx: number | null;
  tx: number | null;
  disks: DiskMetric[];
  networks: NetworkMetric[];
  warnings: string[];
}

export interface HistoryPoint {
  timestamp: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  rx: number | null;
  tx: number | null;
}

export interface DashboardData {
  host: HostInfo | null;
  latest: Sample | null;
  history: HistoryPoint[];
  storage: {
    count: number;
    first: number | null;
    last: number | null;
    bytes: number;
  };
  collector: { intervalMs: number; running: boolean; error: string | null };
  range: TimeRange;
  window: AbsoluteRange;
  now: number;
}
