import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  ranges,
  type HistoryPoint,
  type TimeRange,
  type Sample,
  type ProcessMetric,
  type ProcessHistory,
  type AbsoluteRange,
} from "../lib/metrics";

export class MetricsStore {
  private db: Database;
  constructor(private path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        cpu REAL, memory REAL, disk REAL, rx REAL, tx REAL,
        snapshot TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS samples_timestamp ON samples(timestamp);
      CREATE TABLE IF NOT EXISTS processes (
        id TEXT PRIMARY KEY, pid INTEGER NOT NULL, name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS process_samples (
        sample_id INTEGER NOT NULL REFERENCES samples(id),
        process_id TEXT NOT NULL REFERENCES processes(id),
        cpu REAL, memory REAL,
        PRIMARY KEY (sample_id, process_id)
      ) WITHOUT ROWID;
    `);
    // Upgrade existing databases in place; old readings remain unknown, never zero.
    const columns = new Set(
      this.db
        .query<{ name: string }, []>("PRAGMA table_info(samples)")
        .all()
        .map((c) => c.name),
    );
    this.db.transaction(() => {
      for (const name of ["load1", "load5", "load15", "temperature"])
        if (!columns.has(name))
          this.db.exec(`ALTER TABLE samples ADD COLUMN ${name} REAL`);
      this.db.exec("PRAGMA user_version = 3");
    })();
  }

  insert(sample: Sample) {
    this.db.transaction(() => {
      const saved = this.db
        .query(
          `INSERT INTO samples (timestamp, cpu, memory, disk, rx, tx, snapshot, load1, load5, load15, temperature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sample.timestamp,
          sample.cpu,
          sample.memory?.percent ?? null,
          sample.disk,
          sample.rx,
          sample.tx,
          // Keep process readings in their own table, without duplicating them in JSON.
          JSON.stringify({
            ...sample,
            processes: sample.processes === null ? null : [],
          }),
          sample.load?.one ?? null,
          sample.load?.five ?? null,
          sample.load?.fifteen ?? null,
          sample.temperature ?? null,
        );
      const identity = this.db.query(
        "INSERT OR IGNORE INTO processes (id, pid, name) VALUES (?, ?, ?)",
      );
      const reading = this.db.query(
        "INSERT INTO process_samples (sample_id, process_id, cpu, memory) VALUES (?, ?, ?, ?)",
      );
      for (const process of sample.processes ?? []) {
        identity.run(process.id, process.pid, process.name);
        reading.run(
          saved.lastInsertRowid,
          process.id,
          process.cpu,
          process.memory,
        );
      }
    })();
  }

  latest(): Sample | null {
    const row = this.db
      .query<{ id: number; snapshot: string }, []>(
        "SELECT id, snapshot FROM samples ORDER BY timestamp DESC, id DESC LIMIT 1",
      )
      .get();
    if (!row) return null;
    const sample = {
      load: null,
      temperature: null,
      processes: null,
      ...JSON.parse(row.snapshot),
    } as Sample;
    if (sample.processes !== null)
      sample.processes = this.db
        .query<ProcessMetric, [number]>(
          `
        SELECT p.id, p.pid, p.name, r.cpu, r.memory FROM process_samples r
        JOIN processes p ON p.id = r.process_id WHERE r.sample_id = ?
        ORDER BY p.pid, p.id`,
        )
        .all(row.id);
    return sample;
  }

  processHistories(
    window: AbsoluteRange,
    intervalMs: number,
  ): { cpu: ProcessHistory; memory: ProcessHistory } {
    const bucketMs = Math.max(
      1,
      Math.ceil((window.to - window.from + 1) / 360),
    );
    // Aggregate both metrics before looking up process names and PIDs, so each
    // retained reading is scanned once and identity lookups happen per process.
    const ranked = this.db
      .query<
        ProcessHistory["series"][number] & { metric: "cpu" | "memory" },
        [number, number]
      >(
        `
      WITH peaks AS MATERIALIZED (
        SELECT r.process_id AS id, MAX(r.cpu) AS cpu, MAX(r.memory) AS memory
        FROM samples s JOIN process_samples r ON r.sample_id = s.id
        WHERE s.timestamp >= ? AND s.timestamp <= ?
        GROUP BY r.process_id
      )
      SELECT 'cpu' AS metric, id, pid, name, peak FROM (
        SELECT p.id, p.pid, p.name, t.cpu AS peak FROM peaks t
        JOIN processes p ON p.id = t.id WHERE t.cpu > 0
        ORDER BY peak DESC, p.pid, p.id LIMIT 5
      ) UNION ALL
      SELECT 'memory' AS metric, id, pid, name, peak FROM (
        SELECT p.id, p.pid, p.name, t.memory AS peak FROM peaks t
        JOIN processes p ON p.id = t.id WHERE t.memory > 0
        ORDER BY peak DESC, p.pid, p.id LIMIT 5
      )
    `,
      )
      .all(window.from, window.to);
    const series: Record<"cpu" | "memory", ProcessHistory["series"]> = {
      cpu: [],
      memory: [],
    };
    for (const { metric, ...process } of ranked) series[metric].push(process);
    if (!ranked.length)
      return {
        cpu: { series: [], points: [] },
        memory: { series: [], points: [] },
      };
    // Both charts use the same sample counts and outage boundaries.
    const buckets = this.db
      .query<
        {
          bucket: number;
          timestamp: number;
          first: number;
          last: number;
          samples: number;
        },
        [number, number, number]
      >(
        `
      SELECT CAST(timestamp / ? AS INTEGER) AS bucket,
        CAST(AVG(timestamp) AS INTEGER) AS timestamp, MIN(timestamp) AS first,
        MAX(timestamp) AS last, COUNT(*) AS samples
      FROM samples WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY bucket ORDER BY bucket
    `,
      )
      .all(bucketMs, window.from, window.to);
    const ids = [...new Set(ranked.map((process) => process.id))];
    const rows = this.db
      .query<
        {
          bucket: number;
          id: string;
          cpu: number | null;
          memory: number | null;
          cpuCoverage: number;
          memoryCoverage: number;
        },
        (number | string)[]
      >(
        `
      SELECT CAST(s.timestamp / ? AS INTEGER) AS bucket, r.process_id AS id,
        MAX(r.cpu) AS cpu, COUNT(r.cpu) AS cpuCoverage,
        MAX(r.memory) AS memory, COUNT(r.memory) AS memoryCoverage
      FROM samples s JOIN process_samples r ON r.sample_id = s.id
      WHERE s.timestamp >= ? AND s.timestamp <= ?
        AND r.process_id IN (${ids.map(() => "?").join(",")})
      GROUP BY bucket, r.process_id
    `,
      )
      .all(bucketMs, window.from, window.to, ...ids);
    const values = new Map(rows.map((r) => [`${r.bucket}:${r.id}`, r]));
    const build = (metric: "cpu" | "memory"): ProcessHistory => {
      const lines = series[metric];
      if (!lines.length) return { series: lines, points: [] };
      const points: ProcessHistory["points"] = [];
      let last: number | null = null;
      for (const bucket of buckets) {
        // Don't draw a continuous line across a service/collection outage.
        if (last !== null && bucket.first - last > intervalMs * 2)
          points.push({
            timestamp: Math.round((last + bucket.first) / 2),
            values: lines.map(() => null),
            coverage: lines.map(() => 0),
            samples: 0,
          });
        points.push({
          timestamp: bucket.timestamp,
          values: lines.map(
            (p) => values.get(`${bucket.bucket}:${p.id}`)?.[metric] ?? null,
          ),
          coverage: lines.map(
            (p) =>
              values.get(`${bucket.bucket}:${p.id}`)?.[`${metric}Coverage`] ?? 0,
          ),
          samples: bucket.samples,
        });
        last = bucket.last;
      }
      return { series: lines, points };
    };
    return { cpu: build("cpu"), memory: build("memory") };
  }

  summary() {
    const row = this.db
      .query<{ count: number; first: number | null; last: number | null }, []>(
        "SELECT COUNT(*) AS count, MIN(timestamp) AS first, MAX(timestamp) AS last FROM samples",
      )
      .get()!;
    const bytes =
      this.path === ":memory:"
        ? 0
        : [this.path, `${this.path}-wal`, `${this.path}-shm`].reduce(
            (total, file) => {
              try {
                return total + statSync(file).size;
              } catch {
                return total;
              }
            },
            0,
          );
    return { ...row, bytes };
  }

  history(range: TimeRange, now = Date.now()): HistoryPoint[] {
    const first =
      typeof range !== "string"
        ? range.from
        : range === "all"
          ? (this.db
              .query<{ first: number | null }, []>(
                "SELECT MIN(timestamp) AS first FROM samples",
              )
              .get()?.first ?? now)
          : now - ranges[range].ms;
    const end = typeof range === "string" ? now : range.to;
    // Bound the chart response without deleting or downsampling stored samples.
    const bucketMs = Math.max(1, Math.ceil((end - first + 1) / 360));
    return this.db
      .query<HistoryPoint, [number, number, number]>(
        `
      SELECT CAST(AVG(timestamp) AS INTEGER) AS timestamp,
        AVG(cpu) AS cpu, AVG(memory) AS memory, AVG(disk) AS disk,
        AVG(rx) AS rx, AVG(tx) AS tx,
        AVG(load1) AS load1, AVG(load5) AS load5, AVG(load15) AS load15,
        AVG(temperature) AS temperature
      FROM samples WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY CAST(timestamp / ? AS INTEGER) ORDER BY timestamp
    `,
      )
      .all(first, end, bucketMs);
  }

  close() {
    this.db.close();
  }
}
