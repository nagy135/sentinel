import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardData } from "../src/lib/metrics";

const production = process.env.SENTINEL_TEST_PRODUCTION === "1";
test(`${production ? "production" : "dev"} command collects without a browser and retains history after a restart`, async () => {
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
    Bun.spawn(["bun", production ? "scripts/start.ts" : "scripts/dev.ts"], {
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
    expect(firstRun.latest?.load?.one).toBeGreaterThanOrEqual(0);
    expect(firstRun.latest?.load?.five).toBeGreaterThanOrEqual(0);
    expect(firstRun.latest?.load?.fifteen).toBeGreaterThanOrEqual(0);
    expect(
      firstRun.latest?.temperature === null ||
        Number.isFinite(firstRun.latest?.temperature),
    ).toBe(true);
    expect(firstRun.history.some((point) => point.load1 !== null)).toBe(true);
    expect(firstRun.latest?.memory?.total).toBeGreaterThan(0);
    expect(
      firstRun.storage.last! - firstRun.storage.first!,
    ).toBeGreaterThanOrEqual(1500);
    const invalid = await fetch(
      `http://127.0.0.1:${port}/api/metrics?range=toString`,
    );
    expect(invalid.status).toBe(400);
    const from = firstRun.storage.first!;
    const to = firstRun.storage.last!;
    const selected = await fetch(
      `http://127.0.0.1:${port}/api/metrics?range=custom&from=${from}&to=${to}`,
    );
    expect(selected.status).toBe(200);
    const fixed: DashboardData = await selected.json();
    expect(fixed.range).toEqual({ from, to });
    expect(fixed.window).toEqual({ from, to });
    expect(
      fixed.history.every(
        (point) => point.timestamp >= from && point.timestamp <= to,
      ),
    ).toBe(true);
    for (const query of [
      `range=custom&from=${to}&to=${from}`,
      "range=custom&from=NaN&to=2",
      "range=custom&from=0",
      "range=1h&from=0&to=2",
    ]) {
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/metrics?${query}`)).status,
      ).toBe(400);
    }
    if (production) {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      const asset = html.match(/\/assets\/[^"\s<>]+\.css/)?.[0];
      expect(asset).toBeTruthy();
      const stylesheet = await fetch(`http://127.0.0.1:${port}${asset}`);
      expect(stylesheet.status).toBe(200);
      expect(stylesheet.headers.get("content-type")).toContain("text/css");
      expect(stylesheet.headers.get("cache-control")).toContain("immutable");
      const head = await fetch(`http://127.0.0.1:${port}${asset}`, {
        method: "HEAD",
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const privateFile = await fetch(`http://127.0.0.1:${port}/package.json`);
      expect(privateFile.status).toBe(404);
    }
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
