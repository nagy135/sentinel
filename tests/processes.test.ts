import { afterEach, expect, test } from "bun:test";
import { MetricsStore } from "../src/server/store.server";
import {
  linuxProcessIdentity,
  selectProcesses,
} from "../src/server/processes.server";
import type { ProcessMetric, Sample } from "../src/lib/metrics";

const stores: MetricsStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const process = (
  pid: number,
  cpu: number | null,
  memory: number | null = 1,
  id = `boot:${pid}:100`,
): ProcessMetric => ({ id, pid, name: `process-${pid}`, cpu, memory });
function store() {
  const db = new MetricsStore(":memory:");
  stores.push(db);
  return db;
}
function sample(timestamp: number, processes: ProcessMetric[] | null): Sample {
  return {
    timestamp,
    processes,
    cpu: 25,
    memory: null,
    cores: [],
    uptime: 100,
    load: null,
    temperature: null,
    disk: null,
    disks: [],
    networks: [],
    rx: null,
    tx: null,
    warnings: [],
  };
}

test("retains the union of the top 20 CPU and memory processes, once each", () => {
  const all = Array.from({ length: 60 }, (_, i) => process(i + 1, i, 60 - i));
  const selected = selectProcesses(all);
  expect(selected).toHaveLength(40);
  expect(new Set(selected.map((p) => p.pid)).size).toBe(40);
  expect(selected.map((p) => p.pid).sort((a, b) => a - b)).toEqual([
    ...Array.from({ length: 20 }, (_, i) => i + 1),
    ...Array.from({ length: 20 }, (_, i) => i + 41),
  ]);
  const overlapping = all.map((p) => ({ ...p, memory: p.cpu }));
  expect(selectProcesses(overlapping)).toHaveLength(20);
  expect(selectProcesses(all.map((p) => ({ ...p, cpu: null })))).toHaveLength(
    20,
  );
  expect(all[0].pid).toBe(1);
});

test("process identity handles parentheses in names and separates PID reuse and reboot", () => {
  const stat = (ticks: number) =>
    `42 (name with ) parentheses) ${Array.from({ length: 20 }, (_, i) => (i === 19 ? ticks : 0)).join(" ")}`;
  expect(linuxProcessIdentity(stat(123), "boot-a", 42)).toBe("boot-a:42:123");
  expect(linuxProcessIdentity(stat(456), "boot-a", 42)).not.toBe(
    linuxProcessIdentity(stat(123), "boot-a", 42),
  );
  expect(linuxProcessIdentity(stat(123), "boot-b", 42)).not.toBe(
    linuxProcessIdentity(stat(123), "boot-a", 42),
  );
  expect(() => linuxProcessIdentity("broken", "boot-a", 42)).toThrow();
  expect(() => linuxProcessIdentity(stat(123), "boot-a", 43)).toThrow();
});

test("ranks by historical peak rather than latest or average and reranks after zoom", () => {
  const db = store();
  for (let i = 0; i < 3; i++)
    db.insert(
      sample(1000 + i * 5000, [
        process(1, i === 0 ? 90 : 1, 1),
        process(2, 40, i === 2 ? 80 : 1),
        ...[3, 4, 5, 6, 7].map((pid) => process(pid, 30 - pid, 10 + pid)),
      ]),
    );
  const window = { from: 0, to: 11000 };
  const { cpu, memory } = db.processHistories(window, 5000);
  expect(cpu.series).toHaveLength(5);
  expect(cpu.series[0]).toMatchObject({ pid: 1, peak: 90 });
  expect(memory.series[0]).toMatchObject({ pid: 2, peak: 80 });
  const zoomed = db.processHistories({ from: 6000, to: 11000 }, 5000).cpu;
  expect(zoomed.series[0].pid).toBe(2);
  expect(zoomed.series.some((p) => p.pid === 1)).toBe(false);
  expect(db.summary().count).toBe(3);
});

test("leaves gaps for unretained processes and legacy or failed readings, including PID reuse", () => {
  const db = store();
  db.insert(sample(1000, null));
  db.insert(sample(6000, [process(42, 30)]));
  db.insert(sample(11000, [process(7, 50)]));
  db.insert(sample(16000, [process(42, 40, 1, "boot:42:200")]));
  db.insert(sample(21000, null));
  const history = db.processHistories({ from: 0, to: 21000 }, 5000).cpu;
  const old = history.series.findIndex((p) => p.id === "boot:42:100");
  const reused = history.series.findIndex((p) => p.id === "boot:42:200");
  expect(old).toBeGreaterThanOrEqual(0);
  expect(reused).toBeGreaterThanOrEqual(0);
  expect(history.points.map((p) => p.values[old])).toEqual([
    null,
    30,
    null,
    null,
    null,
  ]);
  expect(history.points.map((p) => p.values[reused])).toEqual([
    null,
    null,
    null,
    40,
    null,
  ]);
  expect(db.latest()?.processes).toBeNull();
  expect(db.processHistories({ from: 0, to: 1000 }, 5000).cpu.series).toEqual(
    [],
  );
});

