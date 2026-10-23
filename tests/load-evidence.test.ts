import { afterEach, expect, test } from "bun:test";
import { MetricsStore } from "../src/server/store.server";
import { summarizeLoadEvidence, workloadName } from "../src/lib/load-evidence";
import type { DiagnosticSample } from "../src/lib/diagnostics";
import type { Sample } from "../src/lib/metrics";
const stores: MetricsStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function store() {
  const s = new MetricsStore(":memory:");
  stores.push(s);
  return s;
}
const at = 1_000_000;
const task = (id = "boot:10:11:100") => ({
  id,
  pid: 10,
  tid: 11,
  name: "sqlite3",
  cgroup: "0::/system.slice/uptime-dashboard-backup.service",
  wait: "io_schedule",
});
function reading(timestamp: number, id?: string): DiagnosticSample {
  return {
    timestamp,
    durationMs: 5,
    load: 14,
    runnable: 2,
    blocked: 12,
    cpu: { busy: 20, iowait: 70, steal: 0 },
    pressure: { cpu: null, memory: null, io: null },
    swapIn: 0,
    swapOut: 0,
    majorFaults: 0,
    disks: [
      {
        device: "mmcblk0",
        readBytes: 1024,
        writeBytes: 2048,
        latencyMs: 250,
        queue: 12,
        inFlight: 3,
      },
    ],
    threads: [task(id)],
    warnings: ["Some kernel wait locations unavailable"],
  };
}
function cpu(timestamp: number, id: string, value: number | null): Sample {
  return {
    timestamp,
    uptime: 100,
    cpu: 30,
    load: null,
    temperature: null,
    cores: [],
    memory: null,
    disk: null,
    rx: null,
    tx: null,
    disks: [],
    networks: [],
    warnings: [],
    processes: [
      {
        id,
        pid: id === "old" ? 99 : 10,
        name: id === "old" ? "old-worker" : "sqlite3",
        cpu: value,
        memory: 1,
      },
    ],
  };
}

test("uses only the preceding minute and deduplicates overlapping incident buffers", () => {
  const s = store();
  const rows = [
    reading(at - 61000),
    reading(at - 60000),
    reading(at - 5000),
    reading(at + 1000),
  ];
  for (let i = 0; i < 2; i++) {
    const id = s.startIncident(at, ["Blocked tasks"]);
    s.saveIncident(id, rows, ["Blocked tasks"], "complete");
  }
  const e = s.loadEvidence(at);
  expect(e).toMatchObject({
    at,
    from: at - 60000,
    to: at,
    readings: 2,
    firstReading: at - 60000,
    lastReading: at - 5000,
    peakBlocked: 12,
    peakIoWait: 70,
  });
  expect(e.blockedTasks[0]).toMatchObject({
    name: "sqlite3",
    pid: 10,
    observations: 2,
    waits: ["io_schedule"],
  });
  expect(e.disks[0]).toEqual({
    device: "mmcblk0",
    peakLatencyMs: 250,
    peakQueue: 12,
  });
  expect(e.warnings).toHaveLength(1);
});

test("ranks CPU processes in the selected minute rather than elsewhere in the chart", () => {
  const s = store();
  s.insert(cpu(at - 61000, "old", 100));
  s.insert(cpu(at - 5000, "new", 3));
  s.insert(cpu(at - 1000, "new", 7));
  s.insert(cpu(at + 1000, "old", 100));
  expect(s.loadEvidence(at).busyProcesses).toEqual([
    { id: "new", pid: 10, name: "sqlite3", peakCpu: 7, observations: 2 },
  ]);
  expect(s.loadEvidence(at).peakBlocked).toBeNull();
});

test("preserves missing task evidence and null CPU readings as unknown", () => {
  const s = store();
  s.insert(cpu(at - 5000, "new", null));
  expect(s.loadEvidence(at)).toMatchObject({
    readings: 0,
    firstReading: null,
    lastReading: null,
    blockedTasks: [],
    busyProcesses: [],
    peakBlocked: null,
    peakIoWait: null,
    disks: [],
  });
  expect(
    summarizeLoadEvidence(
      at,
      [
        {
          ...reading(at),
          blocked: null,
          cpu: { busy: null, iowait: null, steal: null },
        },
      ],
      [],
    ).peakIoWait,
  ).toBeNull();
});

test("keeps reused task identities separate and counts a task only once per reading", () => {
  const a = reading(at - 5000);
  a.threads.push(task());
  const e = summarizeLoadEvidence(
    at,
    [a, reading(at - 1000, "boot:10:11:200")],
    [],
  );
  expect(e.blockedTasks).toHaveLength(2);
  expect(e.blockedTasks.map((t) => t.observations)).toEqual([1, 1]);
});

test("sorts recurring blocked workloads ahead of incidental waits and bounds chart details", () => {
  const a = reading(at - 5000);
  a.threads.push(
    ...Array.from({ length: 20 }, (_, i) => ({
      ...task(`boot:${20 + i}:1:100`),
      pid: 20 + i,
    })),
  );
  const e = summarizeLoadEvidence(at, [a, reading(at - 1000)], []);
  expect(e.blockedTasks).toHaveLength(6);
  expect(e.blockedTasks[0]).toMatchObject({ pid: 10, observations: 2 });
});

test("extracts service and container names without requiring a Docker socket", () => {
  expect(workloadName(task().cgroup)).toBe("uptime-dashboard-backup.service");
  expect(
    workloadName("0::/system.slice/docker-abcdef123456789012345678.scope"),
  ).toBe("container abcdef123456");
  expect(workloadName("0::/")).toBeNull();
  expect(workloadName(null)).toBeNull();
});
