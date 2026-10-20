import { resolve } from "node:path";
import { hostname } from "node:os";
import { statfs } from "node:fs/promises";
import type { DashboardData } from "../src/lib/metrics";
import { readHostIdentity } from "../src/server/host.server";

const image = process.env.SENTINEL_TEST_IMAGE ?? "sentinel:test";
const project = `sentinel-test-${process.pid}`;
const hostMode = process.env.SENTINEL_TEST_HOST === "1";
if (hostMode && process.platform !== "linux")
  throw new Error(
    "The host-mode smoke test must run on a Linux Docker Engine host.",
  );
const reservation = hostMode
  ? Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  : null;
const hostPort = reservation?.port;
reservation?.stop(true);
const username = "sentinel-docker-test";
const password = crypto.randomUUID();
let cookie = "";
const env = {
  ...process.env,
  SENTINEL_IMAGE: image,
  SENTINEL_USERNAME: username,
  SENTINEL_PASSWORD: password,
  SENTINEL_PUBLIC_URL: "",
  SENTINEL_PORT: String(hostPort ?? 0),
  SENTINEL_INTERVAL_MS: "1000",
};
const compose = [
  "docker",
  "compose",
  "--project-name",
  project,
  "--file",
  resolve(
    import.meta.dir,
    hostMode ? "../compose.yml" : "../compose.container.yml",
  ),
];
async function run(args: string[], capture = false): Promise<string> {
  const child = Bun.spawn(args, {
    env,
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const output = capture ? await new Response(child.stdout).text() : "";
  if ((await child.exited) !== 0)
    throw new Error(`Command failed: ${args.join(" ")}`);
  return output.trim();
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function waitFor(
  url: string,
  predicate: (data: DashboardData) => boolean,
) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/metrics?range=all`, {
        signal: AbortSignal.timeout(3000),
        headers: cookie ? { Cookie: cookie } : {},
      });
      if (response.status === 401 && !cookie) {
        const loggedIn = await fetch(`${url}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: url },
          body: JSON.stringify({ username, password }),
        });
        assert(loggedIn.status === 204, "Container login failed");
        cookie = loggedIn.headers.get("set-cookie")!.split(";")[0];
      }
      if (response.ok) {
        const data: DashboardData = await response.json();
        if (predicate(data)) return data;
      }
    } catch {
      /* Container startup and recreation may temporarily close the port. */
    }
    await Bun.sleep(250);
  }
  throw new Error(
    "Container did not produce the expected metrics within 60 seconds.",
  );
}
try {
  if (process.env.SENTINEL_SKIP_DOCKER_BUILD !== "1")
    await run(["docker", "build", "--tag", image, "."]);
  await run([...compose, "config", "--quiet"]);
  await run([...compose, "up", "--detach", "--pull", "never"]);
  const address = hostMode
    ? `127.0.0.1:${hostPort}`
    : await run([...compose, "port", "sentinel", "3000"], true);
  assert(
    address.startsWith("127.0.0.1:"),
    "Dashboard must be published only on localhost",
  );
  const url = `http://${address}`;
  const first = await waitFor(url, (data) => data.storage.count >= 3);
  assert(
    first.host?.platform === "linux",
    "Docker metrics must describe Linux",
  );
  assert(first.latest?.load?.one != null, "Load averages were not collected");
  assert(!first.collector.error, "Collector reported an error");
  assert(
    first.latest?.processes?.length && first.latest.processes.length <= 40,
    "Bounded process samples were not collected",
  );
  assert(
    first.processes.memory.series.length > 0 &&
      first.processes.memory.series.length <= 5,
    "Process memory history is unavailable",
  );
  assert(
    first.latest.processes.every(
      (p) => p.id && p.name && !Object.hasOwn(p, "params"),
    ),
    "Invalid process identity or command arguments exposed",
  );
  if (hostMode) {
    const identity = await readHostIdentity("/");
    assert(
      first.host?.hostname === hostname(),
      "Container hostname does not match the Linux host",
    );
    assert(
      first.host?.os === identity.os && first.host.release === identity.release,
      "Container reported its own OS instead of the Linux host OS",
    );
    assert(
      first.latest?.disks.some((disk) => disk.mount === "/"),
      "Host root filesystem was not collected",
    );
    const root = await statfs("/");
    assert(
      first.latest?.disks.find((disk) => disk.mount === "/")?.total ===
        root.blocks * root.bsize,
      "Root filesystem capacity does not match the Linux host",
    );
    assert(
      !first.latest?.disks.some((disk) => disk.mount.startsWith("/host")),
      "Container mount prefix leaked into host volume paths",
    );
  }
  assert(
    (await fetch(`${url}/api/metrics`)).status === 401,
    "Anonymous metrics must be denied",
  );
  const page = await fetch(url, { headers: { Cookie: cookie } });
  assert(page.ok, "Dashboard did not respond");
  const html = await page.text();
  const css = html.match(/\/assets\/[^"\s<>]+\.css/)?.[0];
  assert(
    css && (await fetch(`${url}${css}`)).ok,
    "Built assets were not served",
  );
  await run([
    ...compose,
    "exec",
    "--no-TTY",
    "sentinel",
    "bun",
    "run",
    "scripts/healthcheck.ts",
  ]);
  await run([
    ...compose,
    "exec",
    "--no-TTY",
    "sentinel",
    "sh",
    "-c",
    'test "$(id -u)" != 0 && test -w /data && test ! -e /app/.env && test ! -d /app/node_modules/typescript',
  ]);
  await run([
    ...compose,
    "up",
    "--detach",
    "--force-recreate",
    "--pull",
    "never",
  ]);
  const newAddress = hostMode
    ? address
    : await run([...compose, "port", "sentinel", "3000"], true);
  const restarted = await waitFor(
    `http://${newAddress}`,
    (data) => data.storage.count > first.storage.count,
  );
  assert(
    restarted.storage.first === first.storage.first,
    "SQLite history was lost during container recreation",
  );
  assert(!restarted.collector.error, "Collector failed after recreation");
  console.log(
    `Docker Compose ${hostMode ? "host" : "container"} smoke test passed: login persistence, non-root runtime, localhost access, assets, health check, and ${restarted.storage.count} persisted samples.`,
  );
} finally {
  await run([...compose, "logs", "--tail", "30"]).catch(() => {});
  // This unique project owns only disposable test containers and its own SQLite volume.
  await run([...compose, "down", "--volumes", "--remove-orphans"]);
}
