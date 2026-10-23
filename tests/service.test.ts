import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardData } from "../src/lib/metrics";

const production = process.env.SENTINEL_TEST_PRODUCTION === "1";
// Allow deployment checks on slow hosts without relaxing any behavior assertions.
const startupTimeoutMs = Number(
  process.env.SENTINEL_TEST_STARTUP_TIMEOUT_MS ?? 20_000,
);
if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 20_000)
  throw new Error(
    "SENTINEL_TEST_STARTUP_TIMEOUT_MS must be an integer of at least 20000",
  );
const serviceTimeoutMs = Math.max(45_000, startupTimeoutMs * 3);
test("refuses to start without private credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-unconfigured-"));
  try {
    const service = Bun.spawn(
      ["bun", production ? "scripts/start.ts" : "scripts/dev.ts"],
      {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          SENTINEL_USERNAME: "",
          SENTINEL_PASSWORD: "",
          SENTINEL_DB_PATH: join(directory, "metrics.sqlite"),
        },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const errors = await new Response(service.stderr).text();
    expect(await service.exited).toBe(1);
    expect(errors).toContain("Set SENTINEL_USERNAME and SENTINEL_PASSWORD");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

test(`${production ? "production" : "dev"} command collects without a browser and retains history after a restart`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-service-"));
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = reservation.port!;
  reservation.stop(true);
  const username = "sentinel-test";
  const password = crypto.randomUUID();
  let cookie = "";
  async function authenticatedFetch(input: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    return fetch(input, { ...init, headers });
  }
  const env = {
    ...process.env,
    PORT: String(port),
    SENTINEL_USERNAME: username,
    SENTINEL_PASSWORD: password,
    SENTINEL_PUBLIC_URL: "",
    SENTINEL_INTERVAL_MS: "1000",
    SENTINEL_DEBUG_PERF: "1",
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
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (service.exitCode !== null)
        throw new Error(await new Response(service.stderr).text());
      try {
        const response = await authenticatedFetch(
          `http://127.0.0.1:${port}/api/metrics?range=all`,
        );
        if (response.status === 401 && !cookie) {
          const loggedIn = await fetch(
            `http://127.0.0.1:${port}/api/auth/login`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: `http://127.0.0.1:${port}`,
              },
              body: JSON.stringify({ username, password }),
            },
          );
          expect(loggedIn.status).toBe(204);
          cookie = loggedIn.headers.get("set-cookie")!.split(";")[0];
        }
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
      `Service did not produce the expected metrics within ${startupTimeoutMs / 1000} seconds.`,
    );
  }
  try {
    const firstRun = await waitFor((data) => data.storage.count >= 3);
    expect(firstRun.diagnostics.supported).toBe(process.platform === "linux");
    expect(
      (await fetch(`http://127.0.0.1:${port}/api/load-evidence?at=1`)).status,
    ).toBe(401);
    expect(
      (await authenticatedFetch(`http://127.0.0.1:${port}/api/load-evidence?at=bad`)).status,
    ).toBe(400);
    const explained = await authenticatedFetch(
      `http://127.0.0.1:${port}/api/load-evidence?at=${firstRun.latest!.timestamp}`,
    );
    expect(explained.status).toBe(200);
    expect(await explained.json()).toMatchObject({
      at: firstRun.latest!.timestamp,
      from: firstRun.latest!.timestamp - 60_000,
    });
    const privateIncident = await fetch(
      `http://127.0.0.1:${port}/api/incidents?id=1`,
    );
    expect(privateIncident.status).toBe(401);
    expect(
      (
        await authenticatedFetch(
          `http://127.0.0.1:${port}/api/incidents?id=bad`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await authenticatedFetch(
          `http://127.0.0.1:${port}/api/incidents?id=9007199254740991`,
        )
      ).status,
    ).toBe(404);
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain(firstRun.host!.hostname);
    const pageRedirect = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: "manual",
    });
    expect(pageRedirect.status).toBe(302);
    expect(pageRedirect.headers.get("location")).toBe("/login");
    const loginPage = await fetch(`http://127.0.0.1:${port}/login`);
    expect(await loginPage.text()).toContain("Sign in");
    const badLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ username, password: "incorrect" }),
    });
    expect(badLogin.status).toBe(401);
    const crossSite = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://other.example",
      },
      body: JSON.stringify({ username, password }),
    });
    expect(crossSite.status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
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
    expect(firstRun.latest?.processes?.length).toBeGreaterThan(0);
    expect(firstRun.latest?.processes?.length).toBeLessThanOrEqual(40);
    for (const process of firstRun.latest!.processes!) {
      expect(Object.keys(process).sort()).toEqual([
        "cpu",
        "id",
        "memory",
        "name",
        "pid",
      ]);
      expect(process.id).toBeTruthy();
      expect(process.name).not.toMatch(/\s/);
      expect(
        process.memory === null ||
          (process.memory >= 0 && process.memory <= 100),
      ).toBe(true);
    }
    expect(firstRun.processes.memory.series.length).toBeGreaterThan(0);
    expect(firstRun.processes.memory.series.length).toBeLessThanOrEqual(5);
    expect(firstRun.processes.cpu.series.length).toBeLessThanOrEqual(5);
    expect(
      firstRun.storage.last! - firstRun.storage.first!,
    ).toBeGreaterThanOrEqual(1500);
    const invalid = await authenticatedFetch(
      `http://127.0.0.1:${port}/api/metrics?range=toString`,
    );
    expect(invalid.status).toBe(400);
    const from = firstRun.storage.first!;
    const to = firstRun.storage.last!;
    const selected = await authenticatedFetch(
      `http://127.0.0.1:${port}/api/metrics?range=custom&from=${from}&to=${to}`,
    );
    expect(selected.status).toBe(200);
    const requestId = selected.headers.get("x-sentinel-perf");
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(selected.headers.get("server-timing")).toContain(
      "processRanking;dur=",
    );
    const report = {
      requestId,
      headersMs: 20,
      bodyMs: 2,
      parseMs: 1,
      commitMs: 30,
      twoFramesMs: 32,
      totalMs: 85,
    };
    const reportUrl = `http://127.0.0.1:${port}/api/metrics`;
    const reportInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify(report),
    };
    expect((await authenticatedFetch(reportUrl, reportInit)).status).toBe(204);
    expect((await fetch(reportUrl, reportInit)).status).toBe(401);
    expect(
      (
        await authenticatedFetch(reportUrl, {
          ...reportInit,
          headers: { ...reportInit.headers, Origin: "https://other.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authenticatedFetch(reportUrl, {
          ...reportInit,
          body: JSON.stringify({ ...report, totalMs: -1 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await authenticatedFetch(reportUrl, {
          ...reportInit,
          body: "x".repeat(2049),
        })
      ).status,
    ).toBe(413);
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
        (
          await authenticatedFetch(
            `http://127.0.0.1:${port}/api/metrics?${query}`,
          )
        ).status,
      ).toBe(400);
    }
    if (production) {
      const page = await authenticatedFetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      const asset = html.match(/\/assets\/[^"\s<>]+\.css/)?.[0];
      expect(asset).toBeTruthy();
      const stylesheet = await authenticatedFetch(
        `http://127.0.0.1:${port}${asset}`,
      );
      expect(stylesheet.status).toBe(200);
      expect(stylesheet.headers.get("content-type")).toContain("text/css");
      expect(stylesheet.headers.get("cache-control")).toContain("immutable");
      const head = await authenticatedFetch(
        `http://127.0.0.1:${port}${asset}`,
        {
          method: "HEAD",
        },
      );
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const privateFile = await authenticatedFetch(
        `http://127.0.0.1:${port}/package.json`,
      );
      expect(privateFile.status).toBe(404);
    }
    await stop();
    env.SENTINEL_DEBUG_PERF = "0";
    service = start();
    const restarted = await waitFor(
      (data) => data.storage.count > firstRun.storage.count,
    );
    expect(restarted.storage.first).toBe(firstRun.storage.first);
    expect(restarted.collector.error).toBeNull();
    expect(restarted.history.length).toBeGreaterThan(0);
    expect(restarted.processes.memory.series.length).toBeGreaterThan(0);
    expect(restarted.processes.memory.points[0].timestamp).toBeLessThanOrEqual(
      firstRun.storage.last!,
    );
    // The original cookie must still work: waitFor never signs in again when it exists.
    const remembered = await authenticatedFetch(
      `http://127.0.0.1:${port}/api/metrics`,
    );
    expect(remembered.status).toBe(200);
    expect(remembered.headers.get("x-sentinel-perf")).toBeNull();
    expect((await authenticatedFetch(reportUrl, reportInit)).status).toBe(404);
    const renewed = remembered.headers.get("set-cookie");
    expect(renewed).toContain("HttpOnly");
    expect(renewed).toContain("SameSite=Lax");
    expect(renewed).toContain("Max-Age=34560000");
    const signedOut = await authenticatedFetch(
      `http://127.0.0.1:${port}/api/auth/logout`,
      {
        method: "POST",
        headers: { Origin: `http://127.0.0.1:${port}` },
      },
    );
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await authenticatedFetch(`http://127.0.0.1:${port}/api/metrics`)).status,
    ).toBe(401);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
}, serviceTimeoutMs);
