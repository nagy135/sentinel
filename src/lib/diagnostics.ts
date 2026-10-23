export interface PressureMetric {
  // Percentage of this sampling interval with some/all non-idle tasks stalled.
  some: number | null;
  full: number | null;
}
export interface BlockedThread {
  id: string;
  pid: number;
  tid: number;
  name: string;
  cgroup: string | null;
  wait: string | null;
}
export interface DiskActivity {
  device: string;
  readBytes: number | null;
  writeBytes: number | null;
  latencyMs: number | null;
  queue: number | null;
  inFlight: number;
}
export interface DiagnosticSample {
  timestamp: number;
  durationMs: number;
  load: number | null;
  runnable: number | null;
  blocked: number | null;
  cpu: { busy: number | null; iowait: number | null; steal: number | null };
  pressure: Record<"cpu" | "memory" | "io", PressureMetric | null>;
  swapIn: number | null;
  swapOut: number | null;
  majorFaults: number | null;
  disks: DiskActivity[];
  threads: BlockedThread[];
  warnings: string[];
}
export interface IncidentSummary {
  id: number;
  startedAt: number;
  triggeredAt: number;
  endedAt: number;
  status: "recording" | "complete" | "interrupted";
  reasons: string[];
  samples: number;
}
export interface IncidentDetail extends IncidentSummary {
  readings: DiagnosticSample[];
}
export interface DiagnosticStatus {
  supported: boolean;
  latest: DiagnosticSample | null;
  error: string | null;
  incidents: IncidentSummary[];
}