test("preserves bucket peaks, reports partial coverage, and bounds large responses", () => {
  const db = store();
  for (let i = 0; i < 2500; i++)
    db.insert(sample(i * 1000, i % 2 ? [] : [process(1, i === 2 ? 95 : 10)]));
  const history = db.processHistories({ from: 0, to: 2500000 }, 1000).cpu;
  expect(history.points.length).toBeLessThanOrEqual(361);
  expect(history.series[0].peak).toBe(95);
  expect(history.points[0].values[0]).toBe(95);
  expect(history.points[0].coverage[0]).toBeLessThan(history.points[0].samples);
  const zoomed = db.processHistories({ from: 0, to: 6000 }, 1000).cpu;
  expect(zoomed.points.map((p) => p.values[0])).toEqual([
    10,
    null,
    95,
    null,
    10,
    null,
    10,
  ]);
  expect(db.summary().count).toBe(2500);
});

test("does not connect lines across collection outages and rolls back partial inserts", () => {
  const db = store();
  db.insert(sample(1000, [process(1, 10)]));
  db.insert(sample(21000, [process(1, 20)]));
  const history = db.processHistories({ from: 0, to: 22000 }, 5000).cpu;
  expect(history.points.map((p) => p.values[0])).toEqual([10, null, 20]);
  expect(() =>
    db.insert(sample(26000, [process(1, 5), process(1, 5)])),
  ).toThrow();
  expect(db.summary().count).toBe(2);
  expect(db.latest()?.processes).toEqual([process(1, 20)]);
});

test("keeps distinct CPU and memory winners with independent null and zero coverage", () => {
  const db = store();
  db.insert(sample(0, [process(99, 100, 100)]));
  db.insert(
    sample(1000, [
      ...Array.from({ length: 6 }, (_, i) => process(i + 1, 90 - i, 0)),
      ...Array.from({ length: 6 }, (_, i) => process(i + 7, 0, 80 - i)),
    ]),
  );
  db.insert(
    sample(6000, [
      process(1, null, 0),
      process(2, 0, null),
      process(7, 0, null),
      process(8, null, 0),
    ]),
  );
  db.insert(sample(11000, []));
  db.insert(sample(16000, [process(100, 100, 100)]));
  const { cpu, memory } = db.processHistories({ from: 1000, to: 11000 }, 5000);
  expect(cpu.series.map((p) => p.pid)).toEqual([1, 2, 3, 4, 5]);
  expect(memory.series.map((p) => p.pid)).toEqual([7, 8, 9, 10, 11]);
  expect(cpu.points.map((p) => p.values.slice(0, 2))).toEqual([
    [90, 89],
    [null, 0],
    [null, null],
  ]);
  expect(memory.points.map((p) => p.values.slice(0, 2))).toEqual([
    [80, 79],
    [null, 0],
    [null, null],
  ]);
  for (const history of [cpu, memory]) {
    expect(history.points.map((p) => p.coverage.slice(0, 2))).toEqual([
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
    expect(history.points.map((p) => p.samples)).toEqual([1, 1, 1]);
  }
});

test("returns empty histories for missing metrics without suppressing the other chart", () => {
  const db = store();
  const empty = { series: [], points: [] };
  expect(db.processHistories({ from: 0, to: 20000 }, 5000)).toEqual({
    cpu: empty,
    memory: empty,
  });
  db.insert(sample(1000, [process(1, null, 50)]));
  db.insert(sample(6000, [process(1, 0, 0)]));
  db.insert(sample(11000, [process(2, 25, null)]));
  db.insert(sample(16000, [process(2, 0, 0)]));
  const memoryOnly = db.processHistories({ from: 1000, to: 6000 }, 5000);
  expect(memoryOnly.cpu).toEqual(empty);
  expect(memoryOnly.memory.points.map((p) => p.values)).toEqual([[50], [0]]);
  const cpuOnly = db.processHistories({ from: 11000, to: 16000 }, 5000);
  expect(cpuOnly.memory).toEqual(empty);
  expect(cpuOnly.cpu.points.map((p) => p.values)).toEqual([[25], [0]]);
  expect(db.processHistories({ from: 6000, to: 6000 }, 5000)).toEqual({
    cpu: empty,
    memory: empty,
  });
});

test("breaks equal peaks by PID then process identity for both top-five lists", () => {
  const db = store();
  db.insert(
    sample(1000, [
      process(5, 20, 30),
      process(1, 20, 30, "boot:1:200"),
      process(4, 20, 30),
      process(3, 20, 30),
      process(1, 20, 30, "boot:1:100"),
      process(2, 20, 30),
    ]),
  );
  const histories = db.processHistories({ from: 1000, to: 1000 }, 5000);
  for (const history of [histories.cpu, histories.memory])
    expect(history.series.map((p) => p.id)).toEqual([
      "boot:1:100",
      "boot:1:200",
      "boot:2:100",
      "boot:3:100",
      "boot:4:100",
    ]);
});
