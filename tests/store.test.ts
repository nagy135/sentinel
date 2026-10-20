import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsStore } from "../src/server/store.server";
import { Database } from "bun:sqlite";
import type { Sample } from "../src/lib/metrics";

const sample = (timestamp: number, cpu: number | null = 25): Sample => ({
  timestamp,
  cpu,
  load: { one: 1, five: 0.8, fifteen: 0.6 },
  temperature: 45,
  uptime: 100,
  cores: [cpu],
  memory: { total: 1024, used: 512, percent: 50, swapUsed: 0, swapTotal: 0 },
  disk: 40,
  disks: [],
  networks: [],
  rx: null,
  tx: null,
  warnings: [],
  processes: null,
});
const stores: MetricsStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const memoryStore = () => {
  const store = new MetricsStore(":memory:");
  stores.push(store);
  return store;
};

describe("SQLite metric history", () => {
  test("upgrades a version 1 database without losing snapshots or inventing sensor history", () => {
    const directory = mkdtempSync(join(tmpdir(), "sentinel-upgrade-"));
    directories.push(directory);
    const path = join(directory, "history.sqlite");
    const old = new Database(path);
    old.exec(`CREATE TABLE samples (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL,
      cpu REAL, memory REAL, disk REAL, rx REAL, tx REAL, snapshot TEXT NOT NULL);
      PRAGMA user_version = 1;`);
    const { load, temperature, ...legacy } = sample(1000);
    old
      .query("INSERT INTO samples (timestamp, cpu, snapshot) VALUES (?, ?, ?)")
      .run(1000, 25, JSON.stringify(legacy));
    old.close();
    const store = new MetricsStore(path);
    expect(store.latest()).toMatchObject({
      timestamp: 1000,
      load: null,
      temperature: null,
    });
    store.insert(sample(6000));
    const history = store.history("all", 6000);
    expect(history[0]).toMatchObject({
      timestamp: 1000,
      load1: null,
      load5: null,
      load15: null,
      temperature: null,
    });
    expect(history[1]).toMatchObject({
      timestamp: 6000,
      load1: 1,
      load5: 0.8,
      load15: 0.6,
      temperature: 45,
    });
    store.close();
    // The migration is safe to repeat after a restart.
    const reopened = new MetricsStore(path);
    stores.push(reopened);
    expect(reopened.summary().count).toBe(2);
    expect(reopened.latest()?.load).toEqual(load);
    expect(reopened.latest()?.temperature).toBe(temperature);
  });

  test("averages load and temperature in a bucket and ignores unavailable sensors", () => {
    const store = memoryStore();
    store.insert({ ...sample(100), load: null, temperature: null });
    store.insert({
      ...sample(200),
      load: { one: 3, five: 2, fifteen: 1 },
      temperature: 50,
    });
    store.insert({
      ...sample(300),
      load: { one: 5, five: 4, fifteen: 3 },
      temperature: 60,
    });
    expect(store.history({ from: 0, to: 360000 })[0]).toMatchObject({
      load1: 4,
      load5: 3,
      load15: 2,
      temperature: 55,
    });
  });
  test("retains complete snapshots across closing and reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    directories.push(directory);
    const path = join(directory, "nested", "history.sqlite");
    const first = new MetricsStore(path);
    const saved = sample(1_000_000);
    first.insert(saved);
    first.close();
    const reopened = new MetricsStore(path);
    stores.push(reopened);
    reopened.insert(sample(1_005_000, 50));
    expect(reopened.summary().count).toBe(2);
    expect(reopened.history("all", 1_005_000)[0].cpu).toBe(25);
    expect(reopened.latest()).toEqual(sample(1_005_000, 50));
  });

  test("filters selected time ranges and never deletes older samples", () => {
    const store = memoryStore();
    const now = 10_000_000;
    store.insert(sample(now - 3_600_001));
    store.insert(sample(now - 10_000, 40));
    store.insert(sample(now, 60));
    expect(store.history("1h", now).length).toBe(2);
    expect(store.history("all", now).length).toBe(3);
    expect(store.summary()).toMatchObject({
      count: 3,
      first: now - 3_600_001,
      last: now,
    });
  });

  test("bounds large chart responses while retaining every raw sample", () => {
    const store = memoryStore();
    for (let index = 0; index < 2500; index++)
      store.insert(sample(index * 5000, index % 100));
    expect(store.history("all", 2500 * 5000).length).toBeLessThanOrEqual(361);
    expect(store.summary().count).toBe(2500);
  });

  test("preserves unavailable metrics as null rather than displaying zero", () => {
    const store = memoryStore();
    store.insert(sample(1000, null));
    expect(store.history("all", 1000)[0]).toMatchObject({
      cpu: null,
      rx: null,
      tx: null,
    });
    expect(store.latest()?.cpu).toBeNull();
  });

  test("queries exact fixed boundaries and recovers detail when zooming", () => {
    const store = memoryStore();
    const start = 1_000_000;
    for (let index = 0; index < 1000; index++)
      store.insert(sample(start + index * 5000, index % 100));
    const selected = { from: start + 501 * 5000, to: start + 510 * 5000 };
    const points = store.history(selected, start + 1000 * 5000);
    expect(points.length).toBe(10);
    expect(points[0].timestamp).toBe(selected.from);
    expect(points.at(-1)?.timestamp).toBe(selected.to);
    expect(points[0].cpu).toBe(1);
    expect(store.history(selected, start + 2000 * 5000)).toEqual(points);
    expect(store.history({ from: 0, to: start - 1 })).toEqual([]);
    expect(store.summary().count).toBe(1000);
  });
});
