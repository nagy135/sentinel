import type { DiagnosticSample } from "../lib/diagnostics";
import type { MetricsStore } from "./store.server";
import {
  LinuxDiagnostics,
  diagnosticsSupported,
  logicalCores,
} from "./diagnostics.server";

// Trigger on current stalls/queues as well as the slower one-minute load average.
export function incidentReasons(
  sample: DiagnosticSample,
  cores: number,
): string[] {
  const reasons: string[] = [];
  if ((sample.blocked ?? 0) >= 2 || sample.threads.length >= 2)
    reasons.push("Blocked tasks");
  if ((sample.runnable ?? 0) > cores * 2)
    reasons.push("Run queue above twice core count");
  if ((sample.load ?? 0) > cores * 2)
    reasons.push("Load above twice core count");
  for (const [resource, threshold] of [
    ["cpu", 25],
    ["memory", 10],
    ["io", 10],
  ] as const)
    if ((sample.pressure[resource]?.some ?? 0) >= threshold)
      reasons.push(`${resource.toUpperCase()} pressure`);
  return reasons;
}

export class IncidentRecorder {
  readonly supported = diagnosticsSupported();
  latest: DiagnosticSample | null = null;
  error: string | null = null;
  private ring: { reading: DiagnosticSample; bytes: number }[] = [];
  private ringBytes = 0;
  private active: {
    id: number;
    triggeredAt: number;
    lastTrigger: number;
    reasons: Set<string>;
  } | null = null;
  private cooldownUntil = 0;
  private lastPruneAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private sensor = new LinuxDiagnostics();
  constructor(
    private store: MetricsStore,
    private cores = logicalCores(),
  ) {}

  // Kept separate from the timer so incident lifecycle can be verified with recorded samples.
  accept(reading: DiagnosticSample) {
    const now = reading.timestamp;
    const bytes = Buffer.byteLength(JSON.stringify(reading));
    this.latest = reading;
    this.ring.push({ reading, bytes });
    this.ringBytes += bytes;
    while (
      this.ring.length &&
      (this.ring.length > 300 ||
        this.ringBytes > 4 * 1024 * 1024 ||
        this.ring[0]!.reading.timestamp < now - 300_000)
    ) {
      this.ringBytes -= this.ring.shift()!.bytes;
    }
    if (now - this.lastPruneAt >= 60_000) {
      this.store.pruneIncidents(now);
      this.lastPruneAt = now;
    }
    const reasons = incidentReasons(reading, this.cores);
    let readings = [reading];
    if (!this.active && reasons.length && now >= this.cooldownUntil) {
      this.active = {
        id: this.store.startIncident(now, reasons),
        triggeredAt: now,
        lastTrigger: now,
        reasons: new Set(reasons),
      };
      readings = this.ring.map((entry) => entry.reading);
    }
    if (!this.active) return;
    if (reasons.length) this.active.lastTrigger = now;
    reasons.forEach((reason) => this.active!.reasons.add(reason));
    const capped = now - this.active.triggeredAt >= 600_000;
    const finished = capped || now - this.active.lastTrigger >= 120_000;
    this.store.saveIncident(
      this.active.id,
      readings,
      [...this.active.reasons],
      finished ? "complete" : "recording",
    );
    if (finished) {
      this.active = null;
      // A continuous event is split into bounded recordings with a one-minute pause.
      this.cooldownUntil = capped ? now + 60_000 : now;
    }
  }

  start() {
    if (!this.supported || this.pending || this.timer || this.stopped) return;
    void this.tick();
  }
  private async tick() {
    const started = Date.now();
    this.pending = (async () => {
      try {
        this.accept(await this.sensor.capture(started));
        this.error = null;
      } catch (error) {
        this.error =
          error instanceof Error
            ? error.message
            : "Diagnostic collection failed";
        console.error("[sentinel] Diagnostics:", this.error);
      }
    })();
    await this.pending;
    this.pending = null;
    if (!this.stopped)
      this.timer = setTimeout(
        () => void this.tick(),
        Math.max(100, 1000 - (Date.now() - started)),
      );
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
    if (this.active)
      this.store.saveIncident(
        this.active.id,
        [],
        [...this.active.reasons],
        "interrupted",
      );
  }
  status() {
    return {
      supported: this.supported,
      latest: this.latest,
      error: this.error,
      incidents: this.store.incidents(),
    };
  }
}
