import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsStore } from "../src/server/store.server";
import {
  IncidentRecorder,
  incidentReasons,
} from "../src/server/incidents.server";
import type { DiagnosticSample } from "../src/lib/diagnostics";

const stores: MetricsStore[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function store() {
  const s = new MetricsStore(":memory:");
  stores.push(s);
  return s;
}
const sample = (timestamp: number, blocked = 0): DiagnosticSample => ({
  timestamp,
  durationMs: 5,
  load: 1,
  runnable: 1,
  blocked,
  cpu: { busy: 20, iowait: 0, steal: 0 },
  pressure: {
    cpu: { some: 0, full: null },
    memory: { some: 0, full: 0 },
    io: { some: 0, full: 0 },
  },
  swapIn: 0,
  swapOut: 0,
  majorFaults: 0,
  disks: [],
  threads: [],
  warnings: [],
});

test("saves the pre-trigger window, merges recurring triggers and captures two minutes of recovery", () => {
  const s = store(),
    recorder = new IncidentRecorder(s, 4);
  for (let i = 0; i < 400; i++) recorder.accept(sample(i * 1000));
  expect(s.incidents()).toEqual([]);
  recorder.accept(sample(400_000, 12));
  expect(s.incidents()[0]).toMatchObject({
    startedAt: 101_000,
    triggeredAt: 400_000,
    status: "recording",
    samples: 300,
    reasons: ["Blocked tasks"],
  });
  recorder.accept(sample(450_000, 8));
  recorder.accept(sample(520_000));
  expect(s.incidents()).toHaveLength(1);
  expect(s.incidents()[0].status).toBe("recording");
  recorder.accept(sample(570_000));
  const summary = s.incidents()[0];
  expect(summary.status).toBe("complete");
  expect(s.incident(summary.id)?.readings.at(-1)?.timestamp).toBe(570_000);
  recorder.accept(sample(580_000, 9));
  expect(s.incidents()).toHaveLength(2);
});

test("caps a continuous incident at ten minutes and applies cooldown before the next recording", () => {
  const s = store(),
    r = new IncidentRecorder(s, 4);
  r.accept(sample(1000, 2));
  r.accept(sample(601_000, 2));
  expect(s.incidents()[0].status).toBe("complete");
  r.accept(sample(620_000, 2));
  expect(s.incidents()).toHaveLength(1);
  r.accept(sample(661_000, 2));
  expect(s.incidents()).toHaveLength(2);
});

test("triggers on pressure and core-normalized queues without requiring high CPU utilization", () => {
  const reading = sample(1000);
  expect(incidentReasons(reading, 4)).toEqual([]);
  expect(
    incidentReasons(
      {
        ...reading,
        load: 9,
        runnable: 9,
        pressure: { ...reading.pressure, io: { some: 20, full: 5 } },
      },
      4,
    ),
  ).toEqual([
    "Run queue above twice core count",
    "Load above twice core count",
    "IO pressure",
  ]);
  expect(
    incidentReasons(
      {
        ...reading,
        pressure: { ...reading.pressure, memory: { some: 10, full: 0 } },
      },
      4,
    ),
  ).toEqual(["MEMORY pressure"]);
});

test("retains incident evidence across restart and marks incomplete recordings interrupted", () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-incidents-"));
  dirs.push(dir);
  const path = join(dir, "history.sqlite");
  const s = new MetricsStore(path);
  const r = new IncidentRecorder(s, 4);
  r.accept(sample(1000, 4));
  const id = s.incidents()[0].id;
  s.close();
  const reopened = new MetricsStore(path);
  stores.push(reopened);
  expect(reopened.incident(id)).toMatchObject({
    status: "interrupted",
    samples: 1,
    readings: [sample(1000, 4)],
  });
});

test("bounds incident count and age without deleting ordinary metric history", () => {
  const s = store();
  for (let i = 1; i <= 55; i++) {
    const t = i * 1000;
    const id = s.startIncident(t, ["test"]);
    s.saveIncident(id, [sample(t)], ["test"], "complete");
  }
  expect(s.incidents()).toHaveLength(50);
  expect(s.incident(1)).toBeNull();
  const t = 8 * 86400_000,
    id = s.startIncident(t, ["test"]);
  s.saveIncident(id, [sample(t)], ["test"], "complete");
  expect(s.incidents()).toHaveLength(1);
  expect(s.summary().count).toBe(0);
});

test("bounds each incident payload by trimming oldest readings and reports the actual retained window", () => {
  const s = store();
  const id = s.startIncident(1000, ["test"]);
  const big = Array.from({ length: 10 }, (_, i) => ({
    ...sample(1000 + i * 1000),
    warnings: ["x".repeat(600_000)],
  }));
  s.saveIncident(id, big, ["test"], "complete");
  const retained = s.incident(id)!;
  expect(retained.samples).toBeLessThan(10);
  expect(retained.endedAt).toBe(10000);
  expect(retained.startedAt).toBeGreaterThan(1000);
  expect(Buffer.byteLength(JSON.stringify(retained.readings))).toBeLessThan(
    4 * 1024 * 1024,
  );
});

test("expires old incidents during quiet sampling, even without a new trigger", () => {
  const s = store(),
    r = new IncidentRecorder(s, 4);
  r.accept(sample(1000, 2));
  r.accept(sample(121000));
  expect(s.incidents()).toHaveLength(1);
  r.accept(sample(8 * 86400_000));
  expect(s.incidents()).toHaveLength(0);
});

test("enforces the total payload budget across recordings", () => {
  const s = store();
  for (let i = 0; i < 12; i++) {
    const id = s.startIncident(1000 + i, ["test"]);
    s.saveIncident(
      id,
      [{ ...sample(1000 + i), warnings: ["x".repeat(3 * 1024 * 1024)] }],
      ["test"],
      "complete",
    );
  }
  const summaries = s.incidents();
  const bytes = summaries.reduce(
    (sum, item) =>
      sum + Buffer.byteLength(JSON.stringify(s.incident(item.id)!.readings[0])),
    0,
  );
  expect(bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  expect(summaries.length).toBeLessThan(12);
});
