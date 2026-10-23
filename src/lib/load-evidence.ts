import type { BlockedThread, DiagnosticSample } from "./diagnostics";

export interface BusyProcess {
  id: string;
  pid: number;
  name: string;
  peakCpu: number;
  observations: number;
}
export interface LoadEvidence {
  at: number;
  from: number;
  to: number;
  firstReading: number | null;
  lastReading: number | null;
  readings: number;
  peakBlocked: number | null;
  peakIoWait: number | null;
  blockedTasks: (BlockedThread & { observations: number; waits: string[] })[];
  busyProcesses: BusyProcess[];
  disks: {
    device: string;
    peakLatencyMs: number | null;
    peakQueue: number | null;
  }[];
  warnings: string[];
}
export function workloadName(cgroup: string | null): string | null {
  if (!cgroup) return null;
  const unit = cgroup.match(/(?:^|\/)([^/]+\.(?:service|scope))(?:\/|$)/)?.[1];
  return (
    unit?.replace(/^docker-([a-f0-9]{12})[a-f0-9]+\.scope$/, "container $1") ??
    null
  );
}
const peak = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
};
export function summarizeLoadEvidence(
  at: number,
  readings: DiagnosticSample[],
  busyProcesses: BusyProcess[],
): LoadEvidence {
  const from = Math.max(0, at - 60_000);
  // Pre-trigger buffers can be saved in overlapping incidents; count each instant once.
  const unique = [
    ...new Map(
      readings
        .filter((r) => r.timestamp >= from && r.timestamp <= at)
        .map((r) => [r.timestamp, r]),
    ).values(),
  ].sort((a, b) => a.timestamp - b.timestamp);
  const tasks = new Map<
    string,
    BlockedThread & { observations: number; waits: Set<string> }
  >();
  const disks = new Map<string, LoadEvidence["disks"][number]>();
  for (const r of unique) {
    for (const task of new Map(r.threads.map((t) => [t.id, t])).values()) {
      const entry = tasks.get(task.id) ?? {
        ...task,
        observations: 0,
        waits: new Set<string>(),
      };
      entry.observations++;
      if (task.wait) entry.waits.add(task.wait);
      tasks.set(task.id, entry);
    }
    for (const disk of r.disks) {
      const entry = disks.get(disk.device) ?? {
        device: disk.device,
        peakLatencyMs: null,
        peakQueue: null,
      };
      entry.peakLatencyMs = peak([entry.peakLatencyMs, disk.latencyMs]);
      entry.peakQueue = peak([entry.peakQueue, disk.queue]);
      disks.set(disk.device, entry);
    }
  }
  return {
    at,
    from,
    to: at,
    firstReading: unique[0]?.timestamp ?? null,
    lastReading: unique.at(-1)?.timestamp ?? null,
    readings: unique.length,
    peakBlocked: peak(unique.map((r) => r.blocked)),
    peakIoWait: peak(unique.map((r) => r.cpu.iowait)),
    blockedTasks: [...tasks.values()]
      .sort(
        (a, b) =>
          b.observations - a.observations || a.pid - b.pid || a.tid - b.tid,
      )
      .slice(0, 6)
      .map((t) => ({ ...t, waits: [...t.waits] })),
    busyProcesses,
    disks: [...disks.values()]
      .sort(
        (a, b) =>
          (b.peakLatencyMs ?? -1) - (a.peakLatencyMs ?? -1) ||
          a.device.localeCompare(b.device),
      )
      .slice(0, 4),
    warnings: [...new Set(unique.flatMap((r) => r.warnings))],
  };
}
