import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardData } from "../src/lib/metrics";

test("dev command collects without a browser and retains history after a restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-service-"));
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = reservation.port!;
  reservation.stop(true);
  const env = {
    ...process.env,
    PORT: String(port),
    SENTINEL_INTERVAL_MS: "1000",
    SENTINEL_DB_PATH: join(directory, "history.sqlite"),
  };
  const start = () =>
    Bun.spawn(["bun", "scripts/dev.ts"], {
      cwd: join(import.meta.dir, ".."),
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
  let service = start();
  async function stop() {
    service.kill("SIGTERM");
    const timeout = setTimeout(() => service.kill("SIGKILL"), 5000);
    await service.exited;
    clearTimeout(timeout);
  }
  async function waitFor(
    predicate: (data: DashboardData) => boolean,
  ): Promise<DashboardData> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (service.exitCode !== null)
        throw new Error(await new Response(service.stderr).text());
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/metrics?range=all`,
        );
        if (response.ok) {
          const data: DashboardData = await response.json();
          if (predicate(data)) return data;
        }
      } catch {
        /* The dev server may still be starting. */
      }
      await Bun.sleep(100);
    }
    throw new Error(
      "Dev service did not produce the expected metrics within 20 seconds.",
    );
  }
  try {
    const firstRun = await waitFor((data) => data.storage.count >= 3);
    expect(firstRun.collector.intervalMs).toBe(1000);
    expect(firstRun.collector.running).toBe(true);
    expect(firstRun.collector.error).toBeNull();
    expect(firstRun.host?.hostname).toBeTruthy();
    expect(firstRun.latest?.cpu).toBeNumber();
    expect(firstRun.latest?.memory?.total).toBeGreaterThan(0);
    expect(
      firstRun.storage.last! - firstRun.storage.first!,
    ).toBeGreaterThanOrEqual(1500);
    const invalid = await fetch(
      `http://127.0.0.1:${port}/api/metrics?range=toString`,
    );
    expect(invalid.status).toBe(400);
    await stop();
    service = start();
    const restarted = await waitFor(
      (data) => data.storage.count > firstRun.storage.count,
    );
    expect(restarted.storage.first).toBe(firstRun.storage.first);
    expect(restarted.collector.error).toBeNull();
    expect(restarted.history.length).toBeGreaterThan(0);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
