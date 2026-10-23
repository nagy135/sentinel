import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  LinuxDiagnostics,
  parseTask,
  counterRate,
} from "../src/server/diagnostics.server";

const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sentinel-proc-"));
  directories.push(root);
  const put = (path: string, text: string) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  put("sys/kernel/random/boot_id", "boot-a\n");
  put("loadavg", "14.0 7.0 4.0 2/120 100\n");
  put(
    "stat",
    "cpu 100 0 100 800 0 0 0 0 0 0\nprocs_running 2\nprocs_blocked 12\n",
  );
  put("vmstat", "pswpin 10\npswpout 20\npgmajfault 30\n");
  for (const r of ["cpu", "memory", "io"])
    put(
      `pressure/${r}`,
      "some avg10=0 avg60=0 avg300=0 total=100000\nfull avg10=0 avg60=0 avg300=0 total=20000\n",
    );
  put(
    "diskstats",
    "8 0 sda 10 0 20 100 20 0 40 200 1 100 300\n7 0 loop0 10 0 20 100 20 0 40 200 0 100 300\n",
  );
  put("10/task/10/stat", task(10, "leader", "S", 123));
  put("10/task/11/stat", task(11, "worker (io)", "D", 124));
  put("10/task/11/wchan", "io_schedule\n");
  put("10/cgroup", "0::/system.slice/example.service\n");
  return { root, put };
}
function task(pid: number, name: string, state: string, start: number) {
  const fields = Array(20).fill("0");
  fields[0] = state;
  fields[19] = String(start);
  return `${pid} (${name}) ${fields.join(" ")}`;
}

test("captures blocked worker threads even when the process leader sleeps; preserves wait and service identity", async () => {
  const { root } = fixture();
  const reading = await new LinuxDiagnostics(root).capture(1000);
  expect(reading).toMatchObject({
    load: 14,
    blocked: 12,
    runnable: 2,
    swapIn: null,
    cpu: { busy: null },
    pressure: { io: { some: null } },
  });
  expect(reading.threads).toEqual([
    {
      id: "boot-a:10:11:124",
      pid: 10,
      tid: 11,
      name: "worker (io)",
      cgroup: "0::/system.slice/example.service",
      wait: "io_schedule",
    },
  ]);
  expect(reading.disks).toHaveLength(1);
  expect(reading.disks[0].readBytes).toBeNull();
  expect(reading.warnings).toEqual([]);
});

test("uses interval deltas for PSI, CPU, swap and disk latency/queue; handles counter resets and missing baselines", async () => {
  const { root, put } = fixture();
  const sensor = new LinuxDiagnostics(root);
  await sensor.capture(1000);
  put(
    "stat",
    "cpu 110 0 110 850 20 0 0 10 0 0\nprocs_running 3\nprocs_blocked 4\n",
  );
  put("vmstat", "pswpin 15\npswpout 30\npgmajfault 32\n");
  put(
    "pressure/io",
    "some avg10=0 avg60=0 avg300=0 total=300000\nfull avg10=0 avg60=0 avg300=0 total=70000\n",
  );
  put("diskstats", "8 0 sda 12 0 24 130 23 0 46 220 2 200 800\n");
  const next = await sensor.capture(2000);
  expect(next.cpu).toEqual({ busy: 20, iowait: 20, steal: 10 });
  expect(next.pressure.io).toEqual({ some: 20, full: 5 });
  expect(next.pressure.cpu?.full).toBeNull();
  expect(next).toMatchObject({ swapIn: 5, swapOut: 10, majorFaults: 2 });
  expect(next.disks[0]).toEqual({
    device: "sda",
    readBytes: 2048,
    writeBytes: 3072,
    latencyMs: 10,
    queue: 0.5,
    inFlight: 2,
  });
  put("diskstats", "8 0 sda 1 0 2 1 1 0 2 1 0 1 1\n");
  rmSync(join(root, "vmstat"));
  rmSync(join(root, "pressure/io"));
  const missing = await sensor.capture(3000);
  expect(missing.swapIn).toBeNull();
  expect(missing.pressure.io).toBeNull();
  expect(missing.disks[0].latencyMs).toBeNull();
  expect(missing.warnings).toContain("vmstat unavailable");
  put("vmstat", "pswpin 100\npswpout 100\npgmajfault 100\n");
  put("pressure/io", "some total=900000\nfull total=90000\n");
  const restored = await sensor.capture(4000);
  expect(restored.swapIn).toBeNull();
  expect(restored.pressure.io?.some).toBeNull();
});

test("makes missing wait locations and truncated thread evidence explicit", async () => {
  const { root, put } = fixture();
  put("10/task/11/wchan", "0\n");
  for (let tid = 12; tid <= 220; tid++)
    put(`10/task/${tid}/stat`, task(tid, "blocked", "D", tid));
  const reading = await new LinuxDiagnostics(root).capture(1000);
  expect(reading.threads).toHaveLength(200);
  expect(reading.warnings).toContain("Some kernel wait locations unavailable");
  expect(reading.warnings.some((w) => w.includes("details omitted"))).toBe(
    true,
  );
});

test("process identities distinguish reused thread IDs and tolerate parentheses in executable names", () => {
  expect(parseTask(task(1, "a ) (b)", "D", 200))).toEqual({
    name: "a ) (b)",
    state: "D",
    start: "200",
  });
  expect(counterRate(0, 20, 1000)).toBeNull();
  expect(counterRate(5, undefined, 1000)).toBeNull();
  expect(counterRate(30, 20, 0)).toBeNull();
});
