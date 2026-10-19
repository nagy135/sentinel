import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import {
  ranges,
  type HistoryPoint,
  type TimeRange,
  type Sample,
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
      PRAGMA user_version = 1;
    `);
  }

  insert(sample: Sample) {
    this.db
      .query(
        `INSERT INTO samples (timestamp, cpu, memory, disk, rx, tx, snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sample.timestamp,
        sample.cpu,
        sample.memory?.percent ?? null,
        sample.disk,
        sample.rx,
        sample.tx,
        JSON.stringify(sample),
      );
  }

  latest(): Sample | null {
    const row = this.db
      .query<{ snapshot: string }, []>(
        "SELECT snapshot FROM samples ORDER BY timestamp DESC, id DESC LIMIT 1",
      )
      .get();
    return row ? (JSON.parse(row.snapshot) as Sample) : null;
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
        AVG(rx) AS rx, AVG(tx) AS tx
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
